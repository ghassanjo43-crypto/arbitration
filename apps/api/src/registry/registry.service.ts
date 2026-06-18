import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CaseStage } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/types';

/** Permitted forward transitions the registrar may apply administratively. */
const REGISTRAR_TRANSITIONS: Partial<Record<CaseStage, CaseStage[]>> = {
  [CaseStage.SUBMITTED]: [CaseStage.FILING_FEE_PENDING, CaseStage.ADMINISTRATIVE_REVIEW],
  [CaseStage.FILING_FEE_PENDING]: [CaseStage.ADMINISTRATIVE_REVIEW],
  [CaseStage.ADMINISTRATIVE_REVIEW]: [CaseStage.DEFICIENCY_NOTICE_ISSUED, CaseStage.CASE_REGISTERED],
  [CaseStage.DEFICIENCY_NOTICE_ISSUED]: [CaseStage.AWAITING_CLAIMANT_CORRECTION],
  [CaseStage.AWAITING_CLAIMANT_CORRECTION]: [CaseStage.ADMINISTRATIVE_REVIEW],
  [CaseStage.CASE_REGISTERED]: [CaseStage.NOTICE_BEING_SERVED],
  [CaseStage.NOTICE_BEING_SERVED]: [CaseStage.AWAITING_RESPONDENT_REGISTRATION, CaseStage.AWAITING_RESPONSE],
  [CaseStage.AWAITING_RESPONDENT_REGISTRATION]: [CaseStage.AWAITING_RESPONSE],
  [CaseStage.AWAITING_RESPONSE]: [CaseStage.RESPONSE_RECEIVED],
  [CaseStage.RESPONSE_RECEIVED]: [CaseStage.ARBITRATION_TERMS_PENDING, CaseStage.TRIBUNAL_APPOINTMENT_PENDING],
};

@Injectable()
export class RegistryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** The registrar's queue: cases needing administrative attention. */
  async queue() {
    const stages: CaseStage[] = [
      CaseStage.SUBMITTED,
      CaseStage.FILING_FEE_PENDING,
      CaseStage.ADMINISTRATIVE_REVIEW,
      CaseStage.DEFICIENCY_NOTICE_ISSUED,
      CaseStage.AWAITING_CLAIMANT_CORRECTION,
      CaseStage.NOTICE_BEING_SERVED,
      CaseStage.AWAITING_RESPONSE,
      CaseStage.RESPONSE_RECEIVED,
      CaseStage.TRIBUNAL_APPOINTMENT_PENDING,
    ];
    const cases = await this.prisma.case.findMany({
      where: { stage: { in: stages }, deletedAt: null },
      select: { id: true, reference: true, title: true, stage: true, createdAt: true, updatedAt: true,
        _count: { select: { parties: true, documents: true } } },
      orderBy: { updatedAt: 'asc' },
    });
    const counts = await this.prisma.case.groupBy({ by: ['stage'], _count: true });
    return { cases, statistics: counts.map((c) => ({ stage: c.stage, count: c._count })) };
  }

  async transition(actor: AuthUser, caseId: string, toStage: CaseStage, note?: string) {
    const theCase = await this.prisma.case.findUnique({ where: { id: caseId }, select: { stage: true } });
    if (!theCase) throw new NotFoundException('Case not found.');
    const allowed = REGISTRAR_TRANSITIONS[theCase.stage] ?? [];
    if (!allowed.includes(toStage)) {
      throw new BadRequestException(`Transition ${theCase.stage} → ${toStage} is not permitted for a registrar.`);
    }
    await this.prisma.$transaction([
      this.prisma.case.update({
        where: { id: caseId },
        data: { stage: toStage, ...(toStage === CaseStage.CASE_REGISTERED ? { registeredAt: new Date() } : {}) },
      }),
      this.prisma.caseStatusHistory.create({ data: { caseId, fromStage: theCase.stage, toStage, note, changedBy: actor.id } }),
    ]);
    await this.audit.record({
      userId: actor.id,
      action: toStage === CaseStage.CASE_REGISTERED ? 'CASE_REGISTERED' : 'CASE_STAGE_CHANGED',
      entityType: 'Case',
      entityId: caseId,
      caseId,
      metadata: { from: theCase.stage, to: toStage, note },
    });
    return { id: caseId, stage: toStage };
  }
}
