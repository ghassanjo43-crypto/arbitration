import { EvidenceService } from './evidence.service';
import { ExpertsService } from './experts.service';
import { EvidenceObjectionStatus, EvidenceTargetType, ExpertAppointment, ExpertReportKind, ExpertStatus, OathKind, WitnessStatus } from '@prisma/client';
import { AuthUser } from '../auth/types';

const party = { id: 'p1', email: 'p@x.com', roles: [], permissions: [] } as unknown as AuthUser;
const arbitrator = { id: 'a1', email: 'a@x.com', roles: [], permissions: [] } as unknown as AuthUser;

function prismaStub(extra: Record<string, unknown> = {}) {
  return {
    witness: { create: jest.fn(({ data }) => ({ id: 'w1', ...data })), findUnique: jest.fn(), update: jest.fn(({ data }) => ({ id: 'w1', ...data })), findMany: jest.fn(), count: jest.fn().mockResolvedValue(0) },
    witnessStatement: { create: jest.fn(({ data }) => ({ id: 's1', ...data })), count: jest.fn().mockResolvedValue(0) },
    evidenceObjection: { create: jest.fn(({ data }) => ({ id: 'o1', ...data })), findUnique: jest.fn(), update: jest.fn(({ data }) => ({ id: 'o1', ...data })), findMany: jest.fn() },
    expert: { create: jest.fn(({ data }) => ({ id: 'e1', ...data })), findUnique: jest.fn(), update: jest.fn(({ data }) => ({ id: 'e1', ...data })), findMany: jest.fn() },
    expertReport: { create: jest.fn(({ data }) => ({ id: 'rep1', ...data })), count: jest.fn().mockResolvedValue(1) },
    ...extra,
  };
}

describe('EvidenceService (witnesses & objections)', () => {
  function make(membership: Record<string, unknown>, prismaExtra = {}) {
    const prisma = prismaStub(prismaExtra);
    const audit = { record: jest.fn() };
    const access = { assertCanAccessCase: jest.fn().mockResolvedValue(membership) };
    return { service: new EvidenceService(prisma as never, audit as never, access as never), prisma };
  }

  it('lets a party put forward a witness, but not a non-party', async () => {
    const { service } = make({ isParty: true });
    await expect(service.addWitness(party, 'c1', { fullName: 'Jane Doe' })).resolves.toMatchObject({ fullName: 'Jane Doe' });
    const blocked = make({ isParty: false, isTribunal: true });
    await expect(blocked.service.addWitness(arbitrator, 'c1', { fullName: 'X' })).rejects.toThrow();
  });

  it('records an oath and marks the witness TESTIFIED (tribunal/registry only)', async () => {
    const { service, prisma } = make({ isTribunal: true });
    prisma.witness.findUnique.mockResolvedValue({ id: 'w1', caseId: 'c1', status: WitnessStatus.CONFIRMED });
    const res = await service.recordOath(arbitrator, 'w1', { oath: OathKind.AFFIRMATION });
    expect(res.status).toBe(WitnessStatus.TESTIFIED);
    expect(res.oath).toBe(OathKind.AFFIRMATION);
  });

  it('lets a party raise an objection but ONLY the tribunal rule on it', async () => {
    const { service } = make({ isParty: true });
    await expect(service.raiseObjection(party, 'c1', { targetType: EvidenceTargetType.DOCUMENT, targetId: 'd1', ground: 'AUTHENTICITY' })).resolves.toMatchObject({ ground: 'AUTHENTICITY' });

    const partyRules = make({ isParty: true, isTribunal: false });
    partyRules.prisma.evidenceObjection.findUnique.mockResolvedValue({ id: 'o1', caseId: 'c1' });
    await expect(partyRules.service.ruleObjection(party, 'o1', { status: EvidenceObjectionStatus.UPHELD, ruling: 'x' })).rejects.toThrow();
  });

  it('rejects a ruling that leaves the objection in RAISED state', async () => {
    const { service, prisma } = make({ isTribunal: true });
    prisma.evidenceObjection.findUnique.mockResolvedValue({ id: 'o1', caseId: 'c1' });
    await expect(service.ruleObjection(arbitrator, 'o1', { status: EvidenceObjectionStatus.RAISED, ruling: 'x' })).rejects.toThrow();
  });

  it('records a tribunal ruling on an objection', async () => {
    const { service, prisma } = make({ isTribunal: true });
    prisma.evidenceObjection.findUnique.mockResolvedValue({ id: 'o1', caseId: 'c1' });
    const res = await service.ruleObjection(arbitrator, 'o1', { status: EvidenceObjectionStatus.DISMISSED, ruling: 'Authentic on its face' });
    expect(res.status).toBe(EvidenceObjectionStatus.DISMISSED);
    expect(res.ruledById).toBe('a1');
  });
});

describe('ExpertsService', () => {
  function make(membership: Record<string, unknown>) {
    const prisma = prismaStub();
    const audit = { record: jest.fn() };
    const access = { assertCanAccessCase: jest.fn().mockResolvedValue(membership) };
    return { service: new ExpertsService(prisma as never, audit as never, access as never), prisma };
  }

  it('requires the tribunal to appoint a tribunal expert', async () => {
    const partyOnly = make({ isParty: true, isTribunal: false });
    await expect(partyOnly.service.addExpert(party, 'c1', { appointment: ExpertAppointment.TRIBUNAL_APPOINTED, fullName: 'Dr X', expertise: 'Quantum' })).rejects.toThrow();

    const tribunal = make({ isTribunal: true });
    const res = await tribunal.service.addExpert(arbitrator, 'c1', { appointment: ExpertAppointment.TRIBUNAL_APPOINTED, fullName: 'Dr X', expertise: 'Quantum' });
    expect(res.status).toBe(ExpertStatus.APPOINTED);
    expect(res.partyId).toBeNull();
  });

  it('lets a party appoint its own expert (PROPOSED)', async () => {
    const { service } = make({ isParty: true });
    const res = await service.addExpert(party, 'c1', { appointment: ExpertAppointment.PARTY_APPOINTED, fullName: 'Dr Y', expertise: 'Delay', partyId: 'pty1' });
    expect(res.status).toBe(ExpertStatus.PROPOSED);
  });

  it('files a report (version increments) and marks the expert REPORTED', async () => {
    const { service, prisma } = make({ isParty: true });
    prisma.expert.findUnique.mockResolvedValue({ id: 'e1', caseId: 'c1' });
    const res = await service.submitReport(party, 'e1', { title: 'Reply report', kind: ExpertReportKind.REPLY_REPORT });
    expect(res.version).toBe(2); // count was 1
    expect(prisma.expert.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: ExpertStatus.REPORTED } }));
  });
});
