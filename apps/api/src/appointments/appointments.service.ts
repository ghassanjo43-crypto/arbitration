import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AppointmentStatus,
  CaseRole,
  CaseStage,
  TribunalComposition,
  TribunalRole,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuthUser } from '../auth/types';
import { ConflictDisclosureDto, InviteArbitratorDto, RespondToInvitationDto } from './dto';

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

/**
 * Tribunal appointment workflow: invite → conflict disclosure → accept/decline →
 * constitute. Acceptance is what creates the tribunal CaseTeamMember row, which
 * is the ONLY way a user gains deliberation access (see CaseAccessService).
 */
@Injectable()
export class AppointmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Registrar action (guarded by APPOINTMENT_MANAGE at the controller). */
  async invite(actor: AuthUser, caseId: string, dto: InviteArbitratorDto) {
    const [theCase, arbitrator] = await Promise.all([
      this.prisma.case.findUnique({ where: { id: caseId }, select: { id: true, reference: true } }),
      this.prisma.arbitratorProfile.findUnique({ where: { id: dto.arbitratorId }, select: { id: true, approvalStatus: true, userId: true } }),
    ]);
    if (!theCase) throw new NotFoundException('Case not found.');
    if (!arbitrator) throw new NotFoundException('Arbitrator not found.');
    if (arbitrator.approvalStatus !== 'APPROVED') {
      throw new BadRequestException('Only approved arbitrators may be invited.');
    }

    const invitation = await this.prisma.appointmentInvitation.create({
      data: {
        caseId,
        arbitratorId: dto.arbitratorId,
        proposedRole: dto.proposedRole,
        nominatedBy: dto.nominatedBy,
        status: AppointmentStatus.INVITED,
        expiresAt: new Date(Date.now() + 14 * 86400000),
      },
    });
    await this.advanceStage(caseId, CaseStage.TRIBUNAL_APPOINTMENT_PENDING, actor.id);
    await this.audit.record({
      userId: actor.id,
      action: 'APPOINTMENT_INVITED',
      entityType: 'AppointmentInvitation',
      entityId: invitation.id,
      caseId,
      metadata: { arbitratorId: dto.arbitratorId, role: dto.proposedRole },
    });

    // Invite the arbitrator (their portal account) in their language.
    if (arbitrator.userId) {
      await this.notifications.dispatch({
        userId: arbitrator.userId, key: 'APPOINTMENT_INVITATION',
        vars: { caseRef: theCase.reference, role: String(dto.proposedRole).replaceAll('_', ' ') },
        link: '/app',
      }).catch(() => undefined);
    }
    return invitation;
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
    await this.prisma.appointmentInvitation.update({
      where: { id: invitationId },
      data: { status: AppointmentStatus.CONFLICT_CHECK },
    });
    await this.advanceStage(invitation.caseId, CaseStage.CONFLICT_CHECK, user.id);
    await this.audit.record({
      userId: user.id,
      action: 'CONFLICT_DISCLOSURE_SUBMITTED',
      entityType: 'ConflictDisclosure',
      entityId: disclosure.id,
      caseId: invitation.caseId,
      metadata: { hasConflict: dto.hasConflict },
    });
    return disclosure;
  }

  async respond(user: AuthUser, invitationId: string, dto: RespondToInvitationDto) {
    const { invitation } = await this.assertOwnInvitation(user, invitationId);
    if (invitation.status === AppointmentStatus.ACCEPTED || invitation.status === AppointmentStatus.DECLINED) {
      throw new BadRequestException('This invitation has already been answered.');
    }

    if (!dto.accept) {
      const declined = await this.prisma.appointmentInvitation.update({
        where: { id: invitationId },
        data: { status: AppointmentStatus.DECLINED, respondedAt: new Date() },
      });
      await this.audit.record({ userId: user.id, action: 'APPOINTMENT_DECLINED', entityType: 'AppointmentInvitation', entityId: invitationId, caseId: invitation.caseId });
      return declined;
    }

    if (!dto.feeAccepted || !dto.availabilityConfirmed) {
      throw new BadRequestException('Acceptance requires fee acceptance and availability confirmation.');
    }

    // Acceptance: ensure a Tribunal exists, add the member, and — crucially —
    // create the tribunal CaseTeamMember row that grants deliberation access.
    const caseRole = caseRoleForTribunalRole(invitation.proposedRole);
    const isSole = invitation.proposedRole === TribunalRole.SOLE;

    await this.prisma.$transaction(async (tx) => {
      const tribunal = await tx.tribunal.upsert({
        where: { caseId: invitation.caseId },
        update: {},
        create: {
          caseId: invitation.caseId,
          composition: isSole ? TribunalComposition.SOLE : TribunalComposition.THREE_MEMBER,
        },
      });
      await tx.tribunalMember.upsert({
        where: { tribunalId_arbitratorUserId: { tribunalId: tribunal.id, arbitratorUserId: user.id } },
        update: { acceptedAt: new Date() },
        create: { tribunalId: tribunal.id, arbitratorUserId: user.id, role: invitation.proposedRole, acceptedAt: new Date() },
      });
      await tx.caseTeamMember.upsert({
        where: { caseId_userId_caseRole: { caseId: invitation.caseId, userId: user.id, caseRole } },
        update: { active: true },
        create: { caseId: invitation.caseId, userId: user.id, caseRole, addedBy: user.id },
      });
      await tx.appointmentInvitation.update({
        where: { id: invitationId },
        data: {
          status: AppointmentStatus.ACCEPTED,
          respondedAt: new Date(),
          feeAccepted: true,
          availabilityConfirmed: true,
        },
      });
    });

    await this.audit.record({
      userId: user.id,
      action: 'APPOINTMENT_ACCEPTED',
      entityType: 'AppointmentInvitation',
      entityId: invitationId,
      caseId: invitation.caseId,
      metadata: { role: invitation.proposedRole },
    });
    return { accepted: true, caseId: invitation.caseId, caseRole };
  }

  /** Registrar confirms constitution once required members have accepted. */
  async constitute(actor: AuthUser, caseId: string) {
    const tribunal = await this.prisma.tribunal.findUnique({
      where: { caseId },
      include: { members: true },
    });
    if (!tribunal) throw new BadRequestException('No tribunal exists for this case yet.');
    const accepted = tribunal.members.filter((m) => m.acceptedAt);
    const required = tribunal.composition === TribunalComposition.SOLE ? 1 : 3;
    if (accepted.length < required) {
      throw new BadRequestException(`Tribunal not complete: ${accepted.length}/${required} members have accepted.`);
    }
    await this.prisma.tribunal.update({ where: { id: tribunal.id }, data: { constituted: true, constitutedAt: new Date() } });
    await this.advanceStage(caseId, CaseStage.TRIBUNAL_CONSTITUTED, actor.id);
    await this.audit.record({ userId: actor.id, action: 'TRIBUNAL_CONSTITUTED', entityType: 'Tribunal', entityId: tribunal.id, caseId });

    const ref = await this.prisma.case.findUnique({ where: { id: caseId }, select: { reference: true } });
    await this.notifications.notifyCaseMembers({ caseId, key: 'TRIBUNAL_CONSTITUTED', vars: { caseRef: ref?.reference ?? caseId }, link: `/app/cases/${caseId}`, partyOnly: true });

    return { constituted: true, members: accepted.length };
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
