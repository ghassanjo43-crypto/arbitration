import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AppointmentMethod,
  AppointmentStatus,
  CaseRole,
  CaseStage,
  ChallengeStatus,
  ScreeningSubjectType,
  TribunalComposition,
  TribunalMemberStatus,
  TribunalRole,
  VacancyReason,
} from '@prisma/client';
import { Permission, CaseRole as SharedCaseRole } from '@gaap/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CaseAccessService } from '../authz/case-access.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ComplianceService } from '../compliance/compliance.service';
import { AuthUser } from '../auth/types';
import {
  ConflictDisclosureDto,
  DecideChallengeDto,
  DefaultAppointDto,
  InviteArbitratorDto,
  NominateChairDto,
  RaiseChallengeDto,
  RecordVacancyDto,
  ReplaceMemberDto,
  RespondToInvitationDto,
} from './dto';

/** Maps a tribunal seat to the case-team role that unlocks deliberation access. */
function caseRoleForTribunalRole(role: TribunalRole): CaseRole {
  switch (role) {
    case TribunalRole.CHAIR:
    case TribunalRole.SOLE:
      return CaseRole.TRIBUNAL_CHAIR;
    case TribunalRole.SECRETARY:
      return CaseRole.TRIBUNAL_SECRETARY;
    case TribunalRole.CO_ARBITRATOR:
    default:
      return CaseRole.TRIBUNAL_MEMBER;
  }
}

const TRIBUNAL_CASE_ROLES = [CaseRole.TRIBUNAL_CHAIR, CaseRole.TRIBUNAL_MEMBER, CaseRole.TRIBUNAL_SECRETARY];

function memberStatusForVacancy(reason: VacancyReason): TribunalMemberStatus {
  switch (reason) {
    case VacancyReason.RESIGNATION: return TribunalMemberStatus.RESIGNED;
    case VacancyReason.INCAPACITY: return TribunalMemberStatus.INCAPACITATED;
    case VacancyReason.DEATH: return TribunalMemberStatus.DECEASED;
    case VacancyReason.REMOVAL:
    case VacancyReason.CHALLENGE_UPHELD:
    default: return TribunalMemberStatus.REMOVED;
  }
}

const INVITATION_TTL_MS = 14 * 86400000;

/**
 * Tribunal appointment workflow with due-process hardening: invite → conflict
 * disclosure → accept/decline → constitute, plus reminders, expiry, default
 * (institution) appointment on party silence/refusal, co-arbitrator chair
 * nomination with a fallback, vacancies (resignation/removal/incapacity/death),
 * replacement, and challenge routing. Acceptance creates the tribunal
 * CaseTeamMember row that is the ONLY way a user gains deliberation access.
 */
