import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Permission, Role } from '@gaap/shared';
import { UsersService } from './users.service';
import { AuthUser } from '../auth/types';

function makeService(target?: { id?: string; roles: string[] }, superAdminCount = 2) {
  const prisma = {
    user: {
      findUnique: jest.fn().mockResolvedValue(
        target
          ? { id: target.id ?? 'target-id', email: 'target@example.test', roles: target.roles.map((role) => ({ role })) }
          : null,
      ),
      update: jest.fn().mockResolvedValue({}),
    },
    session: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    userRole: { count: jest.fn().mockResolvedValue(superAdminCount), deleteMany: jest.fn(), createMany: jest.fn() },
    $transaction: jest.fn().mockResolvedValue([]),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  return { service: new UsersService(prisma as never, audit as never), prisma };
}

const admin: AuthUser = { id: 'admin-id', email: 'admin@x.test', roles: [Role.ADMIN], permissions: [Permission.USER_MANAGE] };
const superAdmin: AuthUser = {
  id: 'super-id',
  email: 'super@x.test',
  roles: [Role.SUPER_ADMIN],
  permissions: [Permission.USER_MANAGE, Permission.ROLE_MANAGE],
};

describe('UsersService — administration safety', () => {
  it('removes a regular user (soft delete + session revoke)', async () => {
    const { service, prisma } = makeService({ roles: [Role.INDIVIDUAL] });
    const res = await service.remove(admin, 'target-id');
    expect(res).toEqual({ removed: true, id: 'target-id' });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('refuses to let an admin remove their own account', async () => {
    const { service } = makeService({ roles: [Role.ADMIN] });
    await expect(service.remove(admin, admin.id)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('blocks a non-super admin from removing a super administrator', async () => {
    const { service } = makeService({ roles: [Role.SUPER_ADMIN] });
    await expect(service.remove(admin, 'target-id')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses to remove the last super administrator', async () => {
    const { service } = makeService({ roles: [Role.SUPER_ADMIN] }, 1);
    await expect(service.remove(superAdmin, 'target-id')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses to demote the last super administrator via setRoles', async () => {
    const { service } = makeService({ roles: [Role.SUPER_ADMIN] }, 1);
    await expect(service.setRoles(superAdmin, 'target-id', { roles: [Role.ADMIN] })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses to deactivate your own account via update', async () => {
    const { service } = makeService({ id: admin.id, roles: [Role.ADMIN] });
    await expect(service.update(admin, admin.id, { status: 'SUSPENDED' as never })).rejects.toBeInstanceOf(BadRequestException);
  });
});
