import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { RuleReviewStatus, RuleVersionStatus } from '@prisma/client';
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
    ruleChapter: { create: jest.fn(({ data }: { data: Record<string, unknown> }) => ({ id: `ch-${(data as { number: number }).number}`, ...data })) },
    rule: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn(({ data }: { data: Record<string, unknown> }) => ({ id: 'nr', ...data })), update: jest.fn(({ data }: { data: Record<string, unknown> }) => ({ id: 'r1', ...data })), count: jest.fn().mockResolvedValue(0) },
    ruleReviewItem: { create: jest.fn(), upsert: jest.fn(({ create, update }: { create?: unknown; update?: unknown }) => ({ id: 'rev1', ...(update ?? create ?? {}) })), findMany: jest.fn().mockResolvedValue([]) },
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

describe('RuleReviewService — gated activation', () => {
  function withReview(items: RuleReviewStatus[], ruleCount = items.length) {
    return make({
      ruleSetVersion: { findUnique: jest.fn().mockResolvedValue({ id: 'v1', ruleSetId: 'rs1', status: RuleVersionStatus.DRAFT }), updateMany: jest.fn().mockResolvedValue({ count: 1 }), update: jest.fn() },
      rule: { count: jest.fn().mockResolvedValue(ruleCount) },
      ruleReviewItem: { findMany: jest.fn().mockResolvedValue(items.map((status) => ({ status }))) },
    });
  }

  it('refuses activation while any rule is PENDING', async () => {
    const { service } = withReview([RuleReviewStatus.OK, RuleReviewStatus.PENDING]);
    await expect(service.activateVersion(manager, 'v1')).rejects.toThrow(/incomplete/i);
  });

  it('refuses activation while a BLOCKER or CHANGE_REQUIRED remains', async () => {
    const blocker = withReview([RuleReviewStatus.OK, RuleReviewStatus.BLOCKER]);
    await expect(blocker.service.activateVersion(manager, 'v1')).rejects.toThrow(BadRequestException);
    const change = withReview([RuleReviewStatus.OK, RuleReviewStatus.CHANGE_REQUIRED]);
    await expect(change.service.activateVersion(manager, 'v1')).rejects.toThrow(BadRequestException);
  });

  it('activates when every rule is OK and supersedes the prior active version', async () => {
    const { service, prisma } = withReview([RuleReviewStatus.OK, RuleReviewStatus.OK]);
    const res = await service.activateVersion(manager, 'v1');
    expect(res.status).toBe(RuleVersionStatus.ACTIVE);
    expect((prisma.ruleSetVersion as { updateMany: jest.Mock }).updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: RuleVersionStatus.ACTIVE }), data: expect.objectContaining({ status: RuleVersionStatus.SUPERSEDED }) }));
  });

  it('refuses to activate a non-DRAFT version', async () => {
    const { service } = make({ ruleSetVersion: { findUnique: jest.fn().mockResolvedValue({ id: 'v1', ruleSetId: 'rs1', status: RuleVersionStatus.ACTIVE }) } });
    await expect(service.activateVersion(manager, 'v1')).rejects.toThrow(/DRAFT/);
  });
});
