import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DefaultNoticeKind,
  DefaultOutcome,
  DefaultReviewFactor,
  DefaultStage,
} from '@prisma/client';
import { Permission } from '@gaap/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CaseAccessService } from '../authz/case-access.service';
import { AuthUser } from '../auth/types';
import {
  DefaultDecisionDto,
  DefaultNoticeDto,
  OpenDefaultDto,
  RegistrarReportDto,
  ReviewFactorDto,
} from './dto';

/** Every factor that must be satisfied before the tribunal may proceed in default. */
const ALL_FACTORS: DefaultReviewFactor[] = [
  DefaultReviewFactor.ARBITRATION_AGREEMENT,
  DefaultReviewFactor.JURISDICTION,
  DefaultReviewFactor.VALID_SERVICE,
  DefaultReviewFactor.DELIVERY_RECORDS,
  DefaultReviewFactor.OPPORTUNITY_TO_RESPOND,
  DefaultReviewFactor.EVIDENCE,
  DefaultReviewFactor.EXPLANATION_FOR_ABSENCE,
  DefaultReviewFactor.APPLICABLE_LAW,
  DefaultReviewFactor.FAIRNESS,
];

/**
 * Default / non-participation proceedings (Chapter 17).
 *
 * Due-process safeguard enforced here: the tribunal may only authorise
 * proceeding in default after EVERY review factor is satisfied and a registrar
 * report with verified service exists. A PROCEED decision authorises proceeding
 * in the party's absence — it never, by itself, establishes the claim.
 */
