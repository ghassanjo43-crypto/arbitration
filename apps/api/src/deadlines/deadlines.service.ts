import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DeadlineStatus } from '@prisma/client';
import { Permission } from '@gaap/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CaseAccessService } from '../authz/case-access.service';
import { AuthUser } from '../auth/types';
import { CreateDeadlineDto, ExtendDeadlineDto } from './dto';

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

  async listForCase(user: AuthUser, caseId: string) {
    await this.access.assertCanAccessCase(user, caseId);
    return this.prisma.deadline.findMany({ where: { caseId }, orderBy: { dueAt: 'asc' } });
  }

  async extend(user: AuthUser, deadlineId: string, dto: ExtendDeadlineDto) {
    const deadline = await this.prisma.deadline.findUnique({ where: { id: deadlineId } });
    if (!deadline) throw new NotFoundException('Deadline not found.');
    await this.assertCanManage(user, deadline.caseId);
    const updated = await this.prisma.deadline.update({
      where: { id: deadlineId },
      data: { extendedTo: new Date(dto.extendedTo), dueAt: new Date(dto.extendedTo), status: DeadlineStatus.EXTENDED },
    });
    await this.audit.record({ userId: user.id, action: 'DEADLINE_EXTENDED', entityType: 'Deadline', entityId: deadlineId, caseId: deadline.caseId });
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
