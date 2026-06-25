import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { LegalHoldStatus, RetentionStatus } from '@prisma/client';
import { Permission, Role } from '@gaap/shared';
import { RetentionService } from './retention.service';
import { AuthUser } from '../auth/types';

const superAdmin = { id: 'sa1', email: 'sa@x.com', roles: [Role.SUPER_ADMIN], permissions: [Permission.SETTINGS_MANAGE] } as unknown as AuthUser;
const admin = { id: 'a1', email: 'a@x.com', roles: [Role.ADMIN], permissions: [Permission.SETTINGS_MANAGE] } as unknown as AuthUser;
const council = { id: 'co1', email: 'council@x.com', roles: [Role.COUNCIL_MEMBER], permissions: [Permission.POLICY_MANAGE] } as unknown as AuthUser;
const registrar = { id: 're1', email: 'reg@x.com', roles: [Role.REGISTRAR], permissions: [Permission.CASE_MANAGE_SERVICE] } as unknown as AuthUser;
const outsider = { id: 'o1', email: 'o@x.com', roles: [], permissions: [] } as unknown as AuthUser;

/** In-memory SystemSetting mock so the draft→activate flow reads back its own writes. */
function settingsStore(initial: Record<string, unknown> = {}) {
  const store = new Map<string, string>();
  for (const [k, v] of Object.entries(initial)) store.set(k, JSON.stringify(v));
  return {
    findUnique: jest.fn(async ({ where: { key } }: { where: { key: string } }) => (store.has(key) ? { key, value: store.get(key) } : null)),
    upsert: jest.fn(async ({ where: { key }, create, update }: { where: { key: string }; create: { value: string }; update: { value: string } }) => {
      store.set(key, update?.value ?? create.value);
      return { key };
    }),
    delete: jest.fn(async ({ where: { key } }: { where: { key: string } }) => { store.delete(key); return { key }; }),
    _store: store,
  };
}

function make(over: Record<string, unknown> = {}) {
  const prisma: Record<string, unknown> = {
    systemSetting: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn().mockResolvedValue({}), delete: jest.fn().mockResolvedValue({}) },
    case: { findUnique: jest.fn(), findMany: jest.fn().mockResolvedValue([]), update: jest.fn(({ data }: { data: Record<string, unknown> }) => ({ id: 'c1', ...data })), count: jest.fn().mockResolvedValue(0) },
    legalHold: { create: jest.fn(({ data }: { data: Record<string, unknown> }) => ({ id: 'h1', ...data })), findUnique: jest.fn(), update: jest.fn(({ data }: { data: Record<string, unknown> }) => ({ id: 'h1', ...data })), count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([]) },
    retentionSweepRecord: { create: jest.fn(({ data }: { data: Record<string, unknown> }) => ({ id: 'r1', ...data })) },
    loginEvent: { count: jest.fn().mockResolvedValue(0) },
    emailDelivery: { count: jest.fn().mockResolvedValue(0) },
    screeningCheck: { count: jest.fn().mockResolvedValue(0) },
    user: { count: jest.fn().mockResolvedValue(0) },
    serviceCertificate: { findMany: jest.fn().mockResolvedValue([]) },
    ...over,
  };
  const audit = { record: jest.fn() };
  const service = new RetentionService(prisma as never, audit as never);
  return { service, prisma, audit };
}

describe('RetentionService — permission gate', () => {
  it('refuses without SETTINGS_MANAGE', async () => {
    const { service } = make();
    await expect(service.dryRunSweep(outsider)).rejects.toThrow(ForbiddenException);
    await expect(service.placeLegalHold(outsider, { caseId: 'c1', reason: 'x' })).rejects.toThrow(ForbiddenException);
  });
});

