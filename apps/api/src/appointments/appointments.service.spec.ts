import { BadRequestException } from '@nestjs/common';
import {
  AppointmentMethod,
  AppointmentStatus,
  ChallengeStatus,
  TribunalComposition,
  TribunalMemberStatus,
  TribunalRole,
  VacancyReason,
} from '@prisma/client';
import { AppointmentsService } from './appointments.service';
import { AuthUser } from '../auth/types';

const registrar = { id: 'reg1', email: 'reg@x.com', roles: [], permissions: [] } as unknown as AuthUser;
const arbitrator = { id: 'arbU', email: 'arb@x.com', roles: [], permissions: [] } as unknown as AuthUser;

function makePrisma(over: Record<string, unknown> = {}) {
  const base: Record<string, unknown> = {
    case: { findUnique: jest.fn().mockResolvedValue({ reference: 'GAAP-1', stage: 'TRIBUNAL_APPOINTMENT_PENDING' }), update: jest.fn() },
    caseStatusHistory: { create: jest.fn() },
    arbitratorProfile: {
      findUnique: jest.fn().mockResolvedValue({ id: 'prof1', approvalStatus: 'APPROVED', userId: 'arbU' }),
      findFirst: jest.fn().mockResolvedValue({ id: 'prof1' }),
    },
    appointmentInvitation: {
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => ({ id: 'inv1', ...data })),
      findUnique: jest.fn(),
      update: jest.fn(({ data }: { data: Record<string, unknown> }) => ({ id: 'inv1', ...data })),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    arbitratorChallenge: {
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => ({ id: 'ch1', ...data })),
      findUnique: jest.fn(),
      update: jest.fn(({ data }: { data: Record<string, unknown> }) => ({ id: 'ch1', ...data })),
    },
    tribunal: { findUnique: jest.fn(), upsert: jest.fn().mockResolvedValue({ id: 'trib1' }), update: jest.fn() },
    tribunalMember: { upsert: jest.fn(), update: jest.fn(), findUnique: jest.fn() },
    caseTeamMember: { upsert: jest.fn(), updateMany: jest.fn() },
    conflictDisclosure: { create: jest.fn(({ data }: { data: Record<string, unknown> }) => ({ id: 'cd1', ...data })), findFirst: jest.fn() },
    userProfile: { findUnique: jest.fn().mockResolvedValue({ displayName: 'Arb' }) },
  };
  Object.assign(base, over);
  (base as { $transaction: unknown }).$transaction = jest.fn((arg: unknown) =>
    typeof arg === 'function' ? (arg as (tx: unknown) => unknown)(base) : Promise.all(arg as Promise<unknown>[]),
  );
  return base;
}

function make(over: Record<string, unknown> = {}, membership: Record<string, unknown> = {}) {
  const prisma = makePrisma(over);
  const audit = { record: jest.fn() };
  const access = {
    assertCanAccessCase: jest.fn().mockResolvedValue(membership),
    getMembership: jest.fn().mockResolvedValue(membership),
  };
  const notifications = { dispatch: jest.fn().mockResolvedValue(undefined), notifyCaseMembers: jest.fn().mockResolvedValue(undefined) };
  const compliance = { rescreenForEvent: jest.fn().mockResolvedValue(undefined), assertCaseClearedToProceed: jest.fn().mockResolvedValue(undefined) };
  const service = new AppointmentsService(prisma as never, audit as never, access as never, notifications as never, compliance as never);
  return { service, prisma, audit, notifications, compliance };
}

const activeMember = (role: TribunalRole, over: Record<string, unknown> = {}) => ({
  id: 'm-' + role, tribunalId: 'trib1', arbitratorUserId: 'u-' + role, role, status: TribunalMemberStatus.ACTIVE, acceptedAt: new Date(), ...over,
});

