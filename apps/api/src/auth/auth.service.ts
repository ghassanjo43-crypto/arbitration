import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'crypto';
import {
  permissionsForRoles,
  Role,
  STAFF_ROLES,
  UserStatus,
} from '@gaap/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PasswordService } from './password.service';
import { TokensService } from './tokens.service';
import { EmailService } from '../providers/email/email.service';
import { AuditService } from '../audit/audit.service';
import { LoginDto, RegisterDto } from './dto';

interface RequestContext {
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokensService,
    private readonly email: EmailService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  private hashToken(t: string): string {
    return createHash('sha256').update(t).digest('hex');
  }

  async register(dto: RegisterDto, ctx: RequestContext) {
    if (!dto.acceptTerms || !dto.acceptPrivacy) {
      throw new BadRequestException('You must accept the Terms and Privacy Policy.');
    }
    const requestedRole = dto.role ?? Role.INDIVIDUAL;
    // Staff roles are provisioned by administrators, never self-assigned.
    if (STAFF_ROLES.includes(requestedRole) || requestedRole === Role.ARBITRATOR) {
      throw new ForbiddenException('This role cannot be self-registered.');
    }

    const existing = await this.prisma.user.findUnique({ where: { email: dto.email.toLowerCase() } });
    if (existing) {
      // Avoid user enumeration: respond the same way as success at controller level.
      throw new BadRequestException('Unable to register with the provided details.');
    }

    const passwordHash = await this.passwords.hash(dto.password);
    const now = new Date();
    const user = await this.prisma.user.create({
      data: {
        email: dto.email.toLowerCase(),
        passwordHash,
        preferredLanguage: dto.preferredLanguage ?? 'en',
        status: UserStatus.PENDING_VERIFICATION,
        termsAcceptedAt: now,
        termsVersion: '1.0',
        privacyAcceptedAt: now,
        privacyVersion: '1.0',
        profile: {
          create: {
            firstName: dto.firstName,
            lastName: dto.lastName,
            displayName: `${dto.firstName} ${dto.lastName}`.trim(),
          },
        },
        roles: { create: { role: requestedRole } },
      },
    });

    await this.issueEmailVerification(user.id, user.email);
    await this.audit.record({
      userId: user.id,
      action: 'USER_REGISTERED',
      entityType: 'User',
      entityId: user.id,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      metadata: { role: requestedRole },
    });
    return { id: user.id, email: user.email };
  }

