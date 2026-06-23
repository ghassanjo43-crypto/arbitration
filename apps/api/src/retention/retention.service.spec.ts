import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { LegalHoldStatus, RetentionStatus } from '@prisma/client';
import { Permission, Role } from '@gaap/shared';
import { RetentionService } from './retention.service';
import { AuthUser } from '../auth/types';

const superAdmin = { id: 'sa1', email: 'sa@x.com', roles: [Role.SUPER_ADMIN], permissions: [Permission.SETTINGS_MANAGE] } as unknown as AuthUser;
const admin = { id: 'a1', email: 'a@x.com', roles: [Role.ADMIN], permissions: [Permission.SETTINGS_MANAGE] } as unknown as AuthUser;
const outsider = { id: 'o1', email: 'o@x.com', roles: [], permissions: [] } as unknown as AuthUser;

function make(over: Record<string, unknown> = {}) {
  const prisma: Record<string, unknown> = {
    systemSetting: { findUnique: jest.fn().mockResolvedValue(null) },
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