describe('AppointmentsService — default appointment & lifecycle', () => {
  it('makes an institution default appointment on party silence/refusal', async () => {
    const { service, prisma, audit, notifications } = make();
    const inv = await service.defaultAppoint(registrar, 'c1', { arbitratorId: 'prof1', proposedRole: TribunalRole.CO_ARBITRATOR, nominatedBy: undefined, reason: 'Respondent failed to nominate' }) as { appointmentMethod: string };
    expect(inv.appointmentMethod).toBe(AppointmentMethod.INSTITUTION_DEFAULT);
    expect((prisma.appointmentInvitation as { create: jest.Mock }).create).toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'APPOINTMENT_DEFAULTED' }));
    expect(notifications.notifyCaseMembers).toHaveBeenCalledWith(expect.objectContaining({ key: 'DEFAULT_APPOINTMENT' }));
  });

  it('falls back to an institution chair appointment when co-arbitrators cannot agree', async () => {
    const { service } = make();
    const inv = await service.defaultAppoint(registrar, 'c1', { arbitratorId: 'prof1', proposedRole: TribunalRole.CHAIR, reason: 'Co-arbitrators failed to nominate a chair' }) as { proposedRole: string; appointmentMethod: string };
    expect(inv.proposedRole).toBe(TribunalRole.CHAIR);
    expect(inv.appointmentMethod).toBe(AppointmentMethod.INSTITUTION_DEFAULT);
  });

  it('expires invitations whose response window has elapsed (silence/non-response)', async () => {
    const { service, prisma } = make({ appointmentInvitation: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) } });
    await expect(service.expireStaleInvitations()).resolves.toEqual({ expired: 2 });
    expect((prisma.appointmentInvitation as { updateMany: jest.Mock }).updateMany).toHaveBeenCalled();
  });

  it('reminds an arbitrator while a response is outstanding, but not after', async () => {
    const open = make({ appointmentInvitation: { findUnique: jest.fn().mockResolvedValue({ id: 'inv1', caseId: 'c1', status: AppointmentStatus.INVITED, expiresAt: new Date(), arbitrator: { userId: 'arbU' } }), update: jest.fn(({ data }) => ({ id: 'inv1', reminderCount: 1, ...data })) } });
    await expect(open.service.sendReminder(registrar, 'inv1')).resolves.toBeDefined();
    expect(open.notifications.dispatch).toHaveBeenCalledWith(expect.objectContaining({ key: 'APPOINTMENT_REMINDER' }));

    const answered = make({ appointmentInvitation: { findUnique: jest.fn().mockResolvedValue({ id: 'inv1', caseId: 'c1', status: AppointmentStatus.ACCEPTED, arbitrator: { userId: 'arbU' } }) } });
    await expect(answered.service.sendReminder(registrar, 'inv1')).rejects.toThrow(BadRequestException);
  });
});

describe('AppointmentsService — chair nomination', () => {
  it('requires both co-arbitrators before a chair can be nominated', async () => {
    const oneCoArb = make({ tribunal: { findUnique: jest.fn().mockResolvedValue({ id: 'trib1', members: [activeMember(TribunalRole.CO_ARBITRATOR)] }) } }, { caseRoles: ['TRIBUNAL_MEMBER'] });
    await expect(oneCoArb.service.nominateChair(arbitrator, 'c1', { arbitratorId: 'prof1' })).rejects.toThrow(BadRequestException);
  });

  it('lets two co-arbitrators nominate a chair (CO_ARBITRATOR_NOMINATION)', async () => {
    const { service } = make(
      { tribunal: { findUnique: jest.fn().mockResolvedValue({ id: 'trib1', members: [activeMember(TribunalRole.CO_ARBITRATOR, { id: 'a' }), activeMember(TribunalRole.CO_ARBITRATOR, { id: 'b' })] }) } },
      { caseRoles: ['TRIBUNAL_MEMBER'] },
    );
    const inv = await service.nominateChair(arbitrator, 'c1', { arbitratorId: 'prof1' }) as { proposedRole: string; appointmentMethod: string };
    expect(inv.proposedRole).toBe(TribunalRole.CHAIR);
    expect(inv.appointmentMethod).toBe(AppointmentMethod.CO_ARBITRATOR_NOMINATION);
  });
});