describe('RetentionService — legal hold', () => {
  it('places a hold and flags the case LEGAL_HOLD', async () => {
    const { service, prisma, audit } = make({ case: { findUnique: jest.fn().mockResolvedValue({ id: 'c1' }), update: jest.fn(({ data }) => ({ id: 'c1', ...data })) } });
    await service.placeLegalHold(admin, { caseId: 'c1', reason: 'enforcement pending' });
    expect((prisma.case as { update: jest.Mock }).update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ legalHold: true, retentionStatus: RetentionStatus.LEGAL_HOLD }) }));
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'LEGAL_HOLD_PLACED' }));
  });

  it('assertNoLegalHold throws while an active hold exists', async () => {
    const { service } = make({ legalHold: { count: jest.fn().mockResolvedValue(1) } });
    await expect(service.assertNoLegalHold('c1')).rejects.toThrow(BadRequestException);
  });

  it('releasing the last active hold clears the case flag', async () => {
    const { service, prisma } = make({
      legalHold: { findUnique: jest.fn().mockResolvedValue({ id: 'h1', caseId: 'c1', status: LegalHoldStatus.ACTIVE }), update: jest.fn(({ data }) => ({ id: 'h1', ...data })), count: jest.fn().mockResolvedValue(0) },
      case: { update: jest.fn(({ data }) => ({ id: 'c1', ...data })) },
    });
    await service.releaseLegalHold(admin, 'h1', { note: 'cleared' });
    expect((prisma.case as { update: jest.Mock }).update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ legalHold: false, retentionStatus: RetentionStatus.ACTIVE }) }));
  });
});

describe('RetentionService — dry run (changes nothing)', () => {
  it('reports eligible closed cases and never deletes', async () => {
    const old = new Date('2010-01-01');
    const { service, prisma, audit } = make({
      case: { findMany: jest.fn().mockResolvedValue([{ id: 'c1', legalHold: false }, { id: 'c2', legalHold: true }]), update: jest.fn() },
    });
    const res = await service.dryRunSweep(admin);
    expect(res.dryRun).toBe(true);
    const caseReport = res.reports.find((r) => r.category === 'CASE_RECORD')!;
    expect(caseReport.eligible).toBe(1); // c1 free; c2 held
    expect(caseReport.blockedByLegalHold).toBe(1);
    // The award/audit safeguards are reported but never eligible.
    expect(res.reports.find((r) => r.category === 'AWARD')!.eligible).toBe(0);
    expect(res.reports.find((r) => r.category === 'AUDIT_LOG')!.behavior).toBe('RETAIN_FOREVER');
    expect((prisma.case as { update: jest.Mock }).update).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'RETENTION_DRY_RUN' }));
    void old;
  });
});

describe('RetentionService — policy editing workflow (draft → review → activate)', () => {
  it('lets a Super Admin draft a change and audits it (nothing active yet)', async () => {
    const settings = settingsStore();
    const { service, audit } = make({ systemSetting: settings });
    const state = await service.draftPolicy(superAdmin, { entries: [{ category: 'CASE_RECORD', days: 100 }], submitForReview: true });
    expect(state.status).toBe('PENDING_REVIEW');
    expect(settings.upsert).toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'RETENTION_POLICY_DRAFTED' }));
  });

  it('refuses to draft a deletable behaviour on a safeguarded category (awards)', async () => {
    const { service } = make({ systemSetting: settingsStore() });
    await expect(service.draftPolicy(superAdmin, { entries: [{ category: 'AWARD', behavior: 'SOFT_DELETE' }] })).rejects.toThrow(BadRequestException);
  });

  it('refuses drafting for a non-super-admin', async () => {
    const { service } = make({ systemSetting: settingsStore() });
    await expect(service.draftPolicy(council, { entries: [{ category: 'CASE_RECORD', days: 100 }] })).rejects.toThrow(ForbiddenException);
  });

  it('lets Council approve a pending draft and audits the review', async () => {
    const draft = { overrides: { CASE_RECORD: { days: 100 } }, status: 'PENDING_REVIEW', proposedById: 'sa1', proposedByEmail: 'sa@x.com', proposedAt: '2026-01-01T00:00:00Z' };
    const { service, audit } = make({ systemSetting: settingsStore({ 'retention.policy.draft': draft }) });
    const res = await service.reviewPolicy(council, { decision: 'APPROVE', note: 'ok per counsel' });
    expect(res.status).toBe('APPROVED');
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'RETENTION_POLICY_REVIEWED' }));
  });

  it('refuses review by a non-council user', async () => {
    const draft = { overrides: { CASE_RECORD: { days: 100 } }, status: 'PENDING_REVIEW', proposedById: 'sa1', proposedByEmail: 'sa@x.com', proposedAt: '2026-01-01T00:00:00Z' };
    const { service } = make({ systemSetting: settingsStore({ 'retention.policy.draft': draft }) });
    await expect(service.reviewPolicy(superAdmin, { decision: 'APPROVE' })).rejects.toThrow(ForbiddenException);
  });

  it('refuses to activate a draft that has not been approved', async () => {
    const draft = { overrides: { CASE_RECORD: { days: 100 } }, status: 'PENDING_REVIEW', proposedById: 'sa1', proposedByEmail: 'sa@x.com', proposedAt: '2026-01-01T00:00:00Z' };
    const { service } = make({ systemSetting: settingsStore({ 'retention.policy.draft': draft }) });
    await expect(service.activatePolicy(superAdmin)).rejects.toThrow(BadRequestException);
  });

  it('activates an APPROVED draft, applies it, and audits the period change', async () => {
    const draft = { overrides: { CASE_RECORD: { days: 100 } }, status: 'APPROVED', proposedById: 'sa1', proposedByEmail: 'sa@x.com', proposedAt: '2026-01-01T00:00:00Z', reviewedByEmail: 'council@x.com' };
    const settings = settingsStore({ 'retention.policy.draft': draft });
    const { service, audit } = make({ systemSetting: settings });
    const after = await service.activatePolicy(superAdmin);
    expect(after.CASE_RECORD.days).toBe(100); // default 3650 → 100
    expect(settings.delete).toHaveBeenCalled(); // draft cleared
    const actions = audit.record.mock.calls.map((c) => c[0].action);
    expect(actions).toContain('RETENTION_PERIOD_CHANGED');
    expect(actions).toContain('RETENTION_POLICY_ACTIVATED');
  });
});

