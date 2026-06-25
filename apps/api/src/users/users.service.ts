import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { Permission, Role, STAFF_ROLES, UserStatus } from '@gaap/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PasswordService } from '../auth/password.service';
import { AuthService } from '../auth/auth.service';
import { AuthUser } from '../auth/types';
import { CreateUserDto, ResetPasswordDto, SetRolesDto, UpdateUserDto } from './dto';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly passwords: PasswordService,
    private readonly auth: AuthService,
  ) {}

  async list(query: { q?: string; status?: string; role?: string; page?: number; pageSize?: number }) {
    const page = Math.max(query.page ?? 1, 1);
    const pageSize = Math.min(query.pageSize ?? 20, 100);
    const where: Prisma.UserWhereInput = {
      ...(query.status ? { status: query.status as never } : {}),
      ...(query.role ? { roles: { some: { role: query.role as never } } } : {}),
      ...(query.q
        ? {
            OR: [
              { email: { contains: query.q, mode: 'insensitive' } },
              { profile: { displayName: { contains: query.q, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        include: { profile: true, roles: true },
        orderBy: { createdAt: 'desc' },
        take: pageSize,
        skip: (page - 1) * pageSize,
      }),
      this.prisma.user.count({ where }),
    ]);
    return { data: rows.map((u) => this.toView(u)), total, page, pageSize };
  }

  async get(id: string) {
    const u = await this.prisma.user.findUnique({ where: { id }, include: { profile: true, roles: true } });
    if (!u) throw new NotFoundException('User not found.');
    return this.toView(u);
  }

  /**
   * Creates a platform user. Assigning any staff role is an escalation and
   * requires ROLE_MANAGE (super administrator). If no password is supplied a
   * temporary one is generated and returned exactly once so the admin can hand
   * it over; the account is otherwise created via the normal hashing path.
   */
  async create(actor: AuthUser, dto: CreateUserDto) {
    const email = dto.email.trim().toLowerCase();
    const roles = [...new Set(dto.roles ?? [])];
    this.assertCanAssignRoles(actor, roles);

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new ConflictException('A user with that email already exists.');

    const generated = dto.password ? null : generateTempPassword();
    const passwordHash = await this.passwords.hash(dto.password ?? (generated as string));
    const displayName = dto.displayName?.trim() || `${dto.firstName} ${dto.lastName}`.trim();
    const verified = dto.emailVerified ?? false;

    const created = await this.prisma.user.create({
      data: {
        email,
        passwordHash,
        status: dto.status ?? UserStatus.ACTIVE,
        emailVerified: verified,
        emailVerifiedAt: verified ? new Date() : null,
        profile: { create: { firstName: dto.firstName, lastName: dto.lastName, displayName } },
        ...(roles.length ? { roles: { create: roles.map((role) => ({ role, grantedBy: actor.id })) } } : {}),
      },
      include: { profile: true, roles: true },
    });
    await this.audit.record({
      userId: actor.id,
      action: 'ADMIN_USER_CREATED',
      entityType: 'User',
      entityId: created.id,
      metadata: { email, roles, status: created.status, by: actor.email },
    });
    return { ...this.toView(created), ...(generated ? { temporaryPassword: generated } : {}) };
  }

  async update(actor: AuthUser, id: string, dto: UpdateUserDto) {
    const target = await this.loadTarget(id);
    this.assertCanManage(actor, target, id);

    // Guard against locking everyone out: don't deactivate/suspend the last super-admin
    // or your own account.
    if (dto.status && dto.status !== UserStatus.ACTIVE) {
      if (id === actor.id) throw new BadRequestException('You cannot suspend or deactivate your own account.');
      await this.assertNotLastSuperAdmin(target, dto.status);
    }

    // Email changes must preserve uniqueness.
    let nextEmail: string | undefined;
    if (dto.email && dto.email.trim().toLowerCase() !== target.email.toLowerCase()) {
      nextEmail = dto.email.trim().toLowerCase();
      const clash = await this.prisma.user.findUnique({ where: { email: nextEmail } });
      if (clash && clash.id !== id) throw new ConflictException('A user with that email already exists.');
    }

    const verificationChange =
      dto.emailVerified !== undefined && dto.emailVerified !== target.emailVerified
        ? { emailVerified: dto.emailVerified, emailVerifiedAt: dto.emailVerified ? new Date() : null }
        : {};

    const updated = await this.prisma.user.update({
      where: { id },
      data: {
        ...(dto.status ? { status: dto.status } : {}),
        ...(nextEmail ? { email: nextEmail } : {}),
        ...verificationChange,
        ...(dto.firstName || dto.lastName || dto.displayName
          ? {
              profile: {
                update: {
                  ...(dto.firstName ? { firstName: dto.firstName } : {}),
                  ...(dto.lastName ? { lastName: dto.lastName } : {}),
                  ...(dto.displayName ? { displayName: dto.displayName } : {}),
                },
              },
            }
          : {}),
      },
      include: { profile: true, roles: true },
    });

    await this.audit.record({
      userId: actor.id,
      action: 'ADMIN_USER_UPDATED',
      entityType: 'User',
      entityId: id,
      metadata: {
        by: actor.email,
        ...(nextEmail ? { emailChanged: true } : {}),
        ...(dto.emailVerified !== undefined ? { emailVerified: dto.emailVerified } : {}),
        ...(dto.firstName || dto.lastName || dto.displayName ? { profileChanged: true } : {}),
      },
    });

    // Distinct, audit-friendly events for each lifecycle transition.
    if (dto.status && dto.status !== target.status) {
      const action =
        dto.status === UserStatus.SUSPENDED
          ? 'ADMIN_USER_SUSPENDED'
          : dto.status === UserStatus.DEACTIVATED
            ? 'ADMIN_USER_DEACTIVATED'
            : dto.status === UserStatus.ACTIVE
              ? 'ADMIN_USER_REACTIVATED'
              : null;
      if (action) {
        await this.audit.record({
          userId: actor.id,
          action,
          entityType: 'User',
          entityId: id,
          metadata: { from: target.status, to: dto.status, by: actor.email },
        });
      }
      // Suspending/deactivating an account also kills its live sessions.
      if (dto.status !== UserStatus.ACTIVE) {
        await this.prisma.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      }
    }
    return this.toView(updated);
  }

  /**
   * Replace a user's roles. Controller restricts this to ROLE_MANAGE (super-admin).
   * Emits a distinct audit event for every role added and every role removed.
   */
  async setRoles(actor: AuthUser, id: string, dto: SetRolesDto) {
    const target = await this.loadTarget(id);
    const roles = [...new Set(dto.roles)];
    const current = target.roles.map((r) => r.role as Role);

    // Don't allow removing SUPER_ADMIN from the last remaining super-admin.
    const targetIsSuper = current.includes(Role.SUPER_ADMIN);
    if (targetIsSuper && !roles.includes(Role.SUPER_ADMIN)) {
      const supers = await this.countActiveSuperAdmins();
      if (supers <= 1) throw new BadRequestException('Cannot remove the last super administrator.');
    }

    const added = roles.filter((r) => !current.includes(r));
    const removed = current.filter((r) => !roles.includes(r));

    await this.prisma.$transaction([
      this.prisma.userRole.deleteMany({ where: { userId: id } }),
      this.prisma.userRole.createMany({ data: roles.map((role) => ({ userId: id, role, grantedBy: actor.id })) }),
    ]);

    for (const role of added) {
      await this.audit.record({
        userId: actor.id, action: 'ADMIN_USER_ROLE_ADDED', entityType: 'User', entityId: id,
        metadata: { role, by: actor.email },
      });
    }
    for (const role of removed) {
      await this.audit.record({
        userId: actor.id, action: 'ADMIN_USER_ROLE_REMOVED', entityType: 'User', entityId: id,
        metadata: { role, by: actor.email },
      });
    }
    return this.get(id);
  }

  /**
   * Admin password reset. Either (a) e-mails the user a self-service reset link
   * (sendEmail), or (b) sets a password — explicit or generated — revokes all
   * sessions, and returns the temporary password once. Never exposes the hash.
   */
  async resetPassword(actor: AuthUser, id: string, dto: ResetPasswordDto) {
    const target = await this.loadTarget(id);
    this.assertCanManage(actor, target, id);

    if (dto.sendEmail) {
      await this.auth.requestPasswordReset(target.email);
      await this.audit.record({
        userId: actor.id, action: 'ADMIN_USER_PASSWORD_RESET', entityType: 'User', entityId: id,
        metadata: { mode: 'email-link', by: actor.email },
      });
      return { reset: true, mode: 'email-link' as const };
    }

    const generated = dto.newPassword ? null : generateTempPassword();
    const passwordHash = await this.passwords.hash(dto.newPassword ?? (generated as string));
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id }, data: { passwordHash, failedLoginCount: 0, lockedUntil: null } }),
      this.prisma.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    await this.audit.record({
      userId: actor.id, action: 'ADMIN_USER_PASSWORD_RESET', entityType: 'User', entityId: id,
      metadata: { mode: 'set-password', by: actor.email },
    });
    return { reset: true, mode: 'set-password' as const, ...(generated ? { temporaryPassword: generated } : {}) };
  }

  /**
   * Soft-removes a user: marks deletedAt, deactivates the account, and revokes all
   * sessions. Records are retained (legal/audit) rather than hard-deleted.
   */
  async remove(actor: AuthUser, id: string) {
    if (id === actor.id) throw new BadRequestException('You cannot remove your own account.');
    const target = await this.loadTarget(id);
    this.assertCanManage(actor, target, id);
    await this.assertNotLastSuperAdmin(target, UserStatus.DEACTIVATED);

    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id }, data: { status: UserStatus.DEACTIVATED, deletedAt: new Date() } }),
      this.prisma.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    await this.audit.record({
      userId: actor.id,
      action: 'ADMIN_USER_REMOVED',
      entityType: 'User',
      entityId: id,
      metadata: { email: target.email, by: actor.email },
    });
    return { removed: true, id };
  }

  /** Reverses a soft-removal. */
  async restore(actor: AuthUser, id: string) {
    const target = await this.loadTarget(id);
    this.assertCanManage(actor, target, id);
    const updated = await this.prisma.user.update({
      where: { id },
      data: { deletedAt: null, status: UserStatus.ACTIVE },
      include: { profile: true, roles: true },
    });
    await this.audit.record({ userId: actor.id, action: 'ADMIN_USER_RESTORED', entityType: 'User', entityId: id, metadata: { by: actor.email } });
    return this.toView(updated);
  }

  // ---- helpers ----

  private async loadTarget(id: string) {
    const t = await this.prisma.user.findUnique({ where: { id }, include: { roles: true } });
    if (!t) throw new NotFoundException('User not found.');
    return t;
  }

  /** A super administrator may only be modified by a super administrator (ROLE_MANAGE). */
  private assertCanManage(actor: AuthUser, target: { roles: { role: string }[] }, _id: string) {
    const targetIsSuper = target.roles.some((r) => r.role === Role.SUPER_ADMIN);
    if (targetIsSuper && !actor.permissions.includes(Permission.ROLE_MANAGE)) {
      throw new ForbiddenException('Only a super administrator may modify a super administrator account.');
    }
  }

  /** Granting any staff role (incl. SUPER_ADMIN/ADMIN) is an escalation gated on ROLE_MANAGE. */
  private assertCanAssignRoles(actor: AuthUser, roles: Role[]) {
    const wantsStaff = roles.some((r) => STAFF_ROLES.includes(r));
    if (wantsStaff && !actor.permissions.includes(Permission.ROLE_MANAGE)) {
      throw new ForbiddenException('Only a super administrator may assign staff or administrator roles.');
    }
  }

  private async countActiveSuperAdmins(): Promise<number> {
    return this.prisma.userRole.count({ where: { role: Role.SUPER_ADMIN, user: { deletedAt: null } } });
  }

  private async assertNotLastSuperAdmin(target: { roles: { role: string }[] }, nextStatus: UserStatus) {
    const targetIsSuper = target.roles.some((r) => r.role === Role.SUPER_ADMIN);
    if (targetIsSuper && nextStatus !== UserStatus.ACTIVE) {
      const supers = await this.countActiveSuperAdmins();
      if (supers <= 1) throw new BadRequestException('Cannot deactivate the last super administrator.');
    }
  }

  private toView(u: {
    id: string; email: string; status: string; emailVerified: boolean; createdAt: Date; deletedAt: Date | null;
    profile: { displayName: string; firstName: string; lastName: string } | null;
    roles: { role: string }[];
  }) {
    return {
      id: u.id,
      email: u.email,
      displayName: u.profile?.displayName ?? u.email,
      firstName: u.profile?.firstName ?? null,
      lastName: u.profile?.lastName ?? null,
      status: u.status,
      emailVerified: u.emailVerified,
      roles: u.roles.map((r) => r.role),
      deletedAt: u.deletedAt,
      createdAt: u.createdAt,
    };
  }
}

/** A reasonably strong, human-transferable temporary password. */
function generateTempPassword(): string {
  // base64url of 12 random bytes (~16 chars) + a guaranteed symbol/digit class.
  return `${randomBytes(12).toString('base64url')}#7`;
}
