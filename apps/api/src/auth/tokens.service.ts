import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { Permission, Role } from '@gaap/shared';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAccessPayload } from './types';

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  sessionId: string;
  expiresIn: number;
}

@Injectable()
export class TokensService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  signAccess(payload: Omit<JwtAccessPayload, 'type'>): string {
    return this.jwt.sign(
      { ...payload, type: 'access' },
      {
        secret: this.config.get<string>('jwt.accessSecret'),
        expiresIn: this.config.get<number>('jwt.accessTtl'),
      },
    );
  }

  /** Creates a session row and returns access + opaque refresh token. */
  async issue(
    userId: string,
    email: string,
    roles: Role[],
    permissions: Permission[],
    context: { userAgent?: string; ipAddress?: string; deviceLabel?: string },
  ): Promise<IssuedTokens> {
    const sessionId = randomUUID();
    const refreshRaw = randomBytes(48).toString('base64url');
    const refreshToken = `${sessionId}.${refreshRaw}`;
    const ttl = this.config.get<number>('jwt.refreshTtl') ?? 1209600;

    await this.prisma.session.create({
      data: {
        id: sessionId,
        userId,
        refreshTokenHash: this.hash(refreshToken),
        userAgent: context.userAgent,
        ipAddress: context.ipAddress,
        deviceLabel: context.deviceLabel,
        expiresAt: new Date(Date.now() + ttl * 1000),
      },
    });

    const accessToken = this.signAccess({ sub: userId, email, roles, permissions });
    return { accessToken, refreshToken, sessionId, expiresIn: this.config.get<number>('jwt.accessTtl') ?? 900 };
  }

  /** Verifies a refresh token, rotates it, and returns the owning session/user. */
  async rotate(
    refreshToken: string | undefined | null,
  ): Promise<{ userId: string; sessionId: string; newRefreshToken: string } | null> {
    // Missing or malformed tokens (no "<sessionId>.<secret>" shape) are simply invalid.
    if (typeof refreshToken !== 'string' || !refreshToken.includes('.')) return null;
    const [sessionId, secret] = refreshToken.split('.');
    if (!sessionId || !secret) return null;
    const session = await this.prisma.session.findUnique({ where: { id: sessionId } });
    if (!session || session.revokedAt || session.expiresAt < new Date()) return null;
    if (session.refreshTokenHash !== this.hash(refreshToken)) {
      // Token reuse / mismatch — revoke the session defensively.
      await this.prisma.session.update({ where: { id: sessionId }, data: { revokedAt: new Date() } });
      return null;
    }
    const newRaw = randomBytes(48).toString('base64url');
    const newRefreshToken = `${sessionId}.${newRaw}`;
    await this.prisma.session.update({
      where: { id: sessionId },
      data: { refreshTokenHash: this.hash(newRefreshToken), lastUsedAt: new Date() },
    });
    return { userId: session.userId, sessionId, newRefreshToken };
  }

  async revoke(sessionId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  }
}
