import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  ComplianceHoldStatus,
  ScreeningCheck,
  ScreeningDecision,
  ScreeningStatus,
  ScreeningSubjectType,
  ScreeningType,
} from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ScreeningService, ScreeningSubject } from '../providers/screening/screening.service';
import { AuthUser } from '../auth/types';

export interface ScreenInput {
  subjectType: ScreeningSubjectType;
  subjectId?: string | null;
  subjectName: string;
  caseId?: string | null;
  screeningType?: ScreeningType;
  country?: string;
  triggerEvent?: string;
  requestedById?: string | null;
  /** Re-screen even if a valid CLEAR check already exists. */
  force?: boolean;
}

export interface RescreenEvent {
  event: string;
  caseId?: string | null;
  /** Explicit subjects; when omitted and caseId is given, the case parties are screened. */
  subjects?: Array<Omit<ScreenInput, 'triggerEvent' | 'requestedById'>>;
  requestedById?: string | null;
}

/**
 * Compliance screening orchestration. This is a FRAMEWORK that flags, holds and
 * routes risk for human review — it never reaches a legal conclusion on its own.
 * A possible match or a provider failure raises a manual-review hold; an
 * authorised reviewer (COMPLIANCE_REVIEW) approves, rejects or escalates.
 */
@Injectable()
export class ComplianceService {
  private readonly logger = new Logger(ComplianceService.name);
  private readonly validityDays: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly screening: ScreeningService,
    config: ConfigService,
  ) {
    this.validityDays = config.get<number>('screening.validityDays') ?? 365;
  }

  // --- Screening -----------------------------------------------------------

  /** Screens one subject, records the result, and raises a hold if risky. */
  async screenSubject(input: ScreenInput): Promise<ScreeningCheck> {
    const screeningType = input.screeningType ?? ScreeningType.SANCTIONS;

    if (!input.force && input.subjectId) {
      const valid = await this.hasValidScreening(input.subjectType, input.subjectId, screeningType);
      if (valid) return valid;
    }

    const check = await this.prisma.screeningCheck.create({
      data: {
        subjectType: input.subjectType,
        subjectId: input.subjectId ?? null,
        subjectName: input.subjectName,
        caseId: input.caseId ?? null,
        screeningType,
        status: ScreeningStatus.PENDING,
        provider: this.screening.providerName,
        triggerEvent: input.triggerEvent,
        requestedById: input.requestedById ?? null,
      },
    });
    await this.audit.record({
      userId: input.requestedById ?? null,
      action: 'SCREENING_REQUESTED',
      entityType: 'ScreeningCheck',
      entityId: check.id,
      caseId: input.caseId ?? undefined,
      metadata: { subjectType: input.subjectType, screeningType, trigger: input.triggerEvent },
    });

    const subject: ScreeningSubject = {
      name: input.subjectName,
      type: input.subjectType,
      country: input.country,
    };

    // Provider errors are an outcome, not an exception: record FAILED + hold
    // (fail-closed) rather than letting the workflow proceed unscreened.
    let result;
    try {
      result = await this.screening.screen(subject);
    } catch (err) {
      this.logger.error(`Screening provider error for check ${check.id}: ${(err as Error).message}`);
      result = { provider: this.screening.providerName, providerRef: null as string | null, outcome: 'FAILED' as const, matchCount: 0, summary: `Provider error: ${(err as Error).message}` };
    }

    const status =
      result.outcome === 'CLEAR' ? ScreeningStatus.CLEAR
      : result.outcome === 'POSSIBLE_MATCH' ? ScreeningStatus.POSSIBLE_MATCH
      : ScreeningStatus.FAILED;

    const updated = await this.prisma.screeningCheck.update({
      where: { id: check.id },
      data: {
        status,
        providerRef: result.providerRef,
        riskScore: 'riskScore' in result ? result.riskScore : null,
        matchCount: result.matchCount,
        resultSummary: result.summary,
        screenedAt: new Date(),
        expiresAt: status === ScreeningStatus.CLEAR ? new Date(Date.now() + this.validityDays * 86400000) : null,
      },
    });

    await this.audit.record({
      userId: input.requestedById ?? null,
      action: 'SCREENING_RESULT',
      entityType: 'ScreeningCheck',
      entityId: check.id,
      caseId: input.caseId ?? undefined,
      metadata: { status, matchCount: result.matchCount, provider: result.provider },
    });

    // Fail-closed: a possible match or a failed screening freezes progress until
    // a reviewer clears it.
    if (status === ScreeningStatus.POSSIBLE_MATCH || status === ScreeningStatus.FAILED) {
      await this.raiseHold(updated, status === ScreeningStatus.POSSIBLE_MATCH
        ? `Possible ${screeningType} match — manual review required`
        : `Screening could not be completed (provider error) — manual review required`);
    }
    return updated;
  }

  /** Best-effort re-screening on a domain event; never throws into the caller. */
  async rescreenForEvent(evt: RescreenEvent): Promise<void> {
    try {
      let subjects = evt.subjects ?? [];
      if (subjects.length === 0 && evt.caseId) {
        const parties = await this.prisma.caseParty.findMany({ where: { caseId: evt.caseId } });
        subjects = parties.map((p) => ({
          subjectType: ScreeningSubjectType.PARTY,
          subjectId: p.id,
          subjectName: p.legalName,
          caseId: evt.caseId,
          country: p.country ?? p.nationality ?? undefined,
        }));
      }
      for (const s of subjects) {
        await this.screenSubject({ ...s, triggerEvent: evt.event, requestedById: evt.requestedById });
      }
    } catch (err) {
      // Screening must never break the originating workflow.
      this.logger.error(`rescreenForEvent(${evt.event}) failed: ${(err as Error).message}`);
    }
  }

  private async hasValidScreening(subjectType: ScreeningSubjectType, subjectId: string, screeningType: ScreeningType) {
    return this.prisma.screeningCheck.findFirst({
      where: {
        subjectType,
        subjectId,
        screeningType,
        status: ScreeningStatus.CLEAR,
        expiresAt: { gt: new Date() },
      },
      orderBy: { screenedAt: 'desc' },
    });
  }

  // --- Holds ---------------------------------------------------------------

  private async raiseHold(check: ScreeningCheck, reason: string) {
    const hold = await this.prisma.complianceHold.create({
      data: {
        caseId: check.caseId,
        subjectType: check.subjectType,
        subjectId: check.subjectId,
        reason,
        screeningCheckId: check.id,
        status: ComplianceHoldStatus.ACTIVE,
      },
    });
    await this.audit.record({
      action: 'COMPLIANCE_HOLD_RAISED',
      entityType: 'ComplianceHold',
      entityId: hold.id,
      caseId: check.caseId ?? undefined,
      metadata: { subjectType: check.subjectType, screeningCheckId: check.id },
    });
    return hold;
  }

  /** Throws if the case has any active compliance hold (blocks it from proceeding). */
  async assertCaseClearedToProceed(caseId: string): Promise<void> {
    const active = await this.prisma.complianceHold.count({
      where: { caseId, status: ComplianceHoldStatus.ACTIVE },
    });
    if (active > 0) {
      throw new BadRequestException(
        'This case has an active compliance hold and cannot proceed until it is reviewed and released.',
      );
    }
  }

  async listHolds(filter: { caseId?: string; status?: ComplianceHoldStatus }) {
    return this.prisma.complianceHold.findMany({
      where: { caseId: filter.caseId, status: filter.status },
      orderBy: { createdAt: 'desc' },
    });
  }

  async releaseHold(actor: AuthUser, holdId: string, note?: string) {
    const hold = await this.prisma.complianceHold.findUnique({ where: { id: holdId } });
    if (!hold) throw new NotFoundException('Compliance hold not found.');
    if (hold.status === ComplianceHoldStatus.RELEASED) return hold;
    const released = await this.prisma.complianceHold.update({
      where: { id: holdId },
      data: { status: ComplianceHoldStatus.RELEASED, releasedById: actor.id, releaseNote: note, releasedAt: new Date() },
    });
    await this.audit.record({
      userId: actor.id,
      action: 'COMPLIANCE_HOLD_RELEASED',
      entityType: 'ComplianceHold',
      entityId: holdId,
      caseId: hold.caseId ?? undefined,
      metadata: { note },
    });
    return released;
  }

  // --- Review --------------------------------------------------------------

  async listChecks(filter: { caseId?: string; status?: ScreeningStatus; subjectId?: string }) {
    return this.prisma.screeningCheck.findMany({
      where: { caseId: filter.caseId, status: filter.status, subjectId: filter.subjectId },
      orderBy: { createdAt: 'desc' },
      include: { holds: true },
    });
  }

  async getCheck(id: string) {
    const check = await this.prisma.screeningCheck.findUnique({ where: { id }, include: { holds: true } });
    if (!check) throw new NotFoundException('Screening check not found.');
    return check;
  }

  /**
   * A reviewer's decision on a flagged check. APPROVED releases the linked holds;
   * REJECTED keeps the subject blocked; ESCALATED routes to legal and keeps the
   * hold. The decision is recorded separately from the screening result so the
   * provider's signal is never overwritten.
   */
  async reviewCheck(actor: AuthUser, id: string, decision: ScreeningDecision, note?: string) {
    const check = await this.prisma.screeningCheck.findUnique({ where: { id }, include: { holds: true } });
    if (!check) throw new NotFoundException('Screening check not found.');

    const updated = await this.prisma.screeningCheck.update({
      where: { id },
      data: {
        reviewDecision: decision,
        reviewNote: note,
        reviewedById: actor.id,
        reviewedAt: new Date(),
        status: decision === ScreeningDecision.ESCALATED ? ScreeningStatus.MANUAL_REVIEW : check.status,
      },
    });

    if (decision === ScreeningDecision.APPROVED) {
      // Release every active hold tied to this check so the workflow can proceed.
      const active = check.holds.filter((h) => h.status === ComplianceHoldStatus.ACTIVE);
      for (const h of active) await this.releaseHold(actor, h.id, `Released by screening review: ${note ?? 'approved'}`);
    }

    await this.audit.record({
      userId: actor.id,
      action: decision === ScreeningDecision.APPROVED ? 'SCREENING_APPROVED'
        : decision === ScreeningDecision.REJECTED ? 'SCREENING_REJECTED'
        : 'SCREENING_ESCALATED',
      entityType: 'ScreeningCheck',
      entityId: id,
      caseId: check.caseId ?? undefined,
      metadata: { decision, note },
    });
    return updated;
  }

  // --- Periodic expiry -----------------------------------------------------

  /** Marks CLEAR checks whose validity has lapsed as EXPIRED (so they re-screen). */
  async markExpired(): Promise<{ expired: number }> {
    const res = await this.prisma.screeningCheck.updateMany({
      where: { status: ScreeningStatus.CLEAR, expiresAt: { lt: new Date() } },
      data: { status: ScreeningStatus.EXPIRED },
    });
    if (res.count > 0) {
      await this.audit.record({ action: 'SCREENING_EXPIRED_SWEEP', entityType: 'ScreeningCheck', metadata: { count: res.count } });
    }
    return { expired: res.count };
  }
}
