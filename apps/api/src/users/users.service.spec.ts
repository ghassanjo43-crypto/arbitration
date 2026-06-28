import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { validate } from 'class-validator';
import { Permission, Role } from '@gaap/shared';
import { UsersService } from './users.service';
import { UpdateUserDto } from './dto';
import { AuthUser } from '../auth/types';

type Links = {
  count?: Partial<Record<'caseTeamMembers' | 'documentsUploaded' | 'documentActivity' | 'messagesSent' | 'auditLogs' | 'supportTickets' | 'identityChecks' | 'ruleAcceptances' | 'companyMembers', number>>;
  individual?: boolean; lawyer?: boolean; arbitrator?: boolean;
  casesFiled?: number; appointments?: number; disclosures?: number; legalHolds?: number; caseAudit?: number;
};
type TargetSpec = { id?: string; roles: string[]; status?: string; email?: string; emailVerified?: boolean; links?: Links };

function makeService(target?: TargetSpec, superAdminCount = 2) {
  const zeros = { caseTeamMembers: 0, documentsUploaded: 0, documentActivity: 0, messagesSent: 0, auditLogs: 0, supportTickets: 0, identityChecks: 0, ruleAcceptances: 0, companyMembers: 0 };
  const targetRow = target
    ? {
        id: target.id ?? 'target-id',
        email: target.email ?? 'target@example.test',
        status: target.status ?? 'ACTIVE',
        emailVerified: target.emailVerified ?? true,
        roles: target.roles.map((role) => ({ role })),
        profile: { firstName: 'T', lastName: 'Arget', displayName: 'T Arget' },
        _count: { ...zeros, ...(target.links?.count ?? {}) },
        individual: target.links?.individual ? { id: 'ip' } : null,
        lawyer: target.links?.lawyer ? { id: 'lp' } : null,
        arbitrator: target.links?.arbitrator ? { id: 'ap' } : null,
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
      delete: jest.fn().mockResolvedValue({}),
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
    case: { count: jest.fn().mockResolvedValue(target?.links?.casesFiled ?? 0) },
    auditLog: { count: jest.fn().mockResolvedValue(target?.links?.caseAudit ?? 0) },
    appointmentInvitation: { count: jest.fn().mockResolvedValue(target?.links?.appointments ?? 0) },
    conflictDisclosure: { count: jest.fn().mockResolvedValue(target?.links?.disclosures ?? 0) },
    legalHold: { count: jest.fn().mockResolvedValue(target?.links?.legalHolds ?? 0) },
    session: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    userRole: { count: jest.fn().mockResolvedValue(superAdminCount), deleteMany: jest.fn(), createMany: jest.fn() },
    emailDelivery: { findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn().mockResolvedValue([]),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const passwords = { hash: jest.fn().mockResolvedValue('hashed-pw') };
  const auth = { requestPasswordReset: jest.fn().mockResolvedValue({ success: true }) };
  const delivery = { sendTracked: jest.fn().mockResolvedValue({ id: 'del-1', status: 'SENT' }) };
  const config = { get: jest.fn().mockReturnValue('https://web.test') };
  const service = new UsersService(prisma as never, audit as never, passwords as never, auth as never, delivery as never, config as never);
  return { service, prisma, audit, passwords, auth, delivery, config };
}

const admin: AuthUser = { id: 'admin-id', email: 'admin@x.test', roles: [Role.ADMIN], permissions: [Permission.USER_MANAGE] };
const superAdmin: AuthUser = {
  id: 'super-id',
  email: 'super@x.test',
  roles: [Role.SUPER_ADMIN],
  permissions: [Permission.USER_MANAGE, Permission.ROLE_MANAGE],
};

describe('UsersService — administration safety', () => {
  it('archives a regular user (soft delete + session revoke)', async () => {
    const { service, prisma, audit } = makeService({ roles: [Role.INDIVIDUAL] });
    const res = await service.archive(admin, 'target-id');
    expect(res).toEqual({ archived: true, id: 'target-id' });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'USER_ARCHIVED' }));
  });

  it('refuses to let an admin archive their own account', async () => {
    const { service } = makeService({ roles: [Role.ADMIN] });
    await expect(service.archive(admin, admin.id)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('blocks a non-super admin from archiving a super administrator', async () => {
    const { service } = makeService({ roles: [Role.SUPER_ADMIN] });
    await expect(service.archive(admin, 'target-id')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses to archive the last super administrator', async () => {
    const { service } = makeService({ roles: [Role.SUPER_ADMIN] }, 1);
    await expect(service.archive(superAdmin, 'target-id')).rejects.toBeInstanceOf(BadRequestException);
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

describe('UsersService — deletion safety (only unlinked accounts)', () => {
  it('permanently deletes an unlinked user and frees the email', async () => {
    const { service, prisma, audit } = makeService({ roles: [Role.INDIVIDUAL] }); // no links
    const res = await service.hardDelete(superAdmin, 'target-id');
    expect(res).toMatchObject({ deleted: true, id: 'target-id', email: 'target@example.test' });
    expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: 'target-id' } });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'USER_DELETED_PERMANENTLY' }));
  });

  it('blocks hard delete when linked to a case (and audits the block)', async () => {
    const { service, prisma, audit } = makeService({ roles: [Role.INDIVIDUAL], links: { count: { caseTeamMembers: 2 } } });
    await expect(service.hardDelete(superAdmin, 'target-id')).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.user.delete).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'USER_DELETE_BLOCKED_LINKED_RECORDS' }));
  });

  it('blocks hard delete when linked to an arbitrator profile', async () => {
    const { service } = makeService({ roles: [Role.ARBITRATOR], links: { arbitrator: true } });
    await expect(service.hardDelete(superAdmin, 'target-id')).rejects.toBeInstanceOf(ConflictException);
  });

  it('blocks hard delete when linked to CASE-connected audit activity', async () => {
    const { service, prisma } = makeService({ roles: [Role.INDIVIDUAL], links: { caseAudit: 15 } });
    await expect(service.hardDelete(superAdmin, 'target-id')).rejects.toBeInstanceOf(ConflictException);
    // Only case-connected audit logs are counted (caseId present).
    expect(prisma.auditLog.count).toHaveBeenCalledWith({ where: { userId: 'target-id', caseId: { not: null } } });
  });

  it('ALLOWS permanent delete when the only history is non-case admin audit logs', async () => {
    // caseAudit defaults to 0 → bare admin/system audit logs do not block.
    const { service, prisma } = makeService({ roles: [Role.INDIVIDUAL] });
    const res = await service.hardDelete(superAdmin, 'target-id');
    expect(res).toMatchObject({ deleted: true });
    expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: 'target-id' } });
  });

  it('deleteCheck reports blocking counts and audits the check', async () => {
    const { service, audit } = makeService({ roles: [Role.INDIVIDUAL], links: { count: { caseTeamMembers: 2, documentsUploaded: 4 }, casesFiled: 1 } });
    const res = await service.deleteCheck(superAdmin, 'target-id');
    expect(res.canDelete).toBe(false);
    expect(res.blockers).toMatchObject({ 'Case memberships': 2, 'Documents': 4, 'Cases filed': 1 });
    expect(res.total).toBe(7);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'USER_DELETE_CHECKED' }));
  });

  it('blocks a non-super-admin from hard-deleting a user', async () => {
    const { service } = makeService({ roles: [Role.INDIVIDUAL] });
    await expect(service.hardDelete(admin, 'target-id')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('still allows archiving a linked user', async () => {
    const { service, audit } = makeService({ roles: [Role.INDIVIDUAL], links: { count: { auditLogs: 5 } } });
    const res = await service.archive(admin, 'target-id');
    expect(res).toEqual({ archived: true, id: 'target-id' });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'USER_ARCHIVED' }));
  });
});