@Injectable()
export class AppointmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: CaseAccessService,
    private readonly notifications: NotificationsService,
    private readonly compliance: ComplianceService,
  ) {}

  private async caseRef(caseId: string): Promise<string> {
    const c = await this.prisma.case.findUnique({ where: { id: caseId }, select: { reference: true } });
    return c?.reference ?? caseId;
  }

  private async createInvitation(
    actor: AuthUser,
    caseId: string,
    arbitratorId: string,
    proposedRole: TribunalRole,
    method: AppointmentMethod,
    opts: { nominatedBy?: import('@prisma/client').PartySide; fillsVacancyUserId?: string } = {},
  ) {
    const arbitrator = await this.prisma.arbitratorProfile.findUnique({
      where: { id: arbitratorId },
      select: { id: true, approvalStatus: true, userId: true },
    });
    if (!arbitrator) throw new NotFoundException('Arbitrator not found.');
    if (arbitrator.approvalStatus !== 'APPROVED') {
      throw new BadRequestException('Only approved arbitrators may be invited.');
    }
    const invitation = await this.prisma.appointmentInvitation.create({
      data: {
        caseId,
        arbitratorId,
        proposedRole,
        nominatedBy: opts.nominatedBy,
        appointmentMethod: method,
        fillsVacancyUserId: opts.fillsVacancyUserId,
        status: AppointmentStatus.INVITED,
        expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
      },
    });
    return { invitation, arbitratorUserId: arbitrator.userId };
  }

  /** Registrar action (guarded by APPOINTMENT_MANAGE at the controller). */
  async invite(actor: AuthUser, caseId: string, dto: InviteArbitratorDto) {
    const ref = await this.caseRef(caseId);
    const { invitation, arbitratorUserId } = await this.createInvitation(
      actor, caseId, dto.arbitratorId, dto.proposedRole,
      dto.appointmentMethod ?? AppointmentMethod.PARTY_NOMINATION,
      { nominatedBy: dto.nominatedBy },
    );
    await this.advanceStage(caseId, CaseStage.TRIBUNAL_APPOINTMENT_PENDING, actor.id);
    await this.audit.record({
      userId: actor.id, action: 'APPOINTMENT_INVITED', entityType: 'AppointmentInvitation', entityId: invitation.id, caseId,
      metadata: { arbitratorId: dto.arbitratorId, role: dto.proposedRole, method: invitation.appointmentMethod },
    });
    if (arbitratorUserId) {
      await this.notifications.dispatch({
        userId: arbitratorUserId, key: 'APPOINTMENT_INVITATION',
        vars: { caseRef: ref, role: String(dto.proposedRole).replaceAll('_', ' ') }, link: '/app',
      }).catch(() => undefined);
    }
    return invitation;
  }

  /**
   * Default (institution) appointment when a party is silent or refuses to
   * nominate, or when co-arbitrators fail to agree a chair. Pass proposedRole
   * CHAIR for the chair-selection fallback.
   */
  async defaultAppoint(actor: AuthUser, caseId: string, dto: DefaultAppointDto) {
    const ref = await this.caseRef(caseId);
    const { invitation, arbitratorUserId } = await this.createInvitation(
      actor, caseId, dto.arbitratorId, dto.proposedRole, AppointmentMethod.INSTITUTION_DEFAULT,
      { nominatedBy: dto.nominatedBy },
    );
    await this.advanceStage(caseId, CaseStage.TRIBUNAL_APPOINTMENT_PENDING, actor.id);
    await this.audit.record({
      userId: actor.id, action: 'APPOINTMENT_DEFAULTED', entityType: 'AppointmentInvitation', entityId: invitation.id, caseId,
      metadata: { arbitratorId: dto.arbitratorId, role: dto.proposedRole, reason: dto.reason },
    });
    await this.notifications.notifyCaseMembers({ caseId, key: 'DEFAULT_APPOINTMENT', vars: { caseRef: ref }, link: `/app/cases/${caseId}`, partyOnly: true });
    if (arbitratorUserId) {
      await this.notifications.dispatch({ userId: arbitratorUserId, key: 'APPOINTMENT_INVITATION', vars: { caseRef: ref, role: String(dto.proposedRole).replaceAll('_', ' ') }, link: '/app' }).catch(() => undefined);
    }
    return invitation;
  }

  /**
   * A presiding arbitrator (chair) nominated by the two party-appointed
   * co-arbitrators. Requires both co-arbitrators to be in place; if they cannot
   * agree, the appointing authority uses defaultAppoint(role=CHAIR).
   */
  async nominateChair(actor: AuthUser, caseId: string, dto: NominateChairDto) {
    const membership = await this.access.getMembership(actor, caseId);
    const isCoArbitrator = membership.caseRoles.includes(SharedCaseRole.TRIBUNAL_MEMBER);
    if (!isCoArbitrator && !actor.permissions.includes(Permission.APPOINTMENT_MANAGE)) {
      throw new ForbiddenException('Only a co-arbitrator or the appointing authority may nominate the chair.');
    }
    const tribunal = await this.prisma.tribunal.findUnique({ where: { caseId }, include: { members: true } });
    if (!tribunal) throw new BadRequestException('No tribunal exists for this case yet.');
    const active = tribunal.members.filter((m) => m.status === TribunalMemberStatus.ACTIVE);
    const coArbs = active.filter((m) => m.role === TribunalRole.CO_ARBITRATOR && m.acceptedAt);
    if (coArbs.length < 2) {
      throw new BadRequestException('Both co-arbitrators must be appointed before a chair can be nominated.');
    }
    if (active.some((m) => m.role === TribunalRole.CHAIR)) {
      throw new BadRequestException('A chair is already in place.');
    }
    const ref = await this.caseRef(caseId);
    const { invitation, arbitratorUserId } = await this.createInvitation(
      actor, caseId, dto.arbitratorId, TribunalRole.CHAIR, AppointmentMethod.CO_ARBITRATOR_NOMINATION,
    );
    await this.audit.record({ userId: actor.id, action: 'CHAIR_NOMINATED', entityType: 'AppointmentInvitation', entityId: invitation.id, caseId, metadata: { arbitratorId: dto.arbitratorId } });
    await this.notifications.notifyCaseMembers({ caseId, key: 'CHAIR_NOMINATION', vars: { caseRef: ref }, link: `/app/cases/${caseId}`, partyOnly: true });
    if (arbitratorUserId) {
      await this.notifications.dispatch({ userId: arbitratorUserId, key: 'APPOINTMENT_INVITATION', vars: { caseRef: ref, role: 'chair' }, link: '/app' }).catch(() => undefined);
    }
    return invitation;
  }

  /** Send a reminder for an outstanding invitation (APPOINTMENT_MANAGE). */
  async sendReminder(actor: AuthUser, invitationId: string) {
    const invitation = await this.prisma.appointmentInvitation.findUnique({
      where: { id: invitationId }, include: { arbitrator: { select: { userId: true } } },
    });
    if (!invitation) throw new NotFoundException('Invitation not found.');
    if (invitation.status !== AppointmentStatus.INVITED && invitation.status !== AppointmentStatus.CONFLICT_CHECK) {
      throw new BadRequestException('This invitation has no outstanding response to remind about.');
    }
    const updated = await this.prisma.appointmentInvitation.update({
      where: { id: invitationId },
      data: { reminderCount: { increment: 1 }, lastReminderAt: new Date() },
    });
    await this.audit.record({ userId: actor.id, action: 'APPOINTMENT_REMINDER_SENT', entityType: 'AppointmentInvitation', entityId: invitationId, caseId: invitation.caseId, metadata: { reminderCount: updated.reminderCount } });
    if (invitation.arbitrator.userId) {
      const ref = await this.caseRef(invitation.caseId);
      const due = invitation.expiresAt ? invitation.expiresAt.toISOString().slice(0, 10) : 'the applicable deadline';
      await this.notifications.dispatch({ userId: invitation.arbitrator.userId, key: 'APPOINTMENT_REMINDER', vars: { caseRef: ref, dueDate: due }, link: '/app' }).catch(() => undefined);
    }
    return updated;
  }

  /**
   * Expire invitations whose response window has passed (party silence / arbitrator
   * non-response). Suitable for a scheduled job; returns how many were expired.
   */
  async expireStaleInvitations(): Promise<{ expired: number }> {
    const res = await this.prisma.appointmentInvitation.updateMany({
      where: { status: { in: [AppointmentStatus.INVITED, AppointmentStatus.CONFLICT_CHECK] }, expiresAt: { lt: new Date() } },
      data: { status: AppointmentStatus.EXPIRED },
    });
    if (res.count > 0) {
      await this.audit.record({ action: 'APPOINTMENT_EXPIRED_SWEEP', entityType: 'AppointmentInvitation', metadata: { count: res.count } });
    }
    return { expired: res.count };
  }

  /** Invitations addressed to the signed-in arbitrator. */
  async myInvitations(user: AuthUser) {
    const profile = await this.prisma.arbitratorProfile.findUnique({ where: { userId: user.id }, select: { id: true } });
    if (!profile) return [];
    return this.prisma.appointmentInvitation.findMany({
      where: { arbitratorId: profile.id },
      include: { case: { select: { reference: true, title: true, stage: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async assertOwnInvitation(user: AuthUser, invitationId: string) {
    const profile = await this.prisma.arbitratorProfile.findUnique({ where: { userId: user.id }, select: { id: true } });
    if (!profile) throw new ForbiddenException('Only arbitrators may act on appointment invitations.');
    const invitation = await this.prisma.appointmentInvitation.findUnique({ where: { id: invitationId } });
    if (!invitation || invitation.arbitratorId !== profile.id) {
      throw new NotFoundException('Invitation not found.');
    }
    return { invitation, profileId: profile.id };
  }

  async submitConflictDisclosure(user: AuthUser, invitationId: string, dto: ConflictDisclosureDto) {
    const { invitation, profileId } = await this.assertOwnInvitation(user, invitationId);
    if (invitation.status === AppointmentStatus.EXPIRED || invitation.status === AppointmentStatus.WITHDRAWN) {
      throw new BadRequestException('This invitation is no longer open.');
    }

    const disclosure = await this.prisma.conflictDisclosure.create({
      data: {
        caseId: invitation.caseId,
        arbitratorId: profileId,
        hasConflict: dto.hasConflict,
        disclosureText: dto.disclosureText,
        independenceDeclared: dto.independenceDeclared,
        impartialityDeclared: dto.impartialityDeclared,
      },
    });
    await this.prisma.appointmentInvitation.update({ where: { id: invitationId }, data: { status: AppointmentStatus.CONFLICT_CHECK } });
    await this.advanceStage(invitation.caseId, CaseStage.CONFLICT_CHECK, user.id);
    await this.audit.record({ userId: user.id, action: 'CONFLICT_DISCLOSURE_SUBMITTED', entityType: 'ConflictDisclosure', entityId: disclosure.id, caseId: invitation.caseId, metadata: { hasConflict: dto.hasConflict } });

    const ref = await this.caseRef(invitation.caseId);
    await this.notifications.notifyCaseMembers({ caseId: invitation.caseId, key: 'CONFLICT_DISCLOSURE', vars: { caseRef: ref }, link: `/app/cases/${invitation.caseId}`, partyOnly: true });
    return disclosure;
  }

  async respond(user: AuthUser, invitationId: string, dto: RespondToInvitationDto) {
    const { invitation, profileId } = await this.assertOwnInvitation(user, invitationId);
    if (invitation.status === AppointmentStatus.ACCEPTED || invitation.status === AppointmentStatus.DECLINED) {
      throw new BadRequestException('This invitation has already been answered.');
    }
    if (invitation.status === AppointmentStatus.EXPIRED || invitation.status === AppointmentStatus.WITHDRAWN) {
      throw new BadRequestException('This invitation is no longer open.');
    }

    if (!dto.accept) {
      const declined = await this.prisma.appointmentInvitation.update({
        where: { id: invitationId },
        data: { status: AppointmentStatus.DECLINED, respondedAt: new Date(), declineReason: dto.declineReason },
      });
      await this.audit.record({ userId: user.id, action: 'APPOINTMENT_DECLINED', entityType: 'AppointmentInvitation', entityId: invitationId, caseId: invitation.caseId, metadata: { reason: dto.declineReason } });
      return declined;
    }

    if (!dto.feeAccepted || !dto.availabilityConfirmed) {
      throw new BadRequestException('Acceptance requires fee acceptance and availability confirmation.');
    }
    // Due process: a conflict disclosure must be on file before acceptance.
    const disclosure = await this.prisma.conflictDisclosure.findFirst({
      where: { caseId: invitation.caseId, arbitratorId: profileId },
      orderBy: { createdAt: 'desc' },
    });
    if (!disclosure) {
      throw new BadRequestException('A conflict-of-interest disclosure must be filed before accepting an appointment.');
    }

    const caseRole = caseRoleForTribunalRole(invitation.proposedRole);
    const isSole = invitation.proposedRole === TribunalRole.SOLE;

    await this.prisma.$transaction(async (tx) => {
      const tribunal = await tx.tribunal.upsert({
        where: { caseId: invitation.caseId },
        update: {},
        create: { caseId: invitation.caseId, composition: isSole ? TribunalComposition.SOLE : TribunalComposition.THREE_MEMBER },
      });
      await tx.tribunalMember.upsert({
        where: { tribunalId_arbitratorUserId: { tribunalId: tribunal.id, arbitratorUserId: user.id } },
        update: { acceptedAt: new Date(), status: TribunalMemberStatus.ACTIVE, role: invitation.proposedRole, nominatedBy: invitation.nominatedBy ?? undefined },
        create: { tribunalId: tribunal.id, arbitratorUserId: user.id, role: invitation.proposedRole, nominatedBy: invitation.nominatedBy ?? undefined, acceptedAt: new Date() },
      });
      await tx.caseTeamMember.upsert({
        where: { caseId_userId_caseRole: { caseId: invitation.caseId, userId: user.id, caseRole } },
        update: { active: true },
        create: { caseId: invitation.caseId, userId: user.id, caseRole, addedBy: user.id },
      });
      await tx.appointmentInvitation.update({
        where: { id: invitationId },
        data: { status: AppointmentStatus.ACCEPTED, respondedAt: new Date(), feeAccepted: true, availabilityConfirmed: true },
      });
    });

    await this.audit.record({
      userId: user.id, action: 'APPOINTMENT_ACCEPTED', entityType: 'AppointmentInvitation', entityId: invitationId, caseId: invitation.caseId,
      metadata: { role: invitation.proposedRole, fillsVacancy: invitation.fillsVacancyUserId ?? null },
    });

    // Screen the accepting arbitrator (best-effort; a match raises a hold and
    // routes to compliance review without altering the acceptance record).
    const profile = await this.prisma.userProfile.findUnique({ where: { userId: user.id }, select: { displayName: true } });
    await this.compliance.rescreenForEvent({
      event: 'ARBITRATOR_APPOINTMENT', caseId: invitation.caseId, requestedById: user.id,
      subjects: [{ subjectType: ScreeningSubjectType.ARBITRATOR, subjectId: user.id, subjectName: profile?.displayName ?? user.email, caseId: invitation.caseId }],
    });
    return { accepted: true, caseId: invitation.caseId, caseRole };
  }

  /**
   * Registrar confirms constitution. Only succeeds when the required seats are
   * filled by ACTIVE, accepted members, no challenge is pending, and the case is
   * not under a compliance hold.
   */
  async constitute(actor: AuthUser, caseId: string) {
    const tribunal = await this.prisma.tribunal.findUnique({ where: { caseId }, include: { members: true } });
    if (!tribunal) throw new BadRequestException('No tribunal exists for this case yet.');

    // A pending challenge suspends constitution.
    const openChallenges = await this.prisma.arbitratorChallenge.count({
      where: { caseId, status: { in: [ChallengeStatus.SUBMITTED, ChallengeStatus.UNDER_REVIEW] } },
    });
    if (openChallenges > 0) {
      throw new BadRequestException('Constitution is suspended while an arbitrator challenge is pending.');
    }
    // A compliance hold freezes constitution until cleared.
    await this.compliance.assertCaseClearedToProceed(caseId);

    const active = tribunal.members.filter((m) => m.status === TribunalMemberStatus.ACTIVE && m.acceptedAt);
    if (tribunal.composition === TribunalComposition.SOLE) {
      if (!(active.length === 1 && active[0].role === TribunalRole.SOLE)) {
        throw new BadRequestException('A sole-arbitrator tribunal requires exactly one accepted sole arbitrator.');
      }
    } else {
      const chairs = active.filter((m) => m.role === TribunalRole.CHAIR);
      const coArbs = active.filter((m) => m.role === TribunalRole.CO_ARBITRATOR);
      if (chairs.length !== 1 || coArbs.length !== 2) {
        throw new BadRequestException(`Tribunal not complete: a three-member tribunal needs two co-arbitrators and one chair (have ${coArbs.length} co-arbitrator(s), ${chairs.length} chair).`);
      }
    }

    await this.prisma.tribunal.update({ where: { id: tribunal.id }, data: { constituted: true, constitutedAt: new Date() } });
    await this.advanceStage(caseId, CaseStage.TRIBUNAL_CONSTITUTED, actor.id);
    await this.audit.record({ userId: actor.id, action: 'TRIBUNAL_CONSTITUTED', entityType: 'Tribunal', entityId: tribunal.id, caseId, metadata: { composition: tribunal.composition, members: active.length } });

    const ref = await this.caseRef(caseId);
    await this.notifications.notifyCaseMembers({ caseId, key: 'TRIBUNAL_CONSTITUTED', vars: { caseRef: ref }, link: `/app/cases/${caseId}`, partyOnly: true });
    return { constituted: true, members: active.length };
  }

  // ---- Vacancies & replacement (Ch7) ----

  /** Internal: vacate a seat, strip deliberation access, and de-constitute. */
  private async vacateMember(member: { id: string; tribunalId: string; arbitratorUserId: string }, caseId: string, reason: VacancyReason) {
    await this.prisma.$transaction([
      this.prisma.tribunalMember.update({ where: { id: member.id }, data: { status: memberStatusForVacancy(reason), vacatedAt: new Date(), vacancyReason: reason } }),
      this.prisma.caseTeamMember.updateMany({ where: { caseId, userId: member.arbitratorUserId, caseRole: { in: TRIBUNAL_CASE_ROLES } }, data: { active: false } }),
      this.prisma.tribunal.update({ where: { id: member.tribunalId }, data: { constituted: false, constitutedAt: null } }),
    ]);
  }

  /** Record a vacancy (resignation / removal / incapacity / death). */
  async recordVacancy(actor: AuthUser, memberId: string, dto: RecordVacancyDto) {
    const member = await this.prisma.tribunalMember.findUnique({
      where: { id: memberId }, include: { tribunal: { select: { caseId: true } } },
    });
    if (!member) throw new NotFoundException('Tribunal member not found.');
    if (member.status !== TribunalMemberStatus.ACTIVE) throw new BadRequestException('This seat is already vacant.');
    const caseId = member.tribunal.caseId;

    await this.vacateMember({ id: member.id, tribunalId: member.tribunalId, arbitratorUserId: member.arbitratorUserId }, caseId, dto.reason);
    await this.audit.record({ userId: actor.id, action: 'TRIBUNAL_VACANCY_RECORDED', entityType: 'TribunalMember', entityId: memberId, caseId, metadata: { reason: dto.reason, note: dto.note } });

    const ref = await this.caseRef(caseId);
    await this.notifications.notifyCaseMembers({ caseId, key: 'TRIBUNAL_VACANCY', vars: { caseRef: ref, reason: String(dto.reason).replaceAll('_', ' ').toLowerCase() }, link: `/app/cases/${caseId}`, partyOnly: true });
    return { vacated: true, memberId, reason: dto.reason };
  }

  /** Invite a replacement arbitrator to fill a vacated seat. */
  async replaceMember(actor: AuthUser, caseId: string, dto: ReplaceMemberDto) {
    const ref = await this.caseRef(caseId);
    const { invitation, arbitratorUserId } = await this.createInvitation(
      actor, caseId, dto.arbitratorId, dto.proposedRole,
      dto.appointmentMethod ?? AppointmentMethod.PARTY_NOMINATION,
      { nominatedBy: dto.nominatedBy, fillsVacancyUserId: dto.vacatedUserId },
    );
    await this.audit.record({ userId: actor.id, action: 'ARBITRATOR_REPLACEMENT_INVITED', entityType: 'AppointmentInvitation', entityId: invitation.id, caseId, metadata: { arbitratorId: dto.arbitratorId, role: dto.proposedRole, replaces: dto.vacatedUserId } });
    await this.notifications.notifyCaseMembers({ caseId, key: 'ARBITRATOR_REPLACEMENT', vars: { caseRef: ref }, link: `/app/cases/${caseId}`, partyOnly: true });
    if (arbitratorUserId) {
      await this.notifications.dispatch({ userId: arbitratorUserId, key: 'APPOINTMENT_INVITATION', vars: { caseRef: ref, role: String(dto.proposedRole).replaceAll('_', ' ') }, link: '/app' }).catch(() => undefined);
    }
    return invitation;
  }

  // ---- Arbitrator challenges (Ch8) ----

  async listChallenges(user: AuthUser, caseId: string) {
    await this.access.assertCanAccessCase(user, caseId);
    return this.prisma.arbitratorChallenge.findMany({ where: { caseId }, orderBy: { createdAt: 'asc' } });
  }

  /** A party challenges an arbitrator. The decision is for the authorised authority. */
  async raiseChallenge(user: AuthUser, caseId: string, dto: RaiseChallengeDto) {
    const m = await this.access.assertCanAccessCase(user, caseId);
    if (!m.isParty) throw new ForbiddenException('Only a party may challenge an arbitrator.');
    const challenge = await this.prisma.arbitratorChallenge.create({
      data: { caseId, challengedArbitratorUserId: dto.challengedArbitratorUserId, raisedBy: user.id, grounds: dto.grounds, status: ChallengeStatus.SUBMITTED },
    });
    await this.audit.record({ userId: user.id, action: 'CHALLENGE_RAISED', entityType: 'ArbitratorChallenge', entityId: challenge.id, caseId });

    const ref = await this.caseRef(caseId);
    await this.notifications.notifyCaseMembers({ caseId, key: 'CHALLENGE', vars: { caseRef: ref }, link: `/app/cases/${caseId}`, partyOnly: true });
    return challenge;
  }

  /**
   * The authorised appointing authority decides the challenge (guarded by
   * CHALLENGE_DECIDE). UPHELD vacates the challenged arbitrator's seat (which
   * de-constitutes the tribunal and opens the seat for replacement); DISMISSED
   * resumes the workflow.
   */
  async decideChallenge(user: AuthUser, challengeId: string, dto: DecideChallengeDto) {
    const challenge = await this.prisma.arbitratorChallenge.findUnique({ where: { id: challengeId } });
    if (!challenge) throw new NotFoundException('Challenge not found.');
    if (dto.status !== ChallengeStatus.UPHELD && dto.status !== ChallengeStatus.DISMISSED) {
      throw new BadRequestException('A decision must be UPHELD or DISMISSED.');
    }
    if (challenge.decidedAt) throw new BadRequestException('This challenge has already been decided.');

    const updated = await this.prisma.arbitratorChallenge.update({
      where: { id: challengeId },
      data: { status: dto.status, decidedBy: user.id, decidedAt: new Date(), decisionNote: dto.decisionNote },
    });

    if (dto.status === ChallengeStatus.UPHELD) {
      // Vacate the challenged seat and withdraw any open invitation for them.
      const tribunal = await this.prisma.tribunal.findUnique({ where: { caseId: challenge.caseId }, include: { members: true } });
      const member = tribunal?.members.find((m) => m.arbitratorUserId === challenge.challengedArbitratorUserId && m.status === TribunalMemberStatus.ACTIVE);
      if (member) {
        await this.vacateMember({ id: member.id, tribunalId: member.tribunalId, arbitratorUserId: member.arbitratorUserId }, challenge.caseId, VacancyReason.CHALLENGE_UPHELD);
      }
      const profile = await this.prisma.arbitratorProfile.findFirst({ where: { userId: challenge.challengedArbitratorUserId }, select: { id: true } });
      if (profile) {
        await this.prisma.appointmentInvitation.updateMany({
          where: { caseId: challenge.caseId, arbitratorId: profile.id, status: { in: [AppointmentStatus.INVITED, AppointmentStatus.CONFLICT_CHECK, AppointmentStatus.ACCEPTED] } },
          data: { status: AppointmentStatus.WITHDRAWN },
        });
      }
    }

    await this.audit.record({ userId: user.id, action: 'CHALLENGE_DECIDED', entityType: 'ArbitratorChallenge', entityId: challengeId, caseId: challenge.caseId, metadata: { status: dto.status } });
    const ref = await this.caseRef(challenge.caseId);
    await this.notifications.notifyCaseMembers({ caseId: challenge.caseId, key: 'CHALLENGE_DECIDED', vars: { caseRef: ref, outcome: dto.status === ChallengeStatus.UPHELD ? 'upheld' : 'dismissed' }, link: `/app/cases/${challenge.caseId}`, partyOnly: true });
    return updated;
  }

  private async advanceStage(caseId: string, toStage: CaseStage, actorId: string) {
    const current = await this.prisma.case.findUnique({ where: { id: caseId }, select: { stage: true } });
    if (!current || current.stage === toStage) return;
    await this.prisma.$transaction([
      this.prisma.case.update({ where: { id: caseId }, data: { stage: toStage } }),
      this.prisma.caseStatusHistory.create({ data: { caseId, fromStage: current.stage, toStage, changedBy: actorId } }),
    ]);
  }
}
