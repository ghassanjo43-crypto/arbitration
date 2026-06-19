import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Permission, Role, UserStatus } from '@gaap/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/types';
import { SetRolesDto, UpdateUserDto } from './dto';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
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

  async update(actor: AuthUser, id: string, dto: UpdateUserDto) {
    const target = await this.loadTarget(id);
    this.assertCanManage(actor, target, id);

    // Guard against locking everyone out: don't deactivate/suspend the last super-admin
    // or your own account.
    if (dto.status && dto.status !== UserStatus.ACTIVE) {
      if (id === actor.id) throw new BadRequestException('You cannot suspend or deactivate your own account.');
      await this.assertNotLastSuperAdmin(target, dto.status);
    }

    const updated = await this.prisma.user.update({
      where: { id },
      data: {
        ...(dto.status ? { status: dto.status } : {}),
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
      metadata: { status: dto.status, by: actor.email },
    });
    return this.toView(updated);
  }

  /** Replace a user's roles. Controller restricts this to ROLE_MANAGE (super-admin). */
  async setRoles(actor: AuthUser, id: string, dto: SetRolesDto) {
    const target = await this.loadTarget(id);
    const roles = [...new Set(dto.roles)];

    // Don't allow removing SUPER_ADMIN from the last remaining super-admin.
    const targetIsSuper = target.roles.some((r) => r.role === Role.SUPER_ADMIN);
    if (targetIsSuper && !roles.includes(Role.SUPER_ADMIN)) {
      const supers = await this.countActiveSuperAdmins();
      if (supers <= 1) throw new BadRequestException('Cannot remove the last super administrator.');
    }

    await this.prisma.$transaction([
      this.prisma.userRole.deleteMany({ where: { userId: id } }),
      this.prisma.userRole.createMany({ data: roles.map((role) => ({ userId: id, role, grantedBy: actor.id })) }),
    ]);
    await this.audit.record({
      userId: actor.id,
      action: 'ADMIN_USER_ROLES_SET',
      entityType: 'User',
      entityId: id,
      metadata: { roles, by: actor.email },
    });
    return this.get(id);
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
