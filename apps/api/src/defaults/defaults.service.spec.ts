import { DefaultsService } from './defaults.service';
import { DefaultOutcome, DefaultReviewFactor, DefaultStage } from '@prisma/client';
import { AuthUser } from '../auth/types';

const registrar = { id: 'reg1', email: 'r@x.com', roles: [], permissions: [] } as unknown as AuthUser;
const arbitrator = { id: 'arb1', email: 'a@x.com', roles: [], permissions: [] } as unknown as AuthUser;

const ALL_FACTORS = Object.values(DefaultReviewFactor);

function makeService(membership: Record<string, unknown>, proceeding?: Record<string, unknown>) {
  const created: Record<string, unknown>[] = [];
  const prisma = {
    defaultProceeding: {
      create: jest.fn(({ data }) => ({ id: 'dp1', ...data, reviewItems: (data.reviewItems?.create ?? []) })),
      findUnique: jest.fn().mockResolvedValue(proceeding ?? { id: 'dp1', caseId: 'c1', stage: DefaultStage.TRIBUNAL_REVIEW }),
      update: jest.fn().mockResolvedValue({}),
    },
    defaultDecision: { create: jest.fn(({ data }) => (created.push(data), { id: 'dec1', ...data })) },
    defaultNotice: { create: jest.fn(({ data }) => ({ id: 'n1', ...data })) },
    defaultReviewItem: { update: jest.fn(({ data }) => ({ id: 'ri1', ...data })) },
    defaultRegistrarReport: { upsert: jest.fn(({ create }) => ({ id: 'rr1', ...create })) },
  };
  const audit = { record: jest.fn() };
  const access = { assertCanAccessCase: jest.fn().mockResolvedValue(membership) };
  return { service: new DefaultsService(prisma as never, audit as never, access as never), prisma, created };
}

/** A proceeding where every factor is satisfied and service is verified. */
function readyProceeding(overrides: Record<string, unknown> = {}) {
  return {
    id: 'dp1',
    caseId: 'c1',
    decision: null,
    reviewItems: ALL_FACTORS.map((factor) => ({ factor, satisfied: true })),
    registrarReport: { serviceVerified: true },
    ...overrides,
  };
}

describe('DefaultsService — due-process safeguard (Ch17)', () => {
  it('opens a proceeding and pre-creates all nine review factors', async () => {
    const { service, prisma } = makeService({ isRegistrar: true });
    await service.open(registrar, 'c1', { defaultingParticipant: 'Respondent Ltd', basis: 'RESPONSE_NOT_FILED' });
    const data = prisma.defaultProceeding.create.mock.calls[0][0].data;
    expect(data.reviewItems.create).toHaveLength(9);
  });

  it('blocks PROCEED while any due-process factor is unsatisfied', async () => {
    const proceeding = readyProceeding({ reviewItems: ALL_FACTORS.map((factor, i) => ({ factor, satisfied: i !== 0 })) });
    const { service } = makeService({ isTribunal: true }, proceeding);
    await expect(service.decide(arbitrator, 'dp1', { outcome: DefaultOutcome.PROCEED, reason: 'x' })).rejects.toThrow(/outstanding due-process/i);
  });

  it('blocks PROCEED when service is not verified by a registrar report', async () => {
    const proceeding = readyProceeding({ registrarReport: { serviceVerified: false } });
    const { service } = makeService({ isTribunal: true }, proceeding);
    await expect(service.decide(arbitrator, 'dp1', { outcome: DefaultOutcome.PROCEED, reason: 'x' })).rejects.toThrow(/verified service/i);
  });

  it('allows PROCEED only once every factor is satisfied AND service verified', async () => {
    const { service, created } = makeService({ isTribunal: true }, readyProceeding());
    await service.decide(arbitrator, 'dp1', { outcome: DefaultOutcome.PROCEED, reason: 'All due-process satisfied' });
    expect(created[0].outcome).toBe(DefaultOutcome.PROCEED);
  });

  it('lets the tribunal REFUSE even without full review (errs toward fairness)', async () => {
    const proceeding = readyProceeding({ reviewItems: ALL_FACTORS.map((factor) => ({ factor, satisfied: false })), registrarReport: null });
    const { service, created } = makeService({ isTribunal: true }, proceeding);
    await service.decide(arbitrator, 'dp1', { outcome: DefaultOutcome.REFUSE, reason: 'Service not satisfactorily shown' });
    expect(created[0].outcome).toBe(DefaultOutcome.REFUSE);
  });

  it('forbids anyone but the tribunal from deciding', async () => {
    const { service } = makeService({ isRegistrar: true, isTribunal: false }, readyProceeding());
    await expect(service.decide(registrar, 'dp1', { outcome: DefaultOutcome.PROCEED, reason: 'x' })).rejects.toThrow(/tribunal/i);
  });

  it('rejects deciding a proceeding that was already decided', async () => {
    const { service } = makeService({ isTribunal: true }, readyProceeding({ decision: { id: 'old' } }));
    await expect(service.decide(arbitrator, 'dp1', { outcome: DefaultOutcome.REFUSE, reason: 'x' })).rejects.toThrow(/already been decided/i);
  });
});