describe('RetentionService — role-controlled views & holds', () => {
  it('lets a Registrar view legal holds', async () => {
    const { service } = make();
    await expect(service.listLegalHolds(registrar)).resolves.toEqual([]);
  });

  it('lets a Registrar request (place) a legal hold', async () => {
    const { service, audit } = make({ case: { findUnique: jest.fn().mockResolvedValue({ id: 'c1' }), update: jest.fn(({ data }) => ({ id: 'c1', ...data })) } });
    await service.placeLegalHold(registrar, { caseId: 'c1', reason: 'pending enforcement' });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'LEGAL_HOLD_PLACED' }));
  });

  it('blocks an outsider from viewing or requesting holds', async () => {
    const { service } = make();
    await expect(service.listLegalHolds(outsider)).rejects.toThrow(ForbiddenException);
    await expect(service.placeLegalHold(outsider, { caseId: 'c1', reason: 'x' })).rejects.toThrow(ForbiddenException);
  });
});

describe('RetentionService — execution gate & soft-delete', () => {
  it('refuses execution for a non-super-admin', async () => {
    const { service } = make();
    await expect(service.executeSweep(admin, { confirm: true, categories: ['CASE_RECORD'] })).rejects.toThrow(/super administrator/i);
  });

  it('refuses execution without explicit confirmation', async () => {
    const { service } = make();
    await expect(service.executeSweep(superAdmin, { confirm: false, categories: ['CASE_RECORD'] })).rejects.toThrow(/confirmation/i);
  });

  it('refuses to delete a RETAIN_FOREVER category (awards)', async () => {
    const { service } = make();
    const res = await service.executeSweep(superAdmin, { confirm: true, categories: ['AWARD'] });
    expect(res.summary[0]).toMatchObject({ category: 'AWARD', softDeleted: 0, refused: expect.stringContaining('RETAIN_FOREVER') });
  });

  it('soft-deletes eligible cases, skips legal-held ones, and tombstones + audits', async () => {
    const { service, prisma, audit } = make({
      case: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'c1', reference: 'GAAP-1', legalHold: false, updatedAt: new Date() },
          { id: 'c2', reference: 'GAAP-2', legalHold: true, updatedAt: new Date() },
        ]),
        update: jest.fn(({ data }) => ({ id: 'c1', ...data })),
      },
    });
    const res = await service.executeSweep(superAdmin, { confirm: true, categories: ['CASE_RECORD'] });
    expect(res.summary[0]).toMatchObject({ category: 'CASE_RECORD', softDeleted: 1, skippedLegalHold: 1 });
    // c1 soft-deleted (deletedAt set, status DELETED).
    expect((prisma.case as { update: jest.Mock }).update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'c1' }, data: expect.objectContaining({ retentionStatus: RetentionStatus.DELETED }) }));
    // A tombstone with a preserved hash is recorded for the deletion.
    const recCalls = (prisma.retentionSweepRecord as { create: jest.Mock }).create.mock.calls.map((c) => c[0].data.action);
    expect(recCalls).toEqual(expect.arrayContaining(['SOFT_DELETED', 'SKIPPED_LEGAL_HOLD']));
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'CASE_SOFT_DELETED_RETENTION' }));
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'RETENTION_SWEEP_EXECUTED' }));
  });
});
