import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ChapterReviewStatus, RuleReviewStatus, RuleVersionStatus, VersionReviewState } from '@prisma/client';
import { Permission } from '@gaap/shared';
import { RuleReviewService } from './rule-review.service';
import { AuthUser } from '../auth/types';

const manager = { id: 'c1', email: 'council@x.com', roles: [], permissions: [Permission.POLICY_MANAGE] } as unknown as AuthUser;
const outsider = { id: 'o1', email: 'o@x.com', roles: [], permissions: [] } as unknown as AuthUser;

function make(over: Record<string, unknown> = {}) {
  const prisma: Record<string, unknown> = {
    ruleSetVersion: {
      findUnique: jest.fn(),
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => ({ id: 'newv', ...data })),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    ruleChapter: { create: jest.fn(({ data }: { data: Record<string, unknown> }) => ({ id: `ch-${(data as { number: number }).number}`, ...data })), findFirst: jest.fn(), count: jest.fn().mockResolvedValue(0) },
    rule: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn(({ data }: { data: Record<string, unknown> }) => ({ id: 'nr', ...data })), update: jest.fn(({ data }: { data: Record<string, unknown> }) => ({ id: 'r1', ...data })), count: jest.fn().mockResolvedValue(0) },
    ruleReviewItem: { create: jest.fn(), upsert: jest.fn(({ create, update }: { create?: unknown; update?: unknown }) => ({ id: 'rev1', ...(update ?? create ?? {}) })), findMany: jest.fn().mockResolvedValue([]) },
    ruleChapterReview: { findMany: jest.fn().mockResolvedValue([]), upsert: jest.fn(({ create, update }: { create?: unknown; update?: unknown }) => ({ id: 'chr1', ...(update ?? create ?? {}) })) },
    ruleReviewComment: { create: jest.fn(({ data }: { data: Record<string, unknown> }) => ({ id: 'cmt1', ...data })) },
    ...over,
  };
  (prisma as { $transaction: unknown }).$transaction = jest.fn((arg: unknown) =>
    typeof arg === 'function' ? (arg as (tx: unknown) => unknown)(prisma) : Promise.all(arg as Promise<unknown>[]),
  );
  const audit = { record: jest.fn() };
  const service = new RuleReviewService(prisma as never, audit as never);
  return { service, prisma, audit };
}

describe('RuleReviewService — permission gate', () => {
  it('refuses every admin action without POLICY_MANAGE', async () => {
    const { service } = make();
    await expect(service.listVersions(outsider)).rejects.toThrow(ForbiddenException);
    await expect(service.createDraftVersion(outsider, { fromVersionId: 'v1', version: '2.0' })).rejects.toThrow(ForbiddenException);
    await expect(service.activateVersion(outsider, 'v1')).rejects.toThrow(ForbiddenException);
  });
});

describe('RuleReviewService — authoring (clone)', () => {
  it('deep-clones a version into a new DRAFT with PENDING review items', async () => {
    const { service, prisma } = make({
      ruleSetVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'v1', ruleSetId: 'rs1', mandatoryLawNotice: 'note', mandatoryLawNoticeAr: null,
          chapters: [{ id: 'oc1', number: 1, title: 'Ch1', titleAr: null, summary: null, summaryAr: null, sortOrder: 1 }],
          rules: [{ id: 'or1', chapterId: 'oc1', number: '1.1', title: 'R', titleAr: null, text: 'T', textAr: null, status: 'ACTIVE', sortOrder: 0, requiredDocuments: [], applicableCaseTypes: [], applicableRoles: [], auditRequired: true, publicVisible: true, deadlineDefinitions: [] }],
        }),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'newv', version: '2.0', status: RuleVersionStatus.DRAFT }),
      },
    });
    const res = await service.createDraftVersion(manager, { fromVersionId: 'v1', version: '2.0' });
    expect(res).toMatchObject({ id: 'newv', status: RuleVersionStatus.DRAFT });
    expect((prisma.ruleChapter as { create: jest.Mock }).create).toHaveBeenCalledTimes(1);
    expect((prisma.rule as { create: jest.Mock }).create).toHaveBeenCalledTimes(1);
    expect((prisma.ruleReviewItem as { create: jest.Mock }).create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: RuleReviewStatus.PENDING }) }));
  });

  it('rejects a duplicate version label', async () => {
    const { service } = make({
      ruleSetVersion: { findUnique: jest.fn().mockResolvedValue({ id: 'v1', ruleSetId: 'rs1', chapters: [], rules: [] }), findFirst: jest.fn().mockResolvedValue({ id: 'dupe' }) },
    });
    await expect(service.createDraftVersion(manager, { fromVersionId: 'v1', version: '2.0' })).rejects.toThrow(/already exists/);
  });
});

