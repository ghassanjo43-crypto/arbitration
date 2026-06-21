import { Injectable, Logger } from '@nestjs/common';
import { DayKind, Prisma, RuleActionKind, RuleExecutionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { computeDeadline, HolidayCalendarSpec } from '../deadlines/deadline-engine';

/** A single thing the engine did (or chose not to do) in response to an event. */
export interface RuleExecutionResult {
  ruleId: string;
  ruleNumber: string;
  actionKind: RuleActionKind;
  status: RuleExecutionStatus;
  detail?: string;
  createdEntityType?: string;
  createdEntityId?: string;
}

/**
 * The operational core: when a procedural event is recorded on a case, the
 * engine looks up the case's *pinned* rule-set version, fires every matching
 * RuleTrigger and executes its RuleActions.
 *
 * Design principles:
 *  - Only CREATE_DEADLINE materialises a concrete entity (a CaseDeadline) — a
 *    deterministic, non-merits step. Every other action kind records an
 *    advisory CaseRuleExecution (a worklist item) for the registrar/tribunal;
 *    the engine never auto-decides jurisdiction, merits, fees or stage.
 *  - Idempotent: re-processing the same event never duplicates work.
 *  - Respects pinning: amendments to the rules never reach an existing case,
 *    because triggers are resolved only within the case's pinned version.
 *  - Every action is logged immutably to RuleAuditLog and CaseRuleExecution.
 */
@Injectable()
export class RuleEngineService {
  private readonly logger = new Logger(RuleEngineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Apply the rules engine to one procedural event. Returns the list of actions
   * taken. Safe to call more than once for the same event (idempotent).
   */
  async applyEvent(params: {
    caseId: string;
    eventId: string;
    eventType: string;
    actorUserId?: string;
  }): Promise<RuleExecutionResult[]> {
    const { caseId, eventId, eventType, actorUserId } = params;

    const link = await this.prisma.caseRuleSet.findUnique({ where: { caseId } });
    if (!link) return []; // case not yet pinned — nothing the engine can act on

    const event = await this.prisma.caseProceduralEvent.findFirst({
      where: { id: eventId, caseId },
    });
    if (!event) return [];

    // Triggers matching this event type, but ONLY within the pinned version.
    const triggers = await this.prisma.ruleTrigger.findMany({
      where: {
        eventType,
        active: true,
        rule: { versionId: link.ruleSetVersionId },
      },
      include: { actions: { orderBy: { sortOrder: 'asc' } }, rule: true },
      orderBy: { sortOrder: 'asc' },
    });
    if (triggers.length === 0) return [];

    const triggerDate = event.effectiveDate ?? event.occurredAt;
    const results: RuleExecutionResult[] = [];

    // Idempotency is enforced per action at write time (deadline + execution
    // existence guards), so re-processing the same event never duplicates work.
    for (const trigger of triggers) {
      if (!this.conditionMatches(trigger.conditionJson, event.metadata)) continue;

      for (const action of trigger.actions) {
        const result = await this.executeAction({
          caseId,
          eventId,
          ruleId: trigger.ruleId,
          ruleNumber: trigger.rule.number,
          versionId: link.ruleSetVersionId,
          action,
          triggerDate,
          actorUserId,
        });
        results.push(result);
      }
    }

    return results;
  }

  /** Evaluate an optional JSON equality guard against the event metadata. */
  private conditionMatches(conditionJson: string | null, metadata: string | null): boolean {
    if (!conditionJson) return true;
    let guard: Record<string, unknown>;
    let meta: Record<string, unknown> = {};
    try {
      guard = JSON.parse(conditionJson) as Record<string, unknown>;
    } catch {
      return true; // a malformed guard never blocks the workflow
    }
    if (metadata) {
      try {
        meta = JSON.parse(metadata) as Record<string, unknown>;
      } catch {
        meta = {};
      }
    }
    return Object.entries(guard).every(([k, v]) => meta[k] === v);
  }

  private async executeAction(args: {
    caseId: string;
    eventId: string;
    ruleId: string;
    ruleNumber: string;
    versionId: string;
    action: { kind: RuleActionKind; definitionKey: string | null; targetKey: string | null; paramsJson: string | null };
    triggerDate: Date;
    actorUserId?: string;
  }): Promise<RuleExecutionResult> {
    const { caseId, eventId, ruleId, ruleNumber, versionId, action, triggerDate, actorUserId } = args;

    if (action.kind === RuleActionKind.CREATE_DEADLINE) {
      return this.createDeadline({ caseId, eventId, ruleId, ruleNumber, versionId, definitionKey: action.definitionKey, triggerDate, actorUserId });
    }

    // All non-deadline actions are advisory: record a worklist item only.
    const detail = JSON.stringify({
      targetKey: action.targetKey,
      params: action.paramsJson ? safeParse(action.paramsJson) : undefined,
    });

    // Idempotency: never record the same advisory item twice for one event.
    const already = await this.prisma.caseRuleExecution.findFirst({
      where: { caseId, triggerEventId: eventId, ruleId, actionKind: action.kind, detail },
    });
    if (already) {
      return { ruleId, ruleNumber, actionKind: action.kind, status: RuleExecutionStatus.SKIPPED, detail };
    }

    const execution = await this.record({
      caseId,
      eventId,
      ruleId,
      actionKind: action.kind,
      status: RuleExecutionStatus.EXECUTED,
      detail,
      actorUserId,
    });
    return { ruleId, ruleNumber, actionKind: action.kind, status: execution.status, detail };
  }

  private async createDeadline(args: {
    caseId: string;
    eventId: string;
    ruleId: string;
    ruleNumber: string;
    versionId: string;
    definitionKey: string | null;
    triggerDate: Date;
    actorUserId?: string;
  }): Promise<RuleExecutionResult> {
    const { caseId, eventId, ruleId, ruleNumber, versionId, definitionKey, triggerDate, actorUserId } = args;

    if (!definitionKey) {
      const execution = await this.record({ caseId, eventId, ruleId, actionKind: RuleActionKind.CREATE_DEADLINE, status: RuleExecutionStatus.SKIPPED, detail: 'no definitionKey', actorUserId });
      return { ruleId, ruleNumber, actionKind: RuleActionKind.CREATE_DEADLINE, status: execution.status, detail: 'no definitionKey' };
    }

    const def = await this.prisma.ruleDeadlineDefinition.findFirst({
      where: { key: definitionKey, rule: { versionId } },
    });
    if (!def) {
      const execution = await this.record({ caseId, eventId, ruleId, actionKind: RuleActionKind.CREATE_DEADLINE, status: RuleExecutionStatus.SKIPPED, detail: `definition ${definitionKey} not found`, actorUserId });
      return { ruleId, ruleNumber, actionKind: RuleActionKind.CREATE_DEADLINE, status: execution.status, detail: `definition ${definitionKey} not found` };
    }

    // Idempotency at the data layer: never create a second deadline for the
    // same definition + triggering event.
    const existing = await this.prisma.deadline.findFirst({
      where: { caseId, definitionKey: def.key, triggerEventId: eventId },
    });
    if (existing) {
      return { ruleId, ruleNumber, actionKind: RuleActionKind.CREATE_DEADLINE, status: RuleExecutionStatus.SKIPPED, detail: 'deadline already exists', createdEntityType: 'Deadline', createdEntityId: existing.id };
    }

    const calendar: HolidayCalendarSpec = { timezone: 'UTC', weekend: [0, 6], holidays: [] };
    const computed = computeDeadline({
      triggerDate,
      days: def.days,
      dayKind: def.dayKind === DayKind.BUSINESS ? 'BUSINESS' : 'CALENDAR',
      calendar,
    });

    const deadline = await this.prisma.deadline.create({
      data: {
        caseId,
        title: def.label,
        description: def.requiredAction,
        dueAt: computed.dueAt,
        timezone: calendar.timezone,
        reminderRule: def.reminderRule,
        ruleId: def.ruleId,
        definitionKey: def.key,
        triggerEventId: eventId,
        triggerDate,
        startDate: new Date(`${computed.startCivilDate}T00:00:00.000Z`),
        days: def.days,
        dayKind: def.dayKind,
        responsibleRole: def.responsibleRole,
        requiredAction: def.requiredAction,
      },
    });

    const execution = await this.record({
      caseId,
      eventId,
      ruleId,
      actionKind: RuleActionKind.CREATE_DEADLINE,
      status: RuleExecutionStatus.EXECUTED,
      detail: JSON.stringify({ definitionKey: def.key, dueAt: computed.dueAt.toISOString(), dayKind: def.dayKind }),
      createdEntityType: 'Deadline',
      createdEntityId: deadline.id,
      actorUserId,
    });

    // A response deadline is worth telling the parties about directly.
    if (/RESPONSE/i.test(def.key)) {
      const ref = await this.prisma.case.findUnique({ where: { id: caseId }, select: { reference: true } });
      await this.notifications.notifyCaseMembers({
        caseId, key: 'RESPONSE_DUE',
        vars: { caseRef: ref?.reference ?? caseId, dueDate: computed.dueAt.toISOString().slice(0, 10), timezone: calendar.timezone, title: def.label },
        link: `/app/cases/${caseId}`, partyOnly: true,
      });
    }

    return { ruleId, ruleNumber, actionKind: RuleActionKind.CREATE_DEADLINE, status: execution.status, detail: execution.detail ?? undefined, createdEntityType: 'Deadline', createdEntityId: deadline.id };
  }

  /** Persist a CaseRuleExecution and an immutable RuleAuditLog row together. */
  private async record(args: {
    caseId: string;
    eventId: string;
    ruleId: string;
    actionKind: RuleActionKind;
    status: RuleExecutionStatus;
    detail?: string;
    createdEntityType?: string;
    createdEntityId?: string;
    actorUserId?: string;
  }) {
    const data: Prisma.CaseRuleExecutionCreateInput = {
      case: { connect: { id: args.caseId } },
      rule: { connect: { id: args.ruleId } },
      triggerEvent: { connect: { id: args.eventId } },
      actionKind: args.actionKind,
      status: args.status,
      detail: args.detail,
      createdEntityType: args.createdEntityType,
      createdEntityId: args.createdEntityId,
    };
    const execution = await this.prisma.caseRuleExecution.create({ data });
    await this.prisma.ruleAuditLog.create({
      data: {
        caseId: args.caseId,
        ruleId: args.ruleId,
        action: 'RULE_ACTION_EXECUTED',
        actorUserId: args.actorUserId,
        detail: JSON.stringify({ actionKind: args.actionKind, status: args.status, executionId: execution.id, createdEntityId: args.createdEntityId }),
      },
    });
    return execution;
  }
}

function safeParse(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return json;
  }
}