  private async issueEmailVerification(userId: string, email: string) {
    const raw = randomBytes(32).toString('base64url');
    await this.prisma.emailToken.create({
      data: {
        userId,
        kind: 'EMAIL_VERIFICATION',
        tokenHash: this.hashToken(raw),
        expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24),
      },
    });
    const url = `${this.config.get('publicWebUrl')}/verify-email?token=${raw}`;
    await this.email.send({
      to: email,
      subject: 'Verify your Arbitration Panel account',
      text: `Confirm your email by visiting: ${url}\n\nThis link expires in 24 hours.`,
    });
  }

  async verifyEmail(token: string) {
    const row = await this.prisma.emailToken.findFirst({
      where: { kind: 'EMAIL_VERIFICATION', tokenHash: this.hashToken(token), usedAt: null },
    });
    if (!row || row.expiresAt < new Date()) throw new BadRequestException('Invalid or expired verification link.');
    await this.prisma.$transaction([
      this.prisma.emailToken.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
      this.prisma.user.update({
        where: { id: row.userId },
        data: { emailVerified: true, emailVerifiedAt: new Date(), status: UserStatus.ACTIVE },
      }),
    ]);
    await this.audit.record({ userId: row.userId, action: 'EMAIL_VERIFIED', entityType: 'User', entityId: row.userId });
    return { verified: true };
  }

  /**
   * Re-issues a verification email for an account that is still pending. Any prior
   * unused verification tokens are invalidated first. Always returns a generic
   * success response so callers cannot probe which emails are registered.
   */
  async resendVerification(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (user && !user.deletedAt && !user.emailVerified && user.status === UserStatus.PENDING_VERIFICATION) {
      // Expire any outstanding (unused) verification tokens before issuing a fresh one.
      await this.prisma.emailToken.updateMany({
        where: { userId: user.id, kind: 'EMAIL_VERIFICATION', usedAt: null },
        data: { usedAt: new Date() },
      });
      await this.issueEmailVerification(user.id, user.email);
      await this.audit.record({ userId: user.id, action: 'EMAIL_VERIFICATION_RESENT', entityType: 'User', entityId: user.id });
    }
    return { success: true };
  }

  async login(dto: LoginDto, ctx: RequestContext) {
    const email = dto.email.toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { roles: true, profile: true },
    });

    const recordFailure = async (outcome: 'FAILED' | 'LOCKED' | 'MFA_REQUIRED') =>
      this.prisma.loginEvent.create({
        data: { userId: user?.id, email, outcome, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
      });

    if (!user || user.deletedAt) {
      await recordFailure('FAILED');
      throw new UnauthorizedException('Invalid credentials.');
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      await recordFailure('LOCKED');
      throw new UnauthorizedException('Account temporarily locked due to failed attempts. Try again later.');
    }

    const valid = await this.passwords.verify(user.passwordHash, dto.password);
    if (!valid) {
      const maxFailures = this.config.get<number>('security.maxFailedLogins') ?? 5;
      const lockMinutes = this.config.get<number>('security.accountLockMinutes') ?? 15;
      const count = user.failedLoginCount + 1;
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginCount: count,
          lockedUntil: count >= maxFailures ? new Date(Date.now() + lockMinutes * 60000) : null,
        },
      });
      await recordFailure('FAILED');
      throw new UnauthorizedException('Invalid credentials.');
    }

    if (user.status === UserStatus.SUSPENDED || user.status === UserStatus.DEACTIVATED) {
      throw new ForbiddenException(`Account is ${user.status.toLowerCase()}.`);
    }

    // MFA-ready: if enabled, require a valid code (verification implemented in MFA module).
    if (user.mfaEnabled && !dto.mfaCode) {
      await recordFailure('MFA_REQUIRED');
      throw new UnauthorizedException('MFA code required.');
    }

    await this.prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null } });

    const roles = user.roles.map((r) => r.role as Role);
    const permissions = permissionsForRoles(roles);
    const issued = await this.tokens.issue(user.id, user.email, roles, permissions, {
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    await this.prisma.loginEvent.create({
      data: { userId: user.id, email, outcome: 'SUCCESS', ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
    });
    await this.audit.record({ userId: user.id, action: 'LOGIN', ipAddress: ctx.ipAddress, userAgent: ctx.userAgent });

    return {
      tokens: issued,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.profile?.displayName ?? user.email,
        roles,
        permissions,
        preferredLanguage: user.preferredLanguage,
        mfaEnabled: user.mfaEnabled,
        emailVerified: user.emailVerified,
        status: user.status,
      },
    };
  }

  async refresh(refreshToken: string) {
    const rotated = await this.tokens.rotate(refreshToken);
    if (!rotated) throw new UnauthorizedException('Invalid refresh token.');
    const user = await this.prisma.user.findUnique({
      where: { id: rotated.userId },
      include: { roles: true, profile: true },
    });
    if (!user || user.status !== UserStatus.ACTIVE) throw new UnauthorizedException('Session no longer valid.');
    const roles = user.roles.map((r) => r.role as Role);
    const permissions = permissionsForRoles(roles);
    const accessToken = this.tokens.signAccess({ sub: user.id, email: user.email, roles, permissions });
    return {
      accessToken,
      refreshToken: rotated.newRefreshToken,
      expiresIn: this.config.get<number>('jwt.accessTtl') ?? 900,
    };
  }

  async logout(sessionId: string, userId: string) {
    await this.tokens.revoke(sessionId);
    await this.audit.record({ userId, action: 'LOGOUT' });
    return { success: true };
  }

  async requestPasswordReset(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    // Always respond success to avoid enumeration.
    if (user) {
      const raw = randomBytes(32).toString('base64url');
      await this.prisma.emailToken.create({
        data: {
          userId: user.id,
          kind: 'PASSWORD_RESET',
          tokenHash: this.hashToken(raw),
          expiresAt: new Date(Date.now() + 1000 * 60 * 60),
        },
      });
      const url = `${this.config.get('publicWebUrl')}/reset-password?token=${raw}`;
      await this.email.send({
        to: user.email,
        subject: 'Reset your Arbitration Panel password',
        text: `Reset your password: ${url}\n\nThis link expires in 1 hour. If you did not request this, ignore it.`,
      });
    }
    return { success: true };
  }

  async resetPassword(token: string, newPassword: string) {
    const row = await this.prisma.emailToken.findFirst({
      where: { kind: 'PASSWORD_RESET', tokenHash: this.hashToken(token), usedAt: null },
    });
    if (!row || row.expiresAt < new Date()) throw new BadRequestException('Invalid or expired reset link.');
    const passwordHash = await this.passwords.hash(newPassword);
    await this.prisma.$transaction([
      this.prisma.emailToken.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
      this.prisma.user.update({ where: { id: row.userId }, data: { passwordHash } }),
    ]);
    // Invalidate all sessions on password change.
    await this.tokens.revokeAllForUser(row.userId);
    await this.audit.record({ userId: row.userId, action: 'PASSWORD_RESET' });
    return { success: true };
  }
}