describe('AppointmentsService — acceptance requires a conflict disclosure', () => {
  const invitation = { id: 'inv1', arbitratorId: 'prof1', caseId: 'c1', status: AppointmentStatus.CONFLICT_CHECK, proposedRole: TribunalRole.SOLE, nominatedBy: null };

  it('rejects acceptance when no conflict disclosure is on file', async () => {
    const { service } = make({ appointmentInvitation: { findUnique: jest.fn().mockResolvedValue(invitation), update: jest.fn() }, conflictDisclosure: { findFirst: jest.fn().mockResolvedValue(null) } });
    await expect(service.respond(arbitrator, 'inv1', { accept: true, feeAccepted: true, availabilityConfirmed: true })).rejects.toThrow(/disclosure/i);
  });

  it('accepts once a disclosure exists and seats the member', async () => {
    const { service, prisma } = make({ appointmentInvitation: { findUnique: jest.fn().mockResolvedValue(invitation), update: jest.fn() }, conflictDisclosure: { findFirst: jest.fn().mockResolvedValue({ id: 'cd1' }) } });
    const res = await service.respond(arbitrator, 'inv1', { accept: true, feeAccepted: true, availabilityConfirmed: true }) as { accepted: boolean };
    expect(res.accepted).toBe(true);
    expect((prisma.tribunalMember as { upsert: jest.Mock }).upsert).toHaveBeenCalled();
    expect((prisma.caseTeamMember as { upsert: jest.Mock }).upsert).toHaveBeenCalled();
  });
});

describe('AppointmentsService — constitution gates', () => {
  it('constitutes a sole tribunal with exactly one accepted sole arbitrator', async () => {
    const { service } = make({ tribunal: { findUnique: jest.fn().mockResolvedValue({ id: 'trib1', composition: TribunalComposition.SOLE, members: [activeMember(TribunalRole.SOLE)] }), update: jest.fn() } });
    await expect(service.constitute(registrar, 'c1')).resolves.toMatchObject({ constituted: true });
  });

  it('refuses to constitute an incomplete three-member tribunal', async () => {
    const { service } = make({ tribunal: { findUnique: jest.fn().mockResolvedValue({ id: 'trib1', composition: TribunalComposition.THREE_MEMBER, members: [activeMember(TribunalRole.CO_ARBITRATOR, { id: 'a' }), activeMember(TribunalRole.CO_ARBITRATOR, { id: 'b' })] }) } });
    await expect(service.constitute(registrar, 'c1')).rejects.toThrow(/not complete/i);
  });

  it('constitutes a complete three-member tribunal (chair + two co-arbitrators)', async () => {
    const members = [activeMember(TribunalRole.CHAIR), activeMember(TribunalRole.CO_ARBITRATOR, { id: 'a' }), activeMember(TribunalRole.CO_ARBITRATOR, { id: 'b' })];
    const { service } = make({ tribunal: { findUnique: jest.fn().mockResolvedValue({ id: 'trib1', composition: TribunalComposition.THREE_MEMBER, members }), update: jest.fn() } });
    await expect(service.constitute(registrar, 'c1')).resolves.toMatchObject({ constituted: true });
  });

  it('suspends constitution while a challenge is pending', async () => {
    const { service } = make({
      tribunal: { findUnique: jest.fn().mockResolvedValue({ id: 'trib1', composition: TribunalComposition.SOLE, members: [activeMember(TribunalRole.SOLE)] }) },
      arbitratorChallenge: { count: jest.fn().mockResolvedValue(1) },
    });
    await expect(service.constitute(registrar, 'c1')).rejects.toThrow(/challenge/i);
  });

  it('refuses to constitute while a compliance hold is active', async () => {
    const { service, compliance } = make({ tribunal: { findUnique: jest.fn().mockResolvedValue({ id: 'trib1', composition: TribunalComposition.SOLE, members: [activeMember(TribunalRole.SOLE)] }) } });
    (compliance.assertCaseClearedToProceed as jest.Mock).mockRejectedValueOnce(new BadRequestException('hold'));
    await expect(service.constitute(registrar, 'c1')).rejects.toThrow(BadRequestException);
  });
});