describe('RuleReviewService — editing is DRAFT-only', () => {
  it('edits a rule in a DRAFT version and re-opens its review (PENDING)', async () => {
    const { service, prisma } = make({
      rule: { findUnique: jest.fn().mockResolvedValue({ id: 'r1', version: { id: 'v1', status: RuleVersionStatus.DRAFT } }), update: jest.fn(({ data }) => ({ id: 'r1', ...data })) },
    });
    await service.updateRuleText(manager, 'r1', { text: 'New text' });
    expect((prisma.ruleReviewItem as { upsert: jest.Mock }).upsert).toHaveBeenCalledWith(expect.objectContaining({ update: expect.objectContaining({ status: RuleReviewStatus.PENDING }) }));
  });

  it('refuses to edit a rule in an ACTIVE version', async () => {
    const { service } = make({
      rule: { findUnique: jest.fn().mockResolvedValue({ id: 'r1', version: { id: 'v1', status: RuleVersionStatus.ACTIVE } }) },
    });
    await expect(service.updateRuleText(manager, 'r1', { text: 'x' })).rejects.toThrow(/immutable/i);
  });
});

describe('RuleReviewService — diff', () => {
  it('reports added, removed, changed and unchanged rules by number', async () => {
    const { service } = make({
      rule: { findMany: jest.fn()
        .mockResolvedValueOnce([ // base
          { number: '1.1', title: 'A', text: 'old', publicVisible: true },
          { number: '1.2', title: 'B', text: 'same', publicVisible: true },
          { number: '1.3', title: 'C', text: 'gone', publicVisible: true },
        ])
        .mockResolvedValueOnce([ // target
          { number: '1.1', title: 'A', text: 'NEW', publicVisible: true },
          { number: '1.2', title: 'B', text: 'same', publicVisible: true },
          { number: '1.4', title: 'D', text: 'fresh', publicVisible: true },
        ]) },
    });
    const res = await service.diff(manager, 'base', 'target');
    expect(res.summary).toEqual({ added: 1, removed: 1, changed: 1, unchanged: 1 });
    const changed = res.entries.find((e) => e.number === '1.1') as { changedFields: string[] };
    expect(changed.changedFields).toContain('text');
  });
});

