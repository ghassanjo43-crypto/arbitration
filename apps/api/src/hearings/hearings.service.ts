import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { HearingRoomKind } from '@prisma/client';
import { Permission } from '@gaap/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CaseAccessService } from '../authz/case-access.service';
import { VideoService } from '../providers/video/video.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuthUser } from '../auth/types';
import { AddParticipantDto, ScheduleHearingDto } from './dto';

@Injectable()
export class HearingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: CaseAccessService,
    private readonly video: VideoService,
    private readonly notifications: NotificationsService,
  ) {}

  private async assertCanManage(user: AuthUser, caseId: string) {
    const m = await this.access.assertCanAccessCase(user, caseId);
    if (!m.isTribunal && !user.permissions.includes(Permission.CASE_SCHEDULE_HEARING)) {
      throw new ForbiddenException('Only the registry or the tribunal may schedule hearings.');
    }
  }

  /** Schedules a hearing and provisions the standard set of secure rooms. */
  async schedule(user: AuthUser, caseId: string, dto: ScheduleHearingDto) {
    await this.assertCanManage(user, caseId);

    const roomKinds: { kind: HearingRoomKind; name: string }[] = [
      { kind: HearingRoomKind.MAIN, name: 'Main hearing room' },
      { kind: HearingRoomKind.TRIBUNAL, name: 'Tribunal private room' },
      { kind: HearingRoomKind.PARTY_WAITING, name: 'Party waiting room' },
      { kind: HearingRoomKind.WITNESS_WAITING, name: 'Witness waiting room' },
      { kind: HearingRoomKind.BREAKOUT, name: 'Breakout room' },
    ];

    // Provision provider rooms via the abstraction (placeholder adapter in dev).
    const provisioned = await Promise.all(
      roomKinds.map(async (r) => {
        const room = await this.video.createRoom(`${dto.title} — ${r.name}`);
        return { ...r, joinUrl: room.joinUrl };
      }),
    );

    const hearing = await this.prisma.hearing.create({
      data: {
        caseId,
        title: dto.title,
        scheduledStart: new Date(dto.scheduledStart),
        scheduledEnd: dto.scheduledEnd ? new Date(dto.scheduledEnd) : undefined,
        timezone: dto.timezone ?? 'UTC',
        agenda: dto.agenda,
        recordingPermitted: dto.recordingPermitted ?? false,
        backupContact: dto.backupContact,
        provider: provisioned[0] ? 'placeholder' : 'placeholder',
        rooms: { create: provisioned.map((r) => ({ kind: r.kind, name: r.name, joinUrl: r.joinUrl })) },
      },
      include: { rooms: true },
    });

    await this.audit.record({ userId: user.id, action: 'HEARING_SCHEDULED', entityType: 'Hearing', entityId: hearing.id, caseId });

    // Notify the parties. A preliminary procedural conference gets its own template.
    const ref = await this.prisma.case.findUnique({ where: { id: caseId }, select: { reference: true } });
    const isConference = /conference/i.test(dto.title);
    await this.notifications.notifyCaseMembers({
      caseId,
      key: isConference ? 'PROCEDURAL_CONFERENCE' : 'HEARING_SCHEDULED',
      vars: { caseRef: ref?.reference ?? caseId, dateTime: new Date(dto.scheduledStart).toISOString().slice(0, 16).replace('T', ' '), timezone: hearing.timezone },
      link: `/app/cases/${caseId}`,
      partyOnly: true,
    });
    return hearing;
  }

  async listForCase(user: AuthUser, caseId: string) {
    await this.access.assertCanAccessCase(user, caseId);
    return this.prisma.hearing.findMany({
      where: { caseId },
      include: { rooms: true, participants: true },
      orderBy: { scheduledStart: 'desc' },
    });
  }

  async addParticipant(user: AuthUser, hearingId: string, dto: AddParticipantDto) {
    const hearing = await this.prisma.hearing.findUnique({ where: { id: hearingId } });
    if (!hearing) throw new NotFoundException('Hearing not found.');
    await this.assertCanManage(user, hearing.caseId);
    return this.prisma.hearingParticipant.create({
      data: { hearingId, userId: dto.userId, displayName: dto.displayName, role: dto.role },
    });
  }
}
