import { ForbiddenException } from '@nestjs/common';
import { Permission, Role } from '@gaap/shared';
import { ArbitratorsService } from './arbitrators.service';
import { AuthUser } from '../auth/types';

const superAdmin = { id: 's1', email: 's@x.com', roles: [Role.SUPER_ADMIN], permissions: [Permission.USER_MANAGE] } as unknown as AuthUser;
const registrar = { id: 'r1', email: 'r@x.com', roles: [Role.REGISTRAR], permissions: [Permission.APPOINTMENT_MANAGE, Permission.CONFLICT_REVIEW] } as unknown as AuthUser;
const council = { id: 'c1', email: 'c@x.com', roles: [Role.COUNCIL_MEMBER], permissions: [Permission.ARBITRATOR_APPROVE] } as unknown as AuthUser;
const party = { id: 'p1', email: 'p@x.com', roles: [Role.INDIVIDUAL], permissions: [] } as unknown as AuthUser;

const jamesRow = {
  id: 'a1', fullName: "James O'Brien", availability: 'AVAILABLE', approvalStatus: 'APPROVED',
  verificationStatus: 'VERIFIED', professionalTitle: 'KC',
  user: { email: 'james.obrien@panel.example', status: 'ACTIVE' },
  legalFields: [{ kind: 'LEGAL_FIELD', field: 'Construction' }, { kind: 'INDUSTRY', field: 'Energy' }],
};

function make(rows: unknown[] = [jamesRow]) {
  const prisma = {
    arbitratorProfile: {
      findMany: jest.fn().mockResolvedValue(rows),
      count: jest.fn().mockResolvedValue(rows.length),
    },
  };
  return { service: new ArbitratorsService(prisma as never), prisma };
}

describe('ArbitratorsService.listInternal — access-email visibility', () => {
  it('lets a Super Admin see arbitrator access (login) emails', async () => {
    const { service } = make();
    const res = await service.listInternal(superAdmin, {});
    expect(res.data[0]).toMatchObject({ fullName: "James O'Brien", accessEmail: 'james.obrien@panel.example' });
  });

  it('authorises a Registrar and a Council member', async () => {
    await expect(make().service.listInternal(registrar, {})).resolves.toBeDefined();
    await expect(make().service.listInternal(council, {})).resolves.toBeDefined();
  });

  it('refuses an unauthorised user (party/public)', async () => {
    await expect(make().service.listInternal(party, {})).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('maps the demo arbitrator (James O’Brien) to the correct login email', async () => {
    const { service } = make();
    const res = await service.listInternal(superAdmin, {});
    const james = res.data.find((a) => a.fullName === "James O'Brien");
    expect(james?.accessEmail).toBe('james.obrien@panel.example');
    expect(james?.specializations).toContain('Construction');
  });

  it('searches by name OR access email', async () => {
    const { service, prisma } = make();
    await service.listInternal(superAdmin, { q: 'james.obrien' });
    const where = prisma.arbitratorProfile.findMany.mock.calls[0][0].where;
    expect(where.OR).toEqual(expect.arrayContaining([
      expect.objectContaining({ fullName: expect.anything() }),
      expect.objectContaining({ user: { email: expect.anything() } }),
    ]));
  });
});