describe('UsersService — identity classification', () => {
  it('derives identityType and case roles in the view (no generic "private individual")', async () => {
    const { service, prisma } = makeService({ roles: [Role.COMPANY_CLIENT] });
    // get() includes caseTeamMembers; make the target carry an active claimant membership.
    prisma.user.findUnique.mockImplementation((args: { where: { id?: string; email?: string } }) =>
      args.where.email ? Promise.resolve(null) : Promise.resolve({
        id: 'target-id', email: 'co@x.test', status: 'ACTIVE', emailVerified: true, createdAt: new Date(), deletedAt: null,
        profile: { firstName: 'C', lastName: 'O', displayName: 'C O' },
        roles: [{ role: Role.COMPANY_CLIENT }],
        caseTeamMembers: [{ caseRole: 'RESPONDENT' }],
      }),
    );
    const view = await service.get('target-id');
    expect(view.identityType).toBe('COMPANY');
    expect(view.caseRoles).toEqual(['RESPONDENT']);
    expect((view as { roles: string[] }).roles).not.toContain('Private Individual');
  });

  it('lets a Super Admin change identity type, preserving system roles, and audits it', async () => {
    const { service, prisma, audit } = makeService({ roles: [Role.INDIVIDUAL, Role.REGISTRAR] });
    await service.setIdentityType(superAdmin, 'target-id', 'COMPANY' as never);
    // Re-creates roles = system roles preserved + new identity role.
    const created = prisma.userRole.createMany.mock.calls[0][0].data.map((d: { role: string }) => d.role);
    expect(created).toContain(Role.COMPANY_CLIENT);
    expect(created).toContain(Role.REGISTRAR); // system role preserved
    expect(created).not.toContain(Role.INDIVIDUAL); // old identity replaced
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'USER_IDENTITY_TYPE_CHANGED' }));
  });

  it('blocks a non-role-manager from changing identity type', async () => {
    const { service } = makeService({ roles: [Role.INDIVIDUAL] });
    await expect(service.setIdentityType(admin, 'target-id', 'COMPANY' as never)).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('UsersService — account-notification emails', () => {
  it('sends a tracked enrollment email on create — and never includes a plaintext password', async () => {
    const { service, delivery, audit } = makeService(undefined);
    const res = await service.create(superAdmin, { email: 'New@Example.test', firstName: 'New', lastName: 'User' });
    expect(delivery.sendTracked).toHaveBeenCalledWith(expect.objectContaining({ to: 'new@example.test', templateKey: 'user.enrollment' }));
    const sent = delivery.sendTracked.mock.calls[0][0];
    expect(sent.text).not.toContain(res.temporaryPassword); // password is never emailed
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'USER_ENROLLMENT_EMAIL' }));
  });

  it('notifies BOTH the old and new address when the login email changes', async () => {
    const { service, delivery } = makeService({ roles: [Role.INDIVIDUAL] });
    await service.update(superAdmin, 'target-id', { email: 'NEW@x.test' });
    const calls = delivery.sendTracked.mock.calls.map((c) => c[0]);
    expect(calls.some((m) => m.to === 'new@x.test' && m.templateKey === 'user.email_changed.new')).toBe(true);
    expect(calls.some((m) => m.to === 'target@example.test' && m.templateKey === 'user.email_changed.old')).toBe(true);
  });

  it('emails the user when roles/authorities change', async () => {
    const { service, delivery } = makeService({ roles: [Role.INDIVIDUAL] });
    await service.setRoles(superAdmin, 'target-id', { roles: [Role.LAWYER] });
    expect(delivery.sendTracked).toHaveBeenCalledWith(expect.objectContaining({ templateKey: 'user.role_changed' }));
  });

  it('still creates the user when the email send fails (failure recorded, not thrown)', async () => {
    const { service, delivery } = makeService(undefined);
    delivery.sendTracked.mockResolvedValue({ id: 'del-1', status: 'FAILED', failureKind: 'PERMANENT' });
    const res = await service.create(superAdmin, { email: 'a@b.test', firstName: 'A', lastName: 'B' });
    expect(res.id).toBeDefined(); // creation succeeded despite the email failure
  });

  it('resends the enrollment email on demand', async () => {
    const { service, delivery } = makeService({ roles: [Role.INDIVIDUAL] });
    const res = await service.sendEnrollmentEmail(admin, 'target-id');
    expect(res).toMatchObject({ sent: true });
    expect(delivery.sendTracked).toHaveBeenCalledWith(expect.objectContaining({ templateKey: 'user.enrollment' }));
  });

  it('sends a password-setup link via the reset flow (no plaintext password)', async () => {
    const { service, auth } = makeService({ roles: [Role.INDIVIDUAL] });
    await service.sendPasswordSetupEmail(admin, 'target-id');
    expect(auth.requestPasswordReset).toHaveBeenCalledWith('target@example.test');
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
