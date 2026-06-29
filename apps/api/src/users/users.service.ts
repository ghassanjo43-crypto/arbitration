import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { IDENTITY_ROLES, IDENTITY_TYPE_ROLE, IdentityType, Permission, Role, STAFF_ROLES, UserStatus, identityForRoles } from '@gaap/shared';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PasswordService } from '../auth/password.service';
import { AuthService } from '../auth/auth.service';
import { EmailDeliveryService } from '../deliverability/email-delivery.service';
import { AuthUser } from '../auth/types';
import { CreateUserDto, ResetPasswordDto, SetRolesDto, UpdateUserDto } from './dto';
import { emailChangedNew, emailChangedOld, enrollmentEmail, roleChangedEmail } from './user-emails';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly passwords: PasswordService,
    private readonly auth: AuthService,
    private readonly delivery: EmailDeliveryService,
    private readonly config: ConfigService,
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
        include: {
          profile: true, roles: true,
          caseTeamMembers: { where: { active: true }, select: { caseRole: true } },
          individual: { select: { id: true } }, lawyer: { select: { id: true } }, arbitrator: { select: { id: true } },
          // Audit logs only count as a link when they record CASE activity (caseId
          // present). Bare admin/system audit logs do not block deletion.
          _count: { select: { caseTeamMembers: true, documentsUploaded: true, documentActivity: true, messagesSent: true, auditLogs: { where: { caseId: { not: null } } }, supportTickets: true, identityChecks: true, ruleAcceptances: true, companyMembers: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: pageSize,
        skip: (page - 1) * pageSize,
      }),
      this.prisma.user.count({ where }),
    ]);
    return { data: rows.map((u) => this.toView(u)), total, page, pageSize };
  }

  async get(id: string) {
    const u = await this.prisma.user.findUnique({
      where: { id },
      include: {
        profile: true, roles: true,
        caseTeamMembers: { where: { active: true }, select: { caseRole: true } },
        individual: { select: { id: true } }, lawyer: { select: { id: true } }, arbitrator: { select: { id: true } },
        _count: { select: { caseTeamMembers: true, documentsUploaded: true, documentActivity: true, messagesSent: true, auditLogs: { where: { caseId: { not: null } } }, supportTickets: true, identityChecks: true, ruleAcceptances: true, companyMembers: true } },
      },
    });
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
    // Enrollment email (tracked). No password is ever emailed — the user sets it
    // via "Forgot password". Email failure is recorded, never breaks creation.
    await this.sendUserEmail(actor, created.id, email, enrollmentEmail({ displayName, email, roles, ...this.urls() }), 'USER_ENROLLMENT_EMAIL');
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

    let verificationChange: { emailVerified?: boolean; emailVerifiedAt?: Date | null } = {};
    if (dto.emailVerified !== undefined && dto.emailVerified !== target.emailVerified) {
      verificationChange = { emailVerified: dto.emailVerified, emailVerifiedAt: dto.emailVerified ? new Date() : null };
    } else if (nextEmail && dto.emailVerified === undefined) {
      // Email changed without an explicit verification decision → require the new
      // address to be re-verified (does not touch the password).
      verificationChange = { emailVerified: false, emailVerifiedAt: null };
    }

    // Name (profile) changes. The list and notifications render the derived
    // `displayName`, so whenever first/last name change we MUST recompute it —
    // otherwise the saved name never appears. An explicit displayName wins; the
    // merge falls back to existing profile values when only one field is sent.
    const nameProvided = dto.firstName !== undefined || dto.lastName !== undefined || dto.displayName !== undefined;
    let profileUpdate: { update: Record<string, unknown> } | undefined;
    if (nameProvided) {
      const firstName = dto.firstName ?? target.profile?.firstName ?? '';
      const lastName = dto.lastName ?? target.profile?.lastName ?? '';
      const displayName = dto.displayName?.trim() || `${firstName} ${lastName}`.trim() || target.email;
      profileUpdate = {
        update: {
          ...(dto.firstName !== undefined ? { firstName: dto.firstName } : {}),
          ...(dto.lastName !== undefined ? { lastName: dto.lastName } : {}),
          displayName,
        },
      };
    }

    const updated = await this.prisma.user.update({
      where: { id },
      data: {
        ...(dto.status ? { status: dto.status } : {}),
        ...(nextEmail ? { email: nextEmail } : {}),
        ...verificationChange,
        ...(profileUpdate ? { profile: profileUpdate } : {}),
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
        ...(nameProvided ? { profileChanged: true } : {}),
      },
    });

    // Distinct, audit-friendly profile (name) change event.
    if (nameProvided) {
      await this.audit.record({
        userId: actor.id,
        action: 'USER_PROFILE_UPDATED',
        entityType: 'User',
        entityId: id,
        metadata: {
          by: actor.email,
          fields: [
            ...(dto.firstName !== undefined ? ['firstName'] : []),
            ...(dto.lastName !== undefined ? ['lastName'] : []),
            ...(dto.displayName !== undefined ? ['displayName'] : []),
          ],
          displayName: updated.profile?.displayName,
        },
      });
    }

    // Distinct, audit-friendly login-email change event recording old → new.
    if (nextEmail) {
      await this.audit.record({
        userId: actor.id,
        action: 'USER_EMAIL_UPDATED',
        entityType: 'User',
        entityId: id,
        metadata: { from: target.email, to: nextEmail, by: actor.email },
      });
      // Notify both addresses (tracked). New: "this is now your login"; old: security alert.
      await this.sendUserEmail(actor, id, nextEmail, emailChangedNew({ newEmail: nextEmail, loginUrl: this.urls().loginUrl }), 'USER_EMAIL_CHANGE_NOTIFIED');
      await this.sendUserEmail(actor, id, target.email, emailChangedOld({ oldEmail: target.email, newEmail: nextEmail }), 'USER_EMAIL_CHANGE_NOTIFIED');
    }

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
    const view = await this.get(id);
    // Notify the user that their roles/authorities changed (tracked).
    if (added.length || removed.length) {
      await this.sendUserEmail(actor, id, view.email, roleChangedEmail({ displayName: view.displayName, added, removed, loginUrl: this.urls().loginUrl }), 'USER_ROLE_CHANGE_NOTIFIED');
    }
    return view;
  }

  /**
   * Change a user's legal IDENTITY type (Individual / Company / Law firm /
   * Arbitrator). This swaps only the identity role and PRESERVES any system
   * (internal) roles; case roles are unaffected. ROLE_MANAGE only.
   */
  async setIdentityType(actor: AuthUser, id: string, identityType: IdentityType) {
    this.assertCanManageRoles(actor);
    const newRole = (IDENTITY_TYPE_ROLE as Record<string, Role>)[identityType];
    if (!newRole) throw new BadRequestException('Invalid identity type.');

    const target = await this.loadTarget(id);
    const current = target.roles.map((r) => r.role as Role);
    const from = identityForRoles(current);
    // Keep system/internal roles; replace just the identity role(s).
    const systemRoles = current.filter((r) => !IDENTITY_ROLES.includes(r));
    const next = [...new Set([...systemRoles, newRole])];

    await this.prisma.$transaction([
      this.prisma.userRole.deleteMany({ where: { userId: id } }),
      this.prisma.userRole.createMany({ data: next.map((role) => ({ userId: id, role, grantedBy: actor.id })) }),
    ]);
    await this.audit.record({
      userId: actor.id, action: 'USER_IDENTITY_TYPE_CHANGED', entityType: 'User', entityId: id,
      metadata: { from, to: identityType, by: actor.email },
    });
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

  // ---- Deletion safety: only unlinked accounts may be permanently removed ----

  /**
   * Comprehensive dependency scan. Returns the per-category counts of platform
   * records linked to this user. A non-empty result means the account MUST NOT be
   * hard-deleted (case history, audit logs, awards, arbitrator records etc. must
   * stay linked to the original user id) — it may only be archived/deactivated.
   */
  private async computeDeleteBlockers(id: string): Promise<{ canDelete: boolean; blockers: Record<string, number>; total: number }> {
    const u = await this.prisma.user.findUnique({
      where: { id },
      include: {
        individual: { select: { id: true } }, lawyer: { select: { id: true } }, arbitrator: { select: { id: true } },
        _count: { select: { caseTeamMembers: true, documentsUploaded: true, documentActivity: true, messagesSent: true, supportTickets: true, identityChecks: true, ruleAcceptances: true, companyMembers: true } },
      },
    });
    if (!u) throw new NotFoundException('User not found.');

    const blockers: Record<string, number> = {};
    const add = (label: string, n: number) => { if (n > 0) blockers[label] = (blockers[label] ?? 0) + n; };
    const c = u._count;
    add('Case memberships', c.caseTeamMembers);
    add('Documents', c.documentsUploaded + c.documentActivity);
    add('Messages', c.messagesSent);
    add('Support tickets', c.supportTickets);
    add('Identity checks', c.identityChecks);
    add('Rule acceptances', c.ruleAcceptances);
    add('Company memberships', c.companyMembers);
    if (u.individual) add('Individual profile', 1);
    if (u.lawyer) add('Lawyer profile', 1);
    if (u.arbitrator) add('Arbitrator profile', 1);

    // Audit logs are system history and are PRESERVED on delete (FK is SetNull).
    // They only block when tied to real arbitration activity (a caseId); bare
    // admin/system audit logs (logins, user-management, etc.) do not block.
    add('Case activity (audit)', await this.prisma.auditLog.count({ where: { userId: id, caseId: { not: null } } }));

    // Indirect links.
    add('Cases filed', await this.prisma.case.count({ where: { filedById: id } }));
    if (u.arbitrator) {
      add('Arbitrator appointments', await this.prisma.appointmentInvitation.count({ where: { arbitratorId: u.arbitrator.id } }));
      add('Conflict disclosures', await this.prisma.conflictDisclosure.count({ where: { arbitratorId: u.arbitrator.id } }));
    }
    add('Legal holds', await this.prisma.legalHold.count({ where: { OR: [{ placedById: id }, { releasedById: id }] } }));

    const total = Object.values(blockers).reduce((a, b) => a + b, 0);
    return { canDelete: total === 0, blockers, total };
  }

  /** Pre-flight dependency check exposed to the UI. Audited as USER_DELETE_CHECKED. */
  async deleteCheck(actor: AuthUser, id: string) {
    const target = await this.loadTarget(id);
    this.assertCanManage(actor, target, id);
    const result = await this.computeDeleteBlockers(id);
    await this.audit.record({
      userId: actor.id, action: 'USER_DELETE_CHECKED', entityType: 'User', entityId: id,
      metadata: { canDelete: result.canDelete, total: result.total, by: actor.email },
    });
    return { id, email: target.email, ...result };
  }

  /**
   * PERMANENT delete — only for accounts with NO linked records. Super-admin only.
   * If anything is linked it is refused (the account must be archived instead), so
   * case history, audit logs, awards and arbitrator records always stay intact.
   */
  async hardDelete(actor: AuthUser, id: string) {
    this.assertCanManageRoles(actor); // super administrator only
    if (id === actor.id) throw new BadRequestException('You cannot delete your own account.');
    const target = await this.loadTarget(id);
    this.assertCanManage(actor, target, id);

    const check = await this.computeDeleteBlockers(id);
    if (!check.canDelete) {
      await this.audit.record({
        userId: actor.id, action: 'USER_DELETE_BLOCKED_LINKED_RECORDS', entityType: 'User', entityId: id,
        metadata: { blockers: check.blockers, by: actor.email },
      });
      const summary = Object.entries(check.blockers).map(([k, v]) => `${k}: ${v}`).join(', ');
      throw new ConflictException(`This user cannot be deleted because the account is linked to platform records (${summary}). You may deactivate/archive the user instead.`);
    }

    const email = target.email;
    await this.prisma.user.delete({ where: { id } }); // frees the email for reuse
    // Audit AFTER deletion, recorded under the acting admin so the trail persists.
    await this.audit.record({
      userId: actor.id, action: 'USER_DELETED_PERMANENTLY', entityType: 'User', entityId: id,
      metadata: { email, by: actor.email },
    });
    return { deleted: true, id, email };
  }

  /**
   * Archive (soft-delete) a user: marks deletedAt, deactivates, revokes sessions.
   * Records are retained and stay linked by user id — the safe option for any
   * account that has platform activity.
   */
  async archive(actor: AuthUser, id: string) {
    if (id === actor.id) throw new BadRequestException('You cannot archive your own account.');
    const target = await this.loadTarget(id);
    this.assertCanManage(actor, target, id);
    await this.assertNotLastSuperAdmin(target, UserStatus.DEACTIVATED);

    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id }, data: { status: UserStatus.DEACTIVATED, deletedAt: new Date() } }),
      this.prisma.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    await this.audit.record({
      userId: actor.id, action: 'USER_ARCHIVED', entityType: 'User', entityId: id,
      metadata: { email: target.email, by: actor.email },
    });
    return { archived: true, id };
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

  // ---- Account-notification emails -----------------------------------------

  private urls() {
    const base = (this.config.get<string>('publicWebUrl') ?? 'http://localhost:5173').replace(/\/+$/, '');
    return { loginUrl: `${base}/sign-in`, forgotUrl: `${base}/forgot-password` };
  }

  /** Send a tracked account email and audit the trigger. Never throws. */
  private async sendUserEmail(actor: AuthUser, userId: string, to: string, mail: { subject: string; text: string; templateKey: string }, action: string) {
    try {
      const delivery = await this.delivery.sendTracked({ to, subject: mail.subject, text: mail.text, templateKey: mail.templateKey });
      await this.audit.record({
        userId: actor.id, action, entityType: 'User', entityId: userId,
        metadata: { to, templateKey: mail.templateKey, deliveryId: delivery?.id, status: delivery?.status, by: actor.email },
      });
      return delivery;
    } catch {
      // sendTracked records its own failure; never break the originating action.
      return null;
    }
  }

  /** Resend the enrollment email for a user (Super Admin / admin). */
  async sendEnrollmentEmail(actor: AuthUser, id: string) {
    const view = await this.get(id);
    await this.sendUserEmail(actor, id, view.email, enrollmentEmail({ displayName: view.displayName, email: view.email, roles: view.roles as Role[], ...this.urls() }), 'USER_ENROLLMENT_EMAIL');
    return { sent: true, to: view.email };
  }

  /** Send a password-setup/reset link via the existing reset flow (no plaintext password). */
  async sendPasswordSetupEmail(actor: AuthUser, id: string) {
    const view = await this.get(id);
    await this.auth.requestPasswordReset(view.email);
    await this.audit.record({
      userId: actor.id, action: 'USER_PASSWORD_SETUP_EMAIL', entityType: 'User', entityId: id,
      metadata: { to: view.email, by: actor.email },
    });
    return { sent: true, to: view.email };
  }

  /** Email-delivery history for a user (admin visibility / status + resend). */
  async listEmailDeliveries(actor: AuthUser, id: string) {
    const view = await this.get(id);
    const rows = await this.prisma.emailDelivery.findMany({
      where: { toEmail: view.email },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return rows.map((d) => ({
      id: d.id, subject: d.subject, templateKey: d.templateKey, status: d.status,
      provider: d.provider, providerMessageId: d.providerMessageId, failureKind: d.failureKind,
      errorDetail: d.errorDetail, sentAt: d.sentAt, createdAt: d.createdAt,
    }));
  }

  /**
   * Remove a USER-ACCOUNT email delivery record from the user-management view.
   * CASE-SERVICE EVIDENCE (anything tied to a case, formal notice or recipient) is
   * NEVER deletable — it must be preserved as arbitration evidence. The deletion
   * itself is recorded on the append-only audit trail, so account-action history
   * is retained even though the notification-log row is removed.
   */
  async dismissEmailDelivery(actor: AuthUser, id: string, deliveryId: string) {
    const view = await this.get(id);
    const d = await this.prisma.emailDelivery.findUnique({ where: { id: deliveryId } });
    if (!d || d.toEmail !== view.email) throw new NotFoundException('Email delivery record not found.');

    if (d.caseId || d.noticeId || d.noticeRecipientId || d.noticeType) {
      throw new BadRequestException('This delivery record is part of case service evidence and cannot be deleted.');
    }

    await this.prisma.emailDelivery.delete({ where: { id: deliveryId } }); // events cascade
    await this.audit.record({
      userId: actor.id, action: 'EMAIL_DELIVERY_DELETED', entityType: 'EmailDelivery', entityId: deliveryId,
      metadata: { relatedUserId: id, emailType: d.templateKey, recipient: d.toEmail, by: actor.email, at: new Date().toISOString() },
    });
    return { dismissed: true, deliveryId };
  }

  // ---- helpers ----

  private async loadTarget(id: string) {
    const t = await this.prisma.user.findUnique({ where: { id }, include: { roles: true, profile: true } });
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

  /** Changing roles/identity is restricted to a super administrator (ROLE_MANAGE). */
  private assertCanManageRoles(actor: AuthUser) {
    if (!actor.permissions.includes(Permission.ROLE_MANAGE)) {
      throw new ForbiddenException('Only a super administrator may change a user’s classification.');
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
    caseTeamMembers?: { caseRole: string }[];
    individual?: { id: string } | null; lawyer?: { id: string } | null; arbitrator?: { id: string } | null;
    _count?: { caseTeamMembers: number; documentsUploaded: number; documentActivity: number; messagesSent: number; auditLogs: number; supportTickets: number; identityChecks: number; ruleAcceptances: number; companyMembers: number };
  }) {
    const roles = u.roles.map((r) => r.role);
    // Cheap "is this account linked to anything?" signal for the list (drives the
    // Delete-vs-Archive button). The authoritative, comprehensive check runs in
    // deleteCheck()/hardDelete() on the server. null = not computed (caller omitted
    // counts) → the UI treats it as "linked" and offers Archive, never hard-delete.
    const c = u._count;
    const linkedRecordCount = c
      ? c.caseTeamMembers + c.documentsUploaded + c.documentActivity + c.messagesSent + c.auditLogs +
        c.supportTickets + c.identityChecks + c.ruleAcceptances + c.companyMembers +
        (u.individual ? 1 : 0) + (u.lawyer ? 1 : 0) + (u.arbitrator ? 1 : 0)
      : null;
    return {
      id: u.id,
      email: u.email,
      displayName: u.profile?.displayName ?? u.email,
      firstName: u.profile?.firstName ?? null,
      lastName: u.profile?.lastName ?? null,
      status: u.status,
      emailVerified: u.emailVerified,
      roles,
      // Legal identity (derived from global roles) — replaces the old generic
      // "private individual" label; case roles come from case membership.
      identityType: identityForRoles(roles as Role[]),
      caseRoles: [...new Set((u.caseTeamMembers ?? []).map((m) => m.caseRole))],
      linkedRecordCount,
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
