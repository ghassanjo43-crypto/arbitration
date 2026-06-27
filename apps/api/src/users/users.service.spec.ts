import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { validate } from 'class-validator';
import { Permission, Role } from '@gaap/shared';
import { UsersService } from './users.service';
import { UpdateUserDto } from './dto';
import { AuthUser } from '../auth/types';

type TargetSpec = { id?: string; roles: string[]; status?: string; email?: string; emailVerified?: boolean };

function makeService(target?: TargetSpec, superAdminCount = 2) {
  const targetRow = target
    ? {
        id: target.id ?? 'target-id',
        email: target.email ?? 'target@example.test',
        status: target.status ?? 'ACTIVE',
        emailVerified: target.emailVerified ?? true,
        roles: target.roles.map((role) => ({ role })),
        profile: { firstName: 'T', lastName: 'Arget', displayName: 'T Arget' },
      }
    : null;

  const prisma = {
    user: {
      // loadTarget queries by id; create's uniqueness check queries by email.
      findUnique: jest.fn().mockImplementation((args: { where: { id?: string; email?: string } }) => {
        if (args.where.email) return Promise.resolve(null); // no email clash by default
        return Promise.resolve(targetRow);
      }),
      update: jest.fn().mockResolvedValue({ ...(targetRow ?? {}), roles: targetRow?.roles ?? [] }),
      create: jest.fn().mockImplementation((args: { data: { email: string } }) =>
        Promise.resolve({
          id: 'new-id',
          email: args.data.email,
          status: 'ACTIVE',
          emailVerified: false,
          createdAt: new Date(),
          deletedAt: null,
          profile: { firstName: 'New', lastName: 'User', displayName: 'New User' },
          roles: [],
        }),
      ),
    },
    session: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    userRole: { count: jest.fn().mockResolvedValue(superAdminCount), deleteMany: jest.fn(), createMany: jest.fn() },
    $transaction: jest.fn().mockResolvedValue([]),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const passwords = { hash: jest.fn().mockResolvedValue('hashed-pw') };
  const auth = { requestPasswordReset: jest.fn().mockResolvedValue({ success: true }) };
  const service = new UsersService(prisma as never, audit as never, passwords as never, auth as never);
  return { service, prisma, audit, passwords, auth };
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

describe('UsersService — create', () => {
  it('lets a super administrator create a user and returns a temporary password', async () => {
    const { service, prisma, audit } = makeService(undefined);
    const res = await service.create(superAdmin, { email: 'New@Example.test', firstName: 'New', lastName: 'User' });
    expect(prisma.user.create).toHaveBeenCalledTimes(1);
    expect(typeof res.temporaryPassword).toBe('string');
    expect(res.temporaryPassword!.length).toBeGreaterThan(8);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'ADMIN_USER_CREATED' }));
  });

  it('does not return a password when one is supplied', async () => {
    const { service } = makeService(undefined);
    const res = await service.create(superAdmin, { email: 'a@b.test', firstName: 'A', lastName: 'B', password: 'supplied-pw-123' });
    expect(res.temporaryPassword).toBeUndefined();
  });

  it('blocks a plain admin from creating a user with a staff role (escalation)', async () => {
    const { service } = makeService(undefined);
    await expect(
      service.create(admin, { email: 'r@x.test', firstName: 'R', lastName: 'Eg', roles: [Role.REGISTRAR] }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('UsersService — roles (assign/remove)', () => {
  it('records a distinct audit event for each role added and removed', async () => {
    const { service, audit } = makeService({ roles: [Role.INDIVIDUAL] });
    await service.setRoles(superAdmin, 'target-id', { roles: [Role.LAWYER, Role.ARBITRATOR] });
    const actions = audit.record.mock.calls.map((c) => c[0].action);
    expect(actions).toContain('ADMIN_USER_ROLE_ADDED');
    expect(actions).toContain('ADMIN_USER_ROLE_REMOVED');
    // INDIVIDUAL removed, LAWYER + ARBITRATOR added → 1 removed + 2 added events.
    expect(actions.filter((a) => a === 'ADMIN_USER_ROLE_ADDED')).toHaveLength(2);
    expect(actions.filter((a) => a === 'ADMIN_USER_ROLE_REMOVED')).toHaveLength(1);
  });
});

describe('UsersService — lifecycle transitions', () => {
  it('suspends a user, emits ADMIN_USER_SUSPENDED, and revokes sessions', async () => {
    const { service, prisma, audit } = makeService({ roles: [Role.INDIVIDUAL], status: 'ACTIVE' });
    await service.update(admin, 'target-id', { status: 'SUSPENDED' as never });
    const actions = audit.record.mock.calls.map((c) => c[0].action);
    expect(actions).toContain('ADMIN_USER_SUSPENDED');
    expect(prisma.session.updateMany).toHaveBeenCalled();
  });

  it('reactivates a suspended user and emits ADMIN_USER_REACTIVATED', async () => {
    const { service, audit } = makeService({ roles: [Role.INDIVIDUAL], status: 'SUSPENDED' });
    await service.update(admin, 'target-id', { status: 'ACTIVE' as never });
    const actions = audit.record.mock.calls.map((c) => c[0].action);
    expect(actions).toContain('ADMIN_USER_REACTIVATED');
  });
});

describe('UsersService — login email update', () => {
  it('updates a user email (normalized lowercase), re-unverifies, and audits old → new', async () => {
    const { service, prisma, audit } = makeService({ roles: [Role.INDIVIDUAL] });
    await service.update(superAdmin, 'target-id', { email: 'NEW@X.test' });
    expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'target-id' },
      data: expect.objectContaining({ email: 'new@x.test', emailVerified: false }),
    }));
    const emailEvent = audit.record.mock.calls.map((c) => c[0]).find((e) => e.action === 'USER_EMAIL_UPDATED');
    expect(emailEvent).toBeDefined();
    expect(emailEvent!.metadata).toMatchObject({ from: 'target@example.test', to: 'new@x.test' });
  });

  it('rejects a duplicate email', async () => {
    const { service, prisma } = makeService({ roles: [Role.INDIVIDUAL] });
    prisma.user.findUnique.mockImplementation((args: { where: { id?: string; email?: string } }) =>
      args.where.email
        ? Promise.resolve({ id: 'someone-else' }) // clash on the target email
        : Promise.resolve({ id: 'target-id', email: 'target@example.test', status: 'ACTIVE', emailVerified: true, roles: [{ role: Role.INDIVIDUAL }] }),
    );
    await expect(service.update(superAdmin, 'target-id', { email: 'dup@x.test' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('keeps account linkage by user id (updates the user by id, never by email)', async () => {
    const { service, prisma } = makeService({ roles: [Role.INDIVIDUAL] });
    await service.update(superAdmin, 'target-id', { email: 'moved@x.test' });
    // Memberships, arbitrator profile, appointments, audit and case history all
    // reference the user id, which is unchanged by an email edit.
    expect(prisma.user.update.mock.calls[0][0].where).toEqual({ id: 'target-id' });
  });
});

describe('UpdateUserDto — email validation', () => {
  it('rejects an invalid email', async () => {
    const dto = new UpdateUserDto();
    dto.email = 'not-an-email';
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'email')).toBe(true);
  });

  it('accepts a valid email', async () => {
    const dto = new UpdateUserDto();
    dto.email = 'good@x.test';
    const errors = await validate(dto);
    expect(errors.find((e) => e.property === 'email')).toBeUndefined();
  });
});

describe('UsersService — password reset', () => {
  it('sets a temporary password, revokes sessions, and audits it', async () => {
    const { service, prisma, audit } = makeService({ roles: [Role.INDIVIDUAL] });
    const res = await service.resetPassword(admin, 'target-id', {});
    expect(res.mode).toBe('set-password');
    if (res.mode !== 'set-password') throw new Error('expected set-password mode');
    expect(typeof res.temporaryPassword).toBe('string');
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'ADMIN_USER_PASSWORD_RESET' }));
  });

  it('triggers the e-mail reset flow when sendEmail is set', async () => {
    const { service, auth } = makeService({ roles: [Role.INDIVIDUAL], email: 'u@x.test' });
    const res = await service.resetPassword(admin, 'target-id', { sendEmail: true });
    expect(res.mode).toBe('email-link');
    expect(auth.requestPasswordReset).toHaveBeenCalledWith('u@x.test');
  });

  it('blocks a plain admin from resetting a super administrator password', async () => {
    const { service } = makeService({ roles: [Role.SUPER_ADMIN] });
    await expect(service.resetPassword(admin, 'target-id', {})).rejects.toBeInstanceOf(ForbiddenException);
  });
});
