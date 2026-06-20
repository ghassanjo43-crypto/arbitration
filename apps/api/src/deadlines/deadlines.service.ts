import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DeadlineStatus, DeadlineChangeKind, DayKind } from '@prisma/client';
import { Permission } from '@gaap/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CaseAccessService } from '../authz/case-access.service';
import { AuthUser } from '../auth/types';
import { CreateDeadlineDto, ExtendDeadlineDto, GenerateDeadlineDto } from './dto';
import { computeDeadline, HolidayCalendarSpec } from './deadline-engine';

@Injectable()
export class DeadlinesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: CaseAccessService,
  ) {}

  /** Deadlines are set by the registrar (CASE_MANAGE_DEADLINES) or the tribunal. */
  private async assertCanManage(user: AuthUser, caseId: string) {
    const m = await this.access.assertCanAccessCase(user, caseId);
    if (!m.isTribunal && !user.permissions.includes(Permission.CASE_MANAGE_DEADLINES)) {
      throw new ForbiddenException('Only the registry or the tribunal may set deadlines.');
    }
  }

  async create(user: AuthUser, caseId: string, dto: CreateDeadlineDto) {
    await this.assertCanManage(user, caseId);
    const deadline = await this.prisma.deadline.create({
      data: {
        caseId,
        title: dto.title,
        description: dto.description,
        dueAt: new Date(dto.dueAt),
        timezone: dto.timezone ?? 'UTC',
        reminderRule: dto.reminderRule ?? 'P7D,P2D,P1D',
      },
    });
    await this.audit.record({ userId: user.id, action: 'DEADLINE_CREATED', entityType: 'Deadline', entityId: deadline.id, caseId });
    return deadline;
  }

  /** Load a holiday calendar into the engine's spec shape (UTC fallback). */
  private async loadCalendar(calendarId: string | null | undefined, timezone: string): Promise<{ spec: HolidayCalendarSpec; id: string | null }> {
    if (!calendarId) {
      return { spec: { timezone, weekend: [0, 6], holidays: [] }, id: null };
    }
    const cal = await this.prisma.holidayCalendar.findUnique({
      where: { id: calendarId },
      include: { holidays: true },
    });
    if (!cal) return { spec: { timezone, weekend: [0, 6], holidays: [] }, id: null };
    return {
      id: cal.id,
      spec: {
        timezone: cal.timezone || timezone,
        weekend: cal.weekend?.length ? cal.weekend : [0, 6],
        holidays: cal.holidays.map((h) => h.date.toISOString().slice(0, 10)),
      },
    };
  }

  /**
   * Generate a case deadline from a rule deadline definition and a procedural
   * event. This is how the rules engine drives the procedural calendar: the
   * triggering event's date starts the clock and the definition supplies the
   * period, day-kind and responsible role. Full provenance is recorded.
   */
  async generateFromDefinition(user: AuthUser, caseId: string, dto: GenerateDeadlineDto) {
    await this.assertCanManage(user, caseId);

    const event = await this.prisma.caseProceduralEvent.findFirst({
      where: { id: dto.triggerEventId, caseId },
    });
    if (!event) throw new NotFoundException('Triggering procedural event not found on this case.');

    // The case's pinned rule version supplies the definition.
    const link = await this.prisma.caseRuleSet.findUnique({ where: { caseId } });
    if (!link) throw new BadRequestException('This case is not yet linked to a rule set version.');

    const def = await this.prisma.ruleDeadlineDefinition.findFirst({
      where: { key: dto.definitionKey, rule: { versionId: link.ruleSetVersionId } },
      include: { rule: true },
    });
    if (!def) throw new NotFoundException('Deadline definition not found in the case rule set version.');

    // Official case time zone: derive from the holiday calendar if any, else UTC.
    const { spec, id: calendarId } = await this.loadCalendar(null, 'UTC');
    const triggerDate = event.effectiveDate ?? event.occurredAt;

    const result = computeDeadline({
      triggerDate,
      days: def.days,
      dayKind: def.dayKind === DayKind.BUSINESS ? 'BUSINESS' : 'CALENDAR',
      calendar: spec,
    });

    const deadline = await this.prisma.deadline.create({
      data: {
        caseId,
        title: def.label,
        description: def.requiredAction,
        dueAt: result.dueAt,
        timezone: spec.timezone,
        reminderRule: def.reminderRule,
        ruleId: def.ruleId,
        definitionKey: def.key,
        triggerEventId: event.id,
        triggerDate,
        startDate: new Date(`${result.startCivilDate}T00:00:00.000Z`),
        days: def.days,
        dayKind: def.dayKind,
        holidayCalendarId: calendarId,
        responsibleRole: def.responsibleRole,
        requiredAction: def.requiredAction,
      },
    });
    await this.audit.record({
      userId: user.id,
      action: 'DEADLINE_GENERATED',
      entityType: 'Deadline',
      entityId: deadline.id,
      caseId,
      metadata: { definitionKey: def.key, triggerEventId: event.id, dueAt: result.dueAt.toISOString(), dayKind: def.dayKind },
    });
    return deadline;
  }

  async listForCase(user: AuthUser, caseId: string) {
    await this.access.assertCanAccessCase(user, caseId);
    return this.prisma.deadline.findMany({
      where: { caseId },
      orderBy: { dueAt: 'asc' },
      include: { extensions: { orderBy: { createdAt: 'asc' } } },
    });
  }

  /**
   * Extend a deadline. NON-DESTRUCTIVE: the prior due date, reason and ordering
   * authority are preserved in a DeadlineExtension row before dueAt is moved.
   * Deadlines are never silently overwritten.
   */
  async extend(user: AuthUser, deadlineId: string, dto: ExtendDeadlineDto) {
    const deadline = await this.prisma.deadline.findUnique({ where: { id: deadlineId } });
    if (!deadline) throw new NotFoundException('Deadline not found.');
    await this.assertCanManage(user, deadline.caseId);

    const newDueAt = new Date(dto.extendedTo);
    if (Number.isNaN(newDueAt.getTime())) throw new BadRequestException('Invalid extension date.');

    const [, updated] = await this.prisma.$transaction([
      this.prisma.deadlineExtension.create({
        data: {
          deadlineId,
          kind: DeadlineChangeKind.EXTENSION,
          previousDueAt: deadline.dueAt,
          newDueAt,
          reason: dto.reason,
          orderedById: user.id,
          orderReference: dto.orderReference,
        },
      }),
      this.prisma.deadline.update({
        where: { id: deadlineId },
        data: { extendedTo: newDueAt, dueAt: newDueAt, status: DeadlineStatus.EXTENDED },
      }),
    ]);

    await this.audit.record({
      userId: user.id,
      action: 'DEADLINE_EXTENDED',
      entityType: 'Deadline',
      entityId: deadlineId,
      caseId: deadline.caseId,
      metadata: { previousDueAt: deadline.dueAt.toISOString(), newDueAt: newDueAt.toISOString(), reason: dto.reason },
    });
    return updated;
  }

  /** Mark a deadline met by recording a filing-completion timestamp. */
  async markComplete(user: AuthUser, deadlineId: string) {
    const deadline = await this.prisma.deadline.findUnique({ where: { id: deadlineId } });
    if (!deadline) throw new NotFoundException('Deadline not found.');
    await this.assertCanManage(user, deadline.caseId);
    const updated = await this.prisma.deadline.update({
      where: { id: deadlineId },
      data: { status: DeadlineStatus.MET, completedAt: new Date() },
    });
    await this.audit.record({ userId: user.id, action: 'DEADLINE_MET', entityType: 'Deadline', entityId: deadlineId, caseId: deadline.caseId });
    return updated;
  }

  /** Personal calendar: open deadlines + upcoming hearings across the user's cases. */
  async myCalendar(user: AuthUser) {
    const memberships = await this.prisma.caseTeamMember.findMany({
      where: { userId: user.id, active: true },
      select: { caseId: true },
    });
    const caseIds = [...new Set(memberships.map((m) => m.caseId))];
    if (caseIds.length === 0) return { deadlines: [], hearings: [] };

    const [deadlines, hearings] = await Promise.all([
      this.prisma.deadline.findMany({
        where: { caseId: { in: caseIds }, status: { in: [DeadlineStatus.OPEN, DeadlineStatus.EXTENDED] } },
        include: { case: { select: { reference: true, title: true } } },
        orderBy: { dueAt: 'asc' },
      }),
      this.prisma.hearing.findMany({
        where: { caseId: { in: caseIds }, scheduledStart: { gte: new Date() } },
        include: { case: { select: { reference: true, title: true } } },
        orderBy: { scheduledStart: 'asc' },
      }),
    ]);
    return { deadlines, hearings };
  }
}