describe('RuleReviewService — chapter review, sign-off & gated activation', () => {
  // A DRAFT version whose chapters carry the given review statuses; `signedOff`
  // controls whether the version is already approved.
  function withChapters(statuses: ChapterReviewStatus[], opts: { signedOff?: boolean; status?: RuleVersionStatus } = {}) {
    const reviewState = opts.signedOff ? VersionReviewState.APPROVED : VersionReviewState.UNDER_REVIEW;
    return make({
      ruleSetVersion: {
        findUnique: jest.fn().mockResolvedValue({ id: 'v1', ruleSetId: 'rs1', status: opts.status ?? RuleVersionStatus.DRAFT, reviewState, signedOffAt: opts.signedOff ? new Date() : null }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }), update: jest.fn(({ data }) => ({ id: 'v1', ...data })),
      },
      ruleChapter: { count: jest.fn().mockResolvedValue(statuses.length), findFirst: jest.fn().mockResolvedValue({ id: 'ch1', versionId: 'v1', version: { status: RuleVersionStatus.DRAFT } }) },
      ruleChapterReview: { findMany: jest.fn().mockResolvedValue(statuses.map((status) => ({ status }))), upsert: jest.fn(({ create, update }) => ({ id: 'chr1', ...(update ?? create) })) },
    });
  }

  it('records a chapter review and recomputes the version review state', async () => {
    const { service, prisma, audit } = withChapters([ChapterReviewStatus.NO_ISSUE]);
    await service.recordChapterReview(manager, 'v1', 'ch1', { status: ChapterReviewStatus.BLOCKER, comment: 'Seat law issue' });
    expect((prisma.ruleChapterReview as { upsert: jest.Mock }).upsert).toHaveBeenCalled();
    expect((prisma.ruleReviewComment as { create: jest.Mock }).create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ body: 'Seat law issue', status: ChapterReviewStatus.BLOCKER }) }));
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'RULE_CHAPTER_REVIEWED' }));
  });

  it('refuses sign-off while a BLOCKER or CHANGE_REQUESTED remains', async () => {
    const blocker = withChapters([ChapterReviewStatus.APPROVED, ChapterReviewStatus.BLOCKER]);
    await expect(blocker.service.signOff(manager, 'v1')).rejects.toThrow(/Cannot sign off/i);
    const change = withChapters([ChapterReviewStatus.APPROVED, ChapterReviewStatus.CHANGE_REQUESTED]);
    await expect(change.service.signOff(manager, 'v1')).rejects.toThrow(BadRequestException);
  });

  it('refuses sign-off while a chapter is unreviewed', async () => {
    // 3 chapters but only 2 reviews → one unreviewed.
    const { service } = make({
      ruleSetVersion: { findUnique: jest.fn().mockResolvedValue({ id: 'v1', ruleSetId: 'rs1', status: RuleVersionStatus.DRAFT, reviewState: VersionReviewState.UNDER_REVIEW, signedOffAt: null }) },
      ruleChapter: { count: jest.fn().mockResolvedValue(3) },
      ruleChapterReview: { findMany: jest.fn().mockResolvedValue([{ status: ChapterReviewStatus.APPROVED }, { status: ChapterReviewStatus.NO_ISSUE }]) },
    });
    await expect(service.signOff(manager, 'v1')).rejects.toThrow(/unreviewed/i);
  });

  it('signs off when every chapter is cleared', async () => {
    const { service, prisma } = withChapters([ChapterReviewStatus.APPROVED, ChapterReviewStatus.NO_ISSUE]);
    const res = await service.signOff(manager, 'v1');
    expect(res.reviewState).toBe(VersionReviewState.APPROVED);
    expect((prisma.ruleSetVersion as { update: jest.Mock }).update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ reviewState: VersionReviewState.APPROVED, signedOffById: manager.id }) }));
  });

  it('refuses activation without final sign-off', async () => {
    const { service } = withChapters([ChapterReviewStatus.APPROVED, ChapterReviewStatus.NO_ISSUE], { signedOff: false });
    await expect(service.activateVersion(manager, 'v1')).rejects.toThrow(/sign-off/i);
  });

  it('activates a signed-off version and supersedes the prior active version', async () => {
    const { service, prisma } = withChapters([ChapterReviewStatus.APPROVED, ChapterReviewStatus.NO_ISSUE], { signedOff: true });
    const res = await service.activateVersion(manager, 'v1');
    expect(res.status).toBe(RuleVersionStatus.ACTIVE);
    expect((prisma.ruleSetVersion as { updateMany: jest.Mock }).updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: RuleVersionStatus.ACTIVE }), data: expect.objectContaining({ status: RuleVersionStatus.SUPERSEDED }) }));
  });

  it('archives a non-active version and refuses to archive the active one', async () => {
    const draft = withChapters([ChapterReviewStatus.NO_ISSUE], { status: RuleVersionStatus.DRAFT });
    await expect(draft.service.archiveVersion(manager, 'v1')).resolves.toMatchObject({ status: RuleVersionStatus.ARCHIVED });
    const active = make({ ruleSetVersion: { findUnique: jest.fn().mockResolvedValue({ id: 'v1', ruleSetId: 'rs1', status: RuleVersionStatus.ACTIVE }) } });
    await expect(active.service.archiveVersion(manager, 'v1')).rejects.toThrow(/active version cannot be archived/i);
  });

  it('refuses to activate a non-DRAFT version', async () => {
    const { service } = make({ ruleSetVersion: { findUnique: jest.fn().mockResolvedValue({ id: 'v1', ruleSetId: 'rs1', status: RuleVersionStatus.ACTIVE }) } });
    await expect(service.activateVersion(manager, 'v1')).rejects.toThrow(/DRAFT/);
  });
});