@Injectable()
export class DefaultsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: CaseAccessService,
  ) {}

  private async assertRegistryOrTribunal(user: AuthUser, caseId: string) {
    const m = await this.access.assertCanAccessCase(user, caseId);
    if (!m.isRegistrar && !m.isTribunal && !user.permissions.includes(Permission.CASE_REGISTER)) {
      throw new ForbiddenException('Only the registry or the tribunal may manage a default proceeding.');
    }
    return m;
  }

  /** Open a default proceeding and pre-create the nine review items (unsatisfied). */
  async open(user: AuthUser, caseId: string, dto: OpenDefaultDto) {
    await this.assertRegistryOrTribunal(user, caseId);
    const proceeding = await this.prisma.defaultProceeding.create({
      data: {
        caseId,
        defaultingParticipant: dto.defaultingParticipant,
        defaultingPartyId: dto.defaultingPartyId,
        basis: dto.basis,
        openedById: user.id,
        reviewItems: { create: ALL_FACTORS.map((factor) => ({ factor })) },
      },
      include: { reviewItems: true },
    });
    await this.audit.record({ userId: user.id, action: 'DEFAULT_OPENED', entityType: 'DefaultProceeding', entityId: proceeding.id, caseId, metadata: { basis: dto.basis } });
    return proceeding;
  }

  private async load(proceedingId: string) {
    const p = await this.prisma.defaultProceeding.findUnique({ where: { id: proceedingId } });
    if (!p) throw new NotFoundException('Default proceeding not found.');
    return p;
  }

  /** Issue a default WARNING then a FINAL_REMINDER to the non-participating party. */
  async issueNotice(user: AuthUser, proceedingId: string, dto: DefaultNoticeDto) {
    const p = await this.load(proceedingId);
    await this.assertRegistryOrTribunal(user, p.caseId);
    const notice = await this.prisma.defaultNotice.create({
      data: { proceedingId, kind: dto.kind, body: dto.body, deadlineAt: dto.deadlineAt ? new Date(dto.deadlineAt) : null, issuedById: user.id },
    });
    await this.prisma.defaultProceeding.update({
      where: { id: proceedingId },
      data: { stage: dto.kind === DefaultNoticeKind.WARNING ? DefaultStage.WARNING_ISSUED : DefaultStage.FINAL_REMINDER_ISSUED },
    });
    await this.audit.record({ userId: user.id, action: 'DEFAULT_NOTICE_ISSUED', entityType: 'DefaultNotice', entityId: notice.id, caseId: p.caseId, metadata: { kind: dto.kind } });
    return notice;
  }

  /** Mark a single due-process review factor as satisfied/unsatisfied. */
  async reviewFactor(user: AuthUser, proceedingId: string, dto: ReviewFactorDto) {
    const p = await this.load(proceedingId);
    await this.assertRegistryOrTribunal(user, p.caseId);
    const item = await this.prisma.defaultReviewItem.update({
      where: { proceedingId_factor: { proceedingId, factor: dto.factor } },
      data: { satisfied: dto.satisfied, note: dto.note, reviewedById: user.id, reviewedAt: new Date() },
    });
    if (p.stage === DefaultStage.WARNING_ISSUED || p.stage === DefaultStage.FINAL_REMINDER_ISSUED || p.stage === DefaultStage.OPENED) {
      await this.prisma.defaultProceeding.update({ where: { id: proceedingId }, data: { stage: DefaultStage.REGISTRAR_REVIEW } });
    }
    await this.audit.record({ userId: user.id, action: 'DEFAULT_FACTOR_REVIEWED', entityType: 'DefaultReviewItem', entityId: item.id, caseId: p.caseId, metadata: { factor: dto.factor, satisfied: dto.satisfied } });
    return item;
  }

  /** The registrar files the report (incl. explicit service verification). */
  async fileRegistrarReport(user: AuthUser, proceedingId: string, dto: RegistrarReportDto) {
    const p = await this.load(proceedingId);
    await this.assertRegistryOrTribunal(user, p.caseId);
    const report = await this.prisma.defaultRegistrarReport.upsert({
      where: { proceedingId },
      update: { summary: dto.summary, serviceVerified: dto.serviceVerified, preparedById: user.id, preparedAt: new Date() },
      create: { proceedingId, summary: dto.summary, serviceVerified: dto.serviceVerified, preparedById: user.id },
    });
    await this.prisma.defaultProceeding.update({ where: { id: proceedingId }, data: { stage: DefaultStage.TRIBUNAL_REVIEW } });
    await this.audit.record({ userId: user.id, action: 'DEFAULT_REGISTRAR_REPORT_FILED', entityType: 'DefaultRegistrarReport', entityId: report.id, caseId: p.caseId, metadata: { serviceVerified: dto.serviceVerified } });
    return report;
  }

  /**
   * The TRIBUNAL decides. A PROCEED outcome is blocked unless every review factor
   * is satisfied AND a registrar report with verified service exists. The portal
   * never authorises default proceeding on its own.
   */
  async decide(user: AuthUser, proceedingId: string, dto: DefaultDecisionDto) {
    const p = await this.prisma.defaultProceeding.findUnique({
      where: { id: proceedingId },
      include: { reviewItems: true, registrarReport: true, decision: true },
    });
    if (!p) throw new NotFoundException('Default proceeding not found.');
    const m = await this.access.assertCanAccessCase(user, p.caseId);
    if (!m.isTribunal) throw new ForbiddenException('Only the tribunal may decide whether to proceed in default.');
    if (p.decision) throw new BadRequestException('This default proceeding has already been decided.');

    if (dto.outcome === DefaultOutcome.PROCEED) {
      const unsatisfied = ALL_FACTORS.filter((f) => !p.reviewItems.find((i) => i.factor === f)?.satisfied);
      if (unsatisfied.length > 0) {
        throw new BadRequestException(`Cannot proceed in default: outstanding due-process review (${unsatisfied.join(', ')}).`);
      }
      if (!p.registrarReport?.serviceVerified) {
        throw new BadRequestException('Cannot proceed in default: a registrar report with verified service is required.');
      }
    }

    const decision = await this.prisma.defaultDecision.create({
      data: {
        proceedingId,
        outcome: dto.outcome,
        reason: dto.reason,
        defaultHearingScheduled: dto.defaultHearingScheduled ?? false,
        proceduralOrderRef: dto.proceduralOrderRef,
        decidedById: user.id,
      },
    });
    const stage =
      dto.outcome === DefaultOutcome.PROCEED ? DefaultStage.PROCEED_AUTHORISED
      : dto.outcome === DefaultOutcome.REFUSE ? DefaultStage.PROCEED_REFUSED
      : DefaultStage.CURED;
    await this.prisma.defaultProceeding.update({ where: { id: proceedingId }, data: { stage } });
    await this.audit.record({ userId: user.id, action: 'DEFAULT_DECIDED', entityType: 'DefaultDecision', entityId: decision.id, caseId: p.caseId, metadata: { outcome: dto.outcome } });
    return decision;
  }

  async get(user: AuthUser, proceedingId: string) {
    const p = await this.prisma.defaultProceeding.findUnique({
      where: { id: proceedingId },
      include: { notices: true, reviewItems: true, registrarReport: true, decision: true },
    });
    if (!p) throw new NotFoundException('Default proceeding not found.');
    await this.access.assertCanAccessCase(user, p.caseId);
    return p;
  }

  async listForCase(user: AuthUser, caseId: string) {
    await this.access.assertCanAccessCase(user, caseId);
    return this.prisma.defaultProceeding.findMany({
      where: { caseId },
      orderBy: { createdAt: 'asc' },
      include: { reviewItems: true, registrarReport: true, decision: true },
    });
  }
}