describe('AppointmentsService — vacancies, replacement & challenges', () => {
  it('records a resignation vacancy, strips access, and de-constitutes', async () => {
    const { service, prisma, notifications } = make({
      tribunalMember: { findUnique: jest.fn().mockResolvedValue({ id: 'm1', tribunalId: 'trib1', arbitratorUserId: 'u1', status: TribunalMemberStatus.ACTIVE, tribunal: { caseId: 'c1' } }), update: jest.fn() },
    });
    await service.recordVacancy(registrar, 'm1', { reason: VacancyReason.RESIGNATION });
    expect((prisma.tribunalMember as { update: jest.Mock }).update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: TribunalMemberStatus.RESIGNED }) }));
    expect((prisma.caseTeamMember as { updateMany: jest.Mock }).updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { active: false } }));
    expect((prisma.tribunal as { update: jest.Mock }).update).toHaveBeenCalledWith(expect.objectContaining({ data: { constituted: false, constitutedAt: null } }));
    expect(notifications.notifyCaseMembers).toHaveBeenCalledWith(expect.objectContaining({ key: 'TRIBUNAL_VACANCY' }));
  });

  it('invites a replacement arbitrator linked to the vacated seat', async () => {
    const { service, audit } = make();
    const inv = await service.replaceMember(registrar, 'c1', { vacatedUserId: 'u1', arbitratorId: 'prof1', proposedRole: TribunalRole.CO_ARBITRATOR }) as { fillsVacancyUserId: string };
    expect(inv.fillsVacancyUserId).toBe('u1');
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'ARBITRATOR_REPLACEMENT_INVITED' }));
  });

  it('UPHELD challenge vacates the member and withdraws their invitations', async () => {
    const { service, prisma, notifications } = make({
      arbitratorChallenge: { findUnique: jest.fn().mockResolvedValue({ id: 'ch1', caseId: 'c1', challengedArbitratorUserId: 'u1', decidedAt: null }), update: jest.fn(({ data }) => ({ id: 'ch1', ...data })) },
      tribunal: { findUnique: jest.fn().mockResolvedValue({ id: 'trib1', members: [{ id: 'm1', tribunalId: 'trib1', arbitratorUserId: 'u1', status: TribunalMemberStatus.ACTIVE }] }), update: jest.fn() },
      tribunalMember: { update: jest.fn() },
    });
    await service.decideChallenge(registrar, 'ch1', { status: ChallengeStatus.UPHELD });
    expect((prisma.tribunalMember as { update: jest.Mock }).update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: TribunalMemberStatus.REMOVED }) }));
    expect((prisma.appointmentInvitation as { updateMany: jest.Mock }).updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: AppointmentStatus.WITHDRAWN } }));
    expect(notifications.notifyCaseMembers).toHaveBeenCalledWith(expect.objectContaining({ key: 'CHALLENGE_DECIDED', vars: expect.objectContaining({ outcome: 'upheld' }) }));
  });

  it('DISMISSED challenge resumes the workflow without a vacancy', async () => {
    const { service, prisma } = make({
      arbitratorChallenge: { findUnique: jest.fn().mockResolvedValue({ id: 'ch1', caseId: 'c1', challengedArbitratorUserId: 'u1', decidedAt: null }), update: jest.fn(({ data }) => ({ id: 'ch1', ...data })) },
      tribunalMember: { update: jest.fn() },
    });
    await service.decideChallenge(registrar, 'ch1', { status: ChallengeStatus.DISMISSED });
    expect((prisma.tribunalMember as { update: jest.Mock }).update).not.toHaveBeenCalled();
  });
});
