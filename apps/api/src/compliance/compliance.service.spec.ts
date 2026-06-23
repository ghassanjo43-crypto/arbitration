import { BadRequestException } from '@nestjs/common';
import { ComplianceHoldStatus, ScreeningDecision, ScreeningStatus, ScreeningSubjectType } from '@prisma/client';
import { ComplianceService } from './compliance.service';
import { AuthUser } from '../auth/types';

const reviewer = { id: 'rev1', email: 'rev@x.com', roles: [], permissions: [] } as unknown as AuthUser;

function make(opts: { screenOutcome?: 'CLEAR' | 'POSSIBLE_MATCH'; screenThrows?: boolean; existingValid?: boolean } = {}) {
  const holds: Array<Record<string, unknown>> = [];
  let lastCheck: Record<string, unknown> = {};

  const prisma = {
    screeningCheck: {
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => { lastCheck = { id: 'chk1', ...data }; return lastCheck; }),
      update: jest.fn(({ data }: { data: Record<string, unknown> }) => { lastCheck = { ...lastCheck, ...data }; return lastCheck; }),
      updateMany: jest.fn().mockResolvedValue({ count: 3 }),
      findFirst: jest.fn().mockResolvedValue(opts.existingValid ? { id: 'old', status: ScreeningStatus.CLEAR } : null),
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
    complianceHold: {
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => { const h = { id: `hold${holds.length + 1}`, ...data }; holds.push(h); return h; }),
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
      update: jest.fn(({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => ({ id: where.id, ...data })),
    },
    caseParty: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const audit = { record: jest.fn() };
  const screening = {
    providerName: 'mock',
    screen: opts.screenThrows
      ? jest.fn().mockRejectedValue(new Error('provider down'))
      : jest.fn().mockResolvedValue({ provider: 'mock', providerRef: 'mock_1', outcome: opts.screenOutcome ?? 'CLEAR', riskScore: opts.screenOutcome === 'POSSIBLE_MATCH' ? 80 : 0, matchCount: opts.screenOutcome === 'POSSIBLE_MATCH' ? 1 : 0, summary: 's' }),
  };
  const config = { get: () => 365 };
  const service = new ComplianceService(prisma as never, audit as never, screening as never, config as never);
  return { service, prisma, audit, screening, holds };
}

const baseInput = { subjectType: ScreeningSubjectType.PARTY, subjectId: 'p1', subjectName: 'Acme Ltd', caseId: 'c1' };

describe('ComplianceService — screening', () => {
  it('records a CLEAR result with an expiry and raises no hold', async () => {
    const { service, prisma } = make({ screenOutcome: 'CLEAR' });
    const check = await service.screenSubject({ ...baseInput, force: true });
    expect(check.status).toBe(ScreeningStatus.CLEAR);
    expect((check as Record<string, unknown>).expiresAt).toBeInstanceOf(Date);
    expect(prisma.complianceHold.create).not.toHaveBeenCalled();
  });

  it('raises a hold on a possible match and routes it for review', async () => {
    const { service, prisma } = make({ screenOutcome: 'POSSIBLE_MATCH' });
    const check = await service.screenSubject({ ...baseInput, force: true });
    expect(check.status).toBe(ScreeningStatus.POSSIBLE_MATCH);
    expect(prisma.complianceHold.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: ComplianceHoldStatus.ACTIVE, screeningCheckId: 'chk1' }) }),
    );
  });

  it('fails closed when the provider errors (FAILED + hold)', async () => {
    const { service, prisma } = make({ screenThrows: true });
    const check = await service.screenSubject({ ...baseInput, force: true });
    expect(check.status).toBe(ScreeningStatus.FAILED);
    expect(prisma.complianceHold.create).toHaveBeenCalled();
  });

  it('skips re-screening when a valid CLEAR check already exists', async () => {
    const { service, screening } = make({ existingValid: true });
    await service.screenSubject(baseInput); // not forced
    expect(screening.screen).not.toHaveBeenCalled();
  });

  it('audits every screening request and result', async () => {
    const { service, audit } = make({ screenOutcome: 'CLEAR' });
    await service.screenSubject({ ...baseInput, force: true });
    const actions = audit.record.mock.calls.map((c) => (c[0] as { action: string }).action);
    expect(actions).toEqual(expect.arrayContaining(['SCREENING_REQUESTED', 'SCREENING_RESULT']));
  });
});

describe('ComplianceService — holds & review', () => {
  it('blocks a case from proceeding while a hold is active', async () => {
    const { service, prisma } = make();
    (prisma.complianceHold.count as jest.Mock).mockResolvedValueOnce(1);
    await expect(service.assertCaseClearedToProceed('c1')).rejects.toThrow(BadRequestException);
  });

  it('allows a case to proceed with no active hold', async () => {
    const { service } = make();
    await expect(service.assertCaseClearedToProceed('c1')).resolves.toBeUndefined();
  });

  it('manual override: APPROVED review releases the linked active hold', async () => {
    const { service, prisma } = make();
    (prisma.screeningCheck.findUnique as jest.Mock).mockResolvedValue({
      id: 'chk1', caseId: 'c1', status: ScreeningStatus.POSSIBLE_MATCH,
      holds: [{ id: 'hold1', status: ComplianceHoldStatus.ACTIVE }],
    });
    (prisma.complianceHold.findUnique as jest.Mock).mockResolvedValue({ id: 'hold1', caseId: 'c1', status: ComplianceHoldStatus.ACTIVE });
    await service.reviewCheck(reviewer, 'chk1', ScreeningDecision.APPROVED, 'cleared by analyst');
    expect(prisma.complianceHold.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'hold1' }, data: expect.objectContaining({ status: ComplianceHoldStatus.RELEASED }) }),
    );
  });

  it('REJECTED review keeps the hold active (subject stays blocked)', async () => {
    const { service, prisma } = make();
    (prisma.screeningCheck.findUnique as jest.Mock).mockResolvedValue({
      id: 'chk1', caseId: 'c1', status: ScreeningStatus.POSSIBLE_MATCH,
      holds: [{ id: 'hold1', status: ComplianceHoldStatus.ACTIVE }],
    });
    await service.reviewCheck(reviewer, 'chk1', ScreeningDecision.REJECTED, 'confirmed match');
    expect(prisma.complianceHold.update).not.toHaveBeenCalled();
  });

  it('marks lapsed CLEAR screenings as EXPIRED', async () => {
    const { service } = make();
    await expect(service.markExpired()).resolves.toEqual({ expired: 3 });
  });
});
