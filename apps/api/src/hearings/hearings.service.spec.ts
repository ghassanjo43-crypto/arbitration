import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { HearingRoomKind, HearingStatus } from '@prisma/client';
import { Permission } from '@gaap/shared';
import { HearingsService } from './hearings.service';
import { AuthUser } from '../auth/types';

const party = { id: 'p1', email: 'p@x.com', roles: [], permissions: [] } as unknown as AuthUser;
const arbitrator = { id: 'a1', email: 'a@x.com', roles: [], permissions: [] } as unknown as AuthUser;
const registrar = { id: 'r1', email: 'r@x.com', roles: [], permissions: [Permission.CASE_SCHEDULE_HEARING] } as unknown as AuthUser;
const outsider = { id: 'o1', email: 'o@x.com', roles: [], permissions: [] } as unknown as AuthUser;

const ROOMS = [
  { id: 'rm-main', kind: HearingRoomKind.MAIN, name: 'Main', joinUrl: 'https://v/main' },
  { id: 'rm-trib', kind: HearingRoomKind.TRIBUNAL, name: 'Tribunal', joinUrl: 'https://v/trib' },
  { id: 'rm-wit', kind: HearingRoomKind.WITNESS_WAITING, name: 'Witness', joinUrl: 'https://v/wit' },
  { id: 'rm-brk', kind: HearingRoomKind.BREAKOUT, name: 'Breakout', joinUrl: 'https://v/brk' },
];

function make(membership: Record<string, unknown>, opts: { accessThrows?: boolean; videoThrows?: boolean } = {}) {
  const prisma = {
    hearingRoom: {
      findUnique: jest.fn(({ where }: { where: { id: string } }) => {
        const room = ROOMS.find((r) => r.id === where.id);
        return room ? { ...room, hearingId: 'h1', hearing: { id: 'h1', caseId: 'c1', status: HearingStatus.SCHEDULED } } : null;
      }),
    },
    hearing: {
      findMany: jest.fn().mockResolvedValue([
        { id: 'h1', caseId: 'c1', title: 'Merits', scheduledStart: new Date(), scheduledEnd: null, timezone: 'UTC', status: 'SCHEDULED', provider: 'placeholder', agenda: null, recordingPermitted: false, backupContact: null, rooms: ROOMS, participants: [] },
      ]),
    },
    case: { findUnique: jest.fn().mockResolvedValue({ reference: 'GAAP-2026-1' }) },
  };
  const audit = { record: jest.fn() };
  const access = {
    assertCanAccessCase: opts.accessThrows
      ? jest.fn().mockRejectedValue(new ForbiddenException('not authorised'))
      : jest.fn().mockResolvedValue(membership),
    getMembership: jest.fn().mockResolvedValue(membership),
  };
  const video = {
    providerName: 'placeholder',
    issueJoinUrl: opts.videoThrows
      ? jest.fn().mockRejectedValue(new Error('provider down'))
      : jest.fn().mockResolvedValue('https://v/main?t=tok'),
    deleteRoom: jest.fn().mockResolvedValue(undefined),
  };
  const notifications = { notifyCaseMembers: jest.fn() };
  const service = new HearingsService(prisma as never, audit as never, access as never, video as never, notifications as never);
  return { service, prisma, audit, video };
}

describe('HearingsService — secure room access', () => {
  it('denies a non-member any join link (unauthorized hearing access)', async () => {
    const { service } = make({}, { accessThrows: true });
    await expect(service.getRoomJoinLink(outsider, 'h1', 'rm-main')).rejects.toThrow(ForbiddenException);
  });

  it('lets the tribunal into the tribunal-only room', async () => {
    const { service, audit } = make({ isTribunal: true, isParty: false });
    const res = await service.getRoomJoinLink(arbitrator, 'h1', 'rm-trib');
    expect(res.joinUrl).toContain('t=tok');
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'HEARING_LINK_ACCESS' }));
  });

  it('keeps a party OUT of the tribunal-only room', async () => {
    const { service } = make({ isTribunal: false, isParty: true });
    await expect(service.getRoomJoinLink(party, 'h1', 'rm-trib')).rejects.toThrow(ForbiddenException);
  });

  it('keeps a party OUT of the witness waiting room (sequestration)', async () => {
    const { service } = make({ isTribunal: false, isParty: true });
    await expect(service.getRoomJoinLink(party, 'h1', 'rm-wit')).rejects.toThrow(ForbiddenException);
  });

  it('lets a party into the main room, and the tribunal joins as owner', async () => {
    const partyCtx = make({ isTribunal: false, isParty: true });
    await expect(partyCtx.service.getRoomJoinLink(party, 'h1', 'rm-main')).resolves.toBeDefined();
    expect(partyCtx.video.issueJoinUrl).toHaveBeenCalledWith('https://v/main', expect.objectContaining({ owner: false }));

    const tribCtx = make({ isTribunal: true, isParty: false });
    await tribCtx.service.getRoomJoinLink(arbitrator, 'h1', 'rm-main');
    expect(tribCtx.video.issueJoinUrl).toHaveBeenCalledWith('https://v/main', expect.objectContaining({ owner: true }));
  });

  it('keeps staff OUT of the party-private breakout room', async () => {
    const { service } = make({ isTribunal: false, isParty: false, isRegistrar: true });
    await expect(service.getRoomJoinLink(registrar, 'h1', 'rm-brk')).rejects.toThrow(ForbiddenException);
  });

  it('refuses to issue a link for a cancelled hearing', async () => {
    const { service, prisma } = make({ isTribunal: true });
    (prisma.hearingRoom.findUnique as jest.Mock).mockReturnValueOnce({
      ...ROOMS[1], hearingId: 'h1', hearing: { id: 'h1', caseId: 'c1', status: HearingStatus.CANCELLED },
    });
    await expect(service.getRoomJoinLink(arbitrator, 'h1', 'rm-trib')).rejects.toThrow(BadRequestException);
  });

  it('propagates a provider failure rather than leaking a broken link', async () => {
    const { service } = make({ isTribunal: true }, { videoThrows: true });
    await expect(service.getRoomJoinLink(arbitrator, 'h1', 'rm-trib')).rejects.toThrow(/provider down/);
  });
});

describe('HearingsService — listing never leaks raw join URLs', () => {
  it('strips joinUrl and exposes only a per-room canJoin flag', async () => {
    const { service } = make({ isTribunal: false, isParty: true });
    const [hearing] = await service.listForCase(party, 'c1');
    for (const room of hearing.rooms) {
      expect((room as Record<string, unknown>).joinUrl).toBeUndefined();
    }
    const byKind = Object.fromEntries(hearing.rooms.map((r) => [r.kind, r.canJoin]));
    expect(byKind[HearingRoomKind.MAIN]).toBe(true);
    expect(byKind[HearingRoomKind.TRIBUNAL]).toBe(false);
    expect(byKind[HearingRoomKind.WITNESS_WAITING]).toBe(false);
  });
});
