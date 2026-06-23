import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { HearingRoomKind, HearingStatus } from '@prisma/client';
import { Permission } from '@gaap/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CaseAccessService, CaseMembership } from '../authz/case-access.service';
import { VideoService } from '../providers/video/video.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuthUser } from '../auth/types';
import { AddParticipantDto, AttendanceDto, ScheduleHearingDto, UpdateHearingDto } from './dto';

@Injectable()
export class HearingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: CaseAccessService,
    private readonly video: VideoService,
    private readonly notifications: NotificationsService,
  ) {}

  private async assertCanManage(user: AuthUser, caseId: string): Promise<CaseMembership> {
    const m = await this.access.assertCanAccessCase(user, caseId);
    if (!m.isTribunal && !user.permissions.includes(Permission.CASE_SCHEDULE_HEARING)) {
      throw new ForbiddenException('Only the registry or the tribunal may schedule hearings.');
    }
    return m;
  }

  /** Whether the user may obtain a join link for a given room kind. */
  private canAccessRoom(kind: HearingRoomKind, m: CaseMembership, staffManage: boolean): boolean {
    switch (kind) {
      // The tribunal's private room is tribunal-only — the same confidentiality
      // line as deliberations. No party, registrar, or super-admin enters.
      case HearingRoomKind.TRIBUNAL:
        return m.isTribunal;
      // Party-private consultation: the parties and the tribunal, not staff.
      case HearingRoomKind.BREAKOUT:
        return m.isTribunal || m.isParty;
      // Witness sequestration: tribunal + administering registry only; parties
      // do not get to sit in the witness room.
      case HearingRoomKind.WITNESS_WAITING:
        return m.isTribunal || staffManage;
      case HearingRoomKind.MAIN:
      case HearingRoomKind.PARTY_WAITING:
        return m.isTribunal || m.isParty || staffManage;
      default:
        return false;
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

    // Rooms auto-expire shortly after the hearing ends (or +24h if no end set).
    const end = dto.scheduledEnd ? new Date(dto.scheduledEnd) : new Date(new Date(dto.scheduledStart).getTime() + 24 * 60 * 60 * 1000);
    const expiresAt = Math.floor(end.getTime() / 1000) + 60 * 60;

    // Provision provider rooms via the abstraction (placeholder adapter in dev).
    const provisioned = await Promise.all(
      roomKinds.map(async (r) => {
        const room = await this.video.createRoom(`${dto.title} — ${r.name}`, expiresAt);
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
        provider: this.video.providerName,
        rooms: { create: provisioned.map((r) => ({ kind: r.kind, name: r.name, joinUrl: r.joinUrl })) },
      },
      include: { rooms: true },
    });

    await this.audit.record({
      userId: user.id,
      action: 'HEARING_SCHEDULED',
      entityType: 'Hearing',
      entityId: hearing.id,
      caseId,
      metadata: { provider: this.video.providerName, rooms: provisioned.length },
    });

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
    return this.toMeta(hearing, user, await this.access.getMembership(user, caseId));
  }

  async listForCase(user: AuthUser, caseId: string) {
    const membership = await this.access.assertCanAccessCase(user, caseId);
    const hearings = await this.prisma.hearing.findMany({
      where: { caseId },
      include: { rooms: true, participants: true },
      orderBy: { scheduledStart: 'desc' },
    });
    return hearings.map((h) => this.toMeta(h, user, membership));
  }

  /**
   * Issues a one-time, authorised join link for a single room and audits the
   * access. Join URLs are NEVER returned in bulk listings — they are minted here,
   * per request, only for a participant entitled to that specific room.
   */
  async getRoomJoinLink(user: AuthUser, hearingId: string, roomId: string, ip?: string) {
    const room = await this.prisma.hearingRoom.findUnique({
      where: { id: roomId },
      include: { hearing: true },
    });
    if (!room || room.hearingId !== hearingId) throw new NotFoundException('Hearing room not found.');

    const membership = await this.access.assertCanAccessCase(user, room.hearing.caseId);
    const staffManage = user.permissions.includes(Permission.CASE_SCHEDULE_HEARING);

    if (!this.canAccessRoom(room.kind, membership, staffManage)) {
      throw new ForbiddenException('You are not authorised to join this room.');
    }
    if (room.hearing.status === HearingStatus.CANCELLED) {
      throw new BadRequestException('This hearing has been cancelled.');
    }
    if (!room.joinUrl) throw new NotFoundException('No meeting link is available for this room.');

    const owner = membership.isTribunal || staffManage;
    const joinUrl = await this.video.issueJoinUrl(room.joinUrl, { owner, userName: user.email });
    if (!joinUrl) throw new BadRequestException('A meeting link could not be issued for this room.');

    await this.audit.record({
      userId: user.id,
      action: 'HEARING_LINK_ACCESS',
      entityType: 'HearingRoom',
      entityId: room.id,
      caseId: room.hearing.caseId,
      ipAddress: ip,
      metadata: { hearingId, roomKind: room.kind, owner },
    });
    return { roomKind: room.kind, joinUrl };
  }

  async update(user: AuthUser, hearingId: string, dto: UpdateHearingDto) {
    const hearing = await this.prisma.hearing.findUnique({ where: { id: hearingId } });
    if (!hearing) throw new NotFoundException('Hearing not found.');
    await this.assertCanManage(user, hearing.caseId);
    if (hearing.status === HearingStatus.CANCELLED) {
      throw new BadRequestException('A cancelled hearing cannot be updated.');
    }

    const updated = await this.prisma.hearing.update({
      where: { id: hearingId },
      data: {
        scheduledStart: dto.scheduledStart ? new Date(dto.scheduledStart) : undefined,
        scheduledEnd: dto.scheduledEnd ? new Date(dto.scheduledEnd) : undefined,
        timezone: dto.timezone,
        agenda: dto.agenda,
        recordingPermitted: dto.recordingPermitted,
        backupContact: dto.backupContact,
        status: dto.status,
      },
      include: { rooms: true, participants: true },
    });

    await this.audit.record({
      userId: user.id,
      action: 'HEARING_UPDATED',
      entityType: 'Hearing',
      entityId: hearingId,
      caseId: hearing.caseId,
      metadata: { changed: Object.keys(dto) },
    });

    const ref = await this.prisma.case.findUnique({ where: { id: hearing.caseId }, select: { reference: true } });
    await this.notifications.notifyCaseMembers({
      caseId: hearing.caseId,
      key: 'HEARING_SCHEDULED',
      vars: {
        caseRef: ref?.reference ?? hearing.caseId,
        dateTime: updated.scheduledStart.toISOString().slice(0, 16).replace('T', ' '),
        timezone: updated.timezone,
      },
      link: `/app/cases/${hearing.caseId}`,
      partyOnly: true,
    });
    return this.toMeta(updated, user, await this.access.getMembership(user, hearing.caseId));
  }

  async cancel(user: AuthUser, hearingId: string) {
    const hearing = await this.prisma.hearing.findUnique({ where: { id: hearingId }, include: { rooms: true } });
    if (!hearing) throw new NotFoundException('Hearing not found.');
    await this.assertCanManage(user, hearing.caseId);
    if (hearing.status === HearingStatus.CANCELLED) return { id: hearingId, status: HearingStatus.CANCELLED };

    // Best-effort teardown of provider rooms so links stop working immediately.
    await Promise.all(hearing.rooms.map((r) => (r.joinUrl ? this.video.deleteRoom(r.joinUrl) : Promise.resolve())));

    const updated = await this.prisma.hearing.update({
      where: { id: hearingId },
      data: { status: HearingStatus.CANCELLED },
    });

    await this.audit.record({
      userId: user.id,
      action: 'HEARING_CANCELLED',
      entityType: 'Hearing',
      entityId: hearingId,
      caseId: hearing.caseId,
    });

    const ref = await this.prisma.case.findUnique({ where: { id: hearing.caseId }, select: { reference: true } });
    await this.notifications.notifyCaseMembers({
      caseId: hearing.caseId,
      key: 'HEARING_SCHEDULED',
      vars: { caseRef: ref?.reference ?? hearing.caseId, dateTime: '—', timezone: hearing.timezone },
      link: `/app/cases/${hearing.caseId}`,
      partyOnly: true,
    });
    return { id: updated.id, status: updated.status };
  }

  async addParticipant(user: AuthUser, hearingId: string, dto: AddParticipantDto) {
    const hearing = await this.prisma.hearing.findUnique({ where: { id: hearingId } });
    if (!hearing) throw new NotFoundException('Hearing not found.');
    await this.assertCanManage(user, hearing.caseId);
    const participant = await this.prisma.hearingParticipant.create({
      data: { hearingId, userId: dto.userId, displayName: dto.displayName, role: dto.role },
    });
    await this.audit.record({
      userId: user.id,
      action: 'HEARING_PARTICIPANT_ADDED',
      entityType: 'HearingParticipant',
      entityId: participant.id,
      caseId: hearing.caseId,
      metadata: { role: dto.role },
    });
    return participant;
  }

  /** Records a participant joining or leaving (attendance), audited. */
  async recordAttendance(user: AuthUser, hearingId: string, participantId: string, dto: AttendanceDto) {
    const participant = await this.prisma.hearingParticipant.findUnique({
      where: { id: participantId },
      include: { hearing: true },
    });
    if (!participant || participant.hearingId !== hearingId) {
      throw new NotFoundException('Hearing participant not found.');
    }
    const caseId = participant.hearing.caseId;
    const membership = await this.access.assertCanAccessCase(user, caseId);
    const staffManage = user.permissions.includes(Permission.CASE_SCHEDULE_HEARING);
    // A participant may record their own attendance; managers may record anyone's.
    const isSelf = participant.userId != null && participant.userId === user.id;
    if (!isSelf && !membership.isTribunal && !staffManage) {
      throw new ForbiddenException('You may not record attendance for another participant.');
    }

    const updated = await this.prisma.hearingParticipant.update({
      where: { id: participantId },
      data: dto.action === 'join' ? { attendedAt: new Date() } : { leftAt: new Date() },
    });
    await this.audit.record({
      userId: user.id,
      action: dto.action === 'join' ? 'HEARING_ATTENDANCE_JOIN' : 'HEARING_ATTENDANCE_LEAVE',
      entityType: 'HearingParticipant',
      entityId: participantId,
      caseId,
      metadata: { onBehalfOf: participant.userId ?? participant.displayName },
    });
    return updated;
  }

  /**
   * Serialises a hearing for a given viewer: room join URLs are stripped and
   * replaced with a `canJoin` flag, so links are only ever obtained through the
   * audited per-room join endpoint.
   */
  private toMeta(
    hearing: {
      id: string; caseId: string; title: string; scheduledStart: Date; scheduledEnd: Date | null;
      timezone: string; status: string; provider: string; agenda: string | null; recordingPermitted: boolean;
      backupContact: string | null;
      rooms: { id: string; kind: HearingRoomKind; name: string }[];
      participants?: { id: string; displayName: string; role: string; attendedAt: Date | null; leftAt: Date | null }[];
    },
    user: AuthUser,
    membership: CaseMembership,
  ) {
    const staffManage = user.permissions.includes(Permission.CASE_SCHEDULE_HEARING);
    return {
      id: hearing.id,
      caseId: hearing.caseId,
      title: hearing.title,
      scheduledStart: hearing.scheduledStart,
      scheduledEnd: hearing.scheduledEnd,
      timezone: hearing.timezone,
      status: hearing.status,
      provider: hearing.provider,
      agenda: hearing.agenda,
      recordingPermitted: hearing.recordingPermitted,
      backupContact: hearing.backupContact,
      rooms: hearing.rooms.map((r) => ({
        id: r.id,
        kind: r.kind,
        name: r.name,
        canJoin: this.canAccessRoom(r.kind, membership, staffManage),
      })),
      participants: hearing.participants,
    };
  }
}
