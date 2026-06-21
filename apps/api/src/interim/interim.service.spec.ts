import { InterimService } from './interim.service';
import { InterimMeasureType, InterimStatus } from '@prisma/client';
import { AuthUser } from '../auth/types';

const party = { id: 'p1', email: 'p@x.com', roles: [], permissions: [] } as unknown as AuthUser;
const arbitrator = { id: 'a1', email: 'a@x.com', roles: [], permissions: [] } as unknown as AuthUser;

function makeService(membership: Record<string, unknown>, measure?: Record<string, unknown>) {
  const updates: Record<string, unknown>[] = [];
  const events: Record<string, unknown>[] = [];
  const prisma = {
    interimMeasure: {
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn(({ data }) => ({ id: 'im1', ...data })),
      findUnique: jest.fn().mockResolvedValue(measure ?? { id: 'im1', caseId: 'c1', status: InterimStatus.APPLIED, decidedAt: null }),
      update: jest.fn(({ data }) => (updates.push(data), { id: 'im1', ...data })),
    },
    interimMeasureEvent: { create: jest.fn(({ data }) => (events.push(data), { id: 'ev1', ...data })) },
  };
  const audit = { record: jest.fn() };
  const access = { assertCanAccessCase: jest.fn().mockResolvedValue(membership) };
  return { service: new InterimService(prisma as never, audit as never, access as never), prisma, updates, events };
}

describe('InterimService (Ch16) — portal never grants relief', () => {
  it('lets a party apply with a sequential measure number', async () => {
    const { service, prisma } = makeService({ isParty: true });
    await service.apply(party, 'c1', { type: InterimMeasureType.ASSET_PRESERVATION, reliefSought: 'Freeze the escrow account' });
    expect(prisma.interimMeasure.create.mock.calls[0][0].data.measureNumber).toBe('IM-0001');
  });

  it('forbids a non-party from applying', async () => {
    const { service } = makeService({ isParty: false, isTribunal: true });
    await expect(service.apply(arbitrator, 'c1', { type: InterimMeasureType.STATUS_QUO, reliefSought: 'x' })).rejects.toThrow();
  });

  it('lets ONLY the tribunal decide (parties cannot grant their own relief)', async () => {
    const partyTry = makeService({ isParty: true, isTribunal: false });
    await expect(partyTry.service.decide(party, 'im1', { decision: InterimStatus.GRANTED, reason: 'x' })).rejects.toThrow(/tribunal/i);

    const tribunal = makeService({ isTribunal: true });
    const res = await tribunal.service.decide(arbitrator, 'im1', { decision: InterimStatus.GRANTED, reason: 'Risk of dissipation' });
    expect(res.status).toBe(InterimStatus.GRANTED);
    expect(res.decidedById).toBe('a1');
    expect(tribunal.events.some((e) => e.kind === 'DECISION')).toBe(true);
  });

  it('rejects deciding a measure that was already decided', async () => {
    const { service } = makeService({ isTribunal: true }, { id: 'im1', caseId: 'c1', decidedAt: new Date() });
    await expect(service.decide(arbitrator, 'im1', { decision: InterimStatus.DENIED, reason: 'x' })).rejects.toThrow(/already been decided/i);
  });

  it('lets only the tribunal modify or discharge', async () => {
    const partyTry = makeService({ isParty: true, isTribunal: false });
    await expect(partyTry.service.modify(party, 'im1', { detail: 'x' })).rejects.toThrow();
    await expect(partyTry.service.discharge(party, 'im1', { detail: 'x' })).rejects.toThrow();

    const tribunal = makeService({ isTribunal: true });
    expect((await tribunal.service.discharge(arbitrator, 'im1', { detail: 'No longer needed' })).status).toBe(InterimStatus.DISCHARGED);
  });

  it('records compliance as an event for a party', async () => {
    const { service, events } = makeService({ isParty: true });
    await service.recordCompliance(party, 'im1', { detail: 'Escrow frozen; bank confirmation filed' });
    expect(events.some((e) => e.kind === 'COMPLIANCE')).toBe(true);
  });
});
