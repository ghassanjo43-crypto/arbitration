import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { CaseStage, NotificationType } from '@prisma/client';
import { ENFORCEMENT_WORDING } from '@gaap/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CaseAccessService } from '../authz/case-access.service';
import { AuthUser } from '../auth/types';
import { CorrectionRequestDto, CreateAwardDto, SignAwardDto } from './dto';

@Injectable()
export class AwardsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: CaseAccessService,
  ) {}

  private async assertTribunal(user: AuthUser, caseId: string) {
    const m = await this.access.assertCanAccessCase(user, caseId);
    if (!m.isTribunal) throw new ForbiddenException('Only the tribunal may act on awards.');
    return m;
  }

  /** Draft an award (tribunal only). Draft awards are not visible to parties. */
  async create(user: AuthUser, caseId: string, dto: CreateAwardDto) {
    await this.assertTribunal(user, caseId);
    const award = await this.prisma.award.create({
      data: { caseId, type: dto.type, seat: dto.seat, signatureStatus: 'PENDING', correctionStatus: 'NONE' },
    });
    await this.advanceStage(caseId, CaseStage.DRAFT_AWARD, user.id);
    await this.audit.record({ userId: user.id, action: 'AWARD_DRAFTED', entityType: 'Award', entityId: award.id, caseId, metadata: { type: dto.type } });
    return { ...award, enforcementNote: ENFORCEMENT_WORDING };
  }

  /** Parties see issued awards; the tribunal sees drafts too. */
  async listForCase(user: AuthUser, caseId: string) {
    const m = await this.access.assertCanAccessCase(user, caseId);
    const awards = await this.prisma.award.findMany({
      where: { caseId, ...(m.isTribunal ? {} : { issueDate: { not: null } }) },
      include: { deliveries: true, corrections: true },
      orderBy: { createdAt: 'desc' },
    });
    return { awards, enforcementNote: ENFORCEMENT_WORDING };
  }

  async sign(user: AuthUser, awardId: string, dto: SignAwardDto) {
    const award = await this.prisma.award.findUnique({ where: { id: awardId } });
    if (!award) throw new NotFoundException('Award not found.');
    await this.assertTribunal(user, award.caseId);
    const updated = await this.prisma.award.update({
      where: { id: awardId },
      data: { signatureStatus: 'SIGNED', signedDocumentKey: dto.signedDocumentKey, signatureMetadata: dto.signatureMetadata },
    });
    await this.audit.record({ userId: user.id, action: 'AWARD_SIGNED', entityType: 'Award', entityId: awardId, caseId: award.caseId });
    return updated;
  }

  /**
   * Issue a signed award: stamps the issue date, advances the case, and creates
   * delivery records for every party participant.
   */
  async issue(user: AuthUser, awardId: string) {
    const award = await this.prisma.award.findUnique({ where: { id: awardId } });
    if (!award) throw new NotFoundException('Award not found.');
    await this.assertTribunal(user, award.caseId);
    if (award.signatureStatus !== 'SIGNED') throw new BadRequestException('The award must be signed before issue.');
    if (award.issueDate) throw new BadRequestException('Award already issued.');

    const parties = await this.prisma.caseTeamMember.findMany({
      where: {
        caseId: award.caseId,
        active: true,
        caseRole: { in: ['CLAIMANT', 'CLAIMANT_REPRESENTATIVE', 'RESPONDENT', 'RESPONDENT_REPRESENTATIVE'] },
      },
      include: { user: { select: { id: true, email: true, profile: { select: { displayName: true } } } } },
    });

    await this.prisma.$transaction([
      this.prisma.award.update({ where: { id: awardId }, data: { issueDate: new Date() } }),
      this.prisma.awardDelivery.createMany({
        data: parties.map((p) => ({
          awardId,
          recipientUserId: p.userId,
          recipientLabel: p.user.profile?.displayName ?? p.user.email,
          deliveredAt: new Date(),
        })),
      }),
      this.prisma.notification.createMany({
        data: parties.map((p) => ({
          userId: p.userId,
          type: NotificationType.CASE_UPDATE,
          title: 'An award has been issued',
          body: 'A new arbitral award is available in your case workspace.',
          link: `/app/cases/${award.caseId}`,
        })),
      }),
    ]);
    await this.advanceStage(award.caseId, CaseStage.AWARD_ISSUED, user.id);
    await this.audit.record({ userId: user.id, action: 'AWARD_ISSUED', entityType: 'Award', entityId: awardId, caseId: award.caseId, metadata: { recipients: parties.length } });
    return { issued: true, deliveries: parties.length };
  }

  /** A party may request correction / interpretation / an additional award. */
  async requestCorrection(user: AuthUser, awardId: string, dto: CorrectionRequestDto) {
    const award = await this.prisma.award.findUnique({ where: { id: awardId } });
    if (!award) throw new NotFoundException('Award not found.');
    const m = await this.access.assertCanAccessCase(user, award.caseId);
    if (!m.isParty) throw new ForbiddenException('Only a party may request a correction or interpretation.');
    if (!award.issueDate) throw new BadRequestException('Corrections may only be requested for issued awards.');

    const request = await this.prisma.correctionRequest.create({
      data: { awardId, kind: dto.kind, requestedBy: user.id, details: dto.details, status: 'SUBMITTED' },
    });
    await this.prisma.award.update({
      where: { id: awardId },
      data: dto.kind === 'INTERPRETATION' ? { interpretationStatus: 'REQUESTED' } : { correctionStatus: 'REQUESTED' },
    });
    await this.advanceStage(award.caseId, CaseStage.CORRECTION_OR_INTERPRETATION, user.id);
    await this.audit.record({ userId: user.id, action: 'AWARD_CORRECTION_REQUESTED', entityType: 'CorrectionRequest', entityId: request.id, caseId: award.caseId, metadata: { kind: dto.kind } });
    return request;
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
