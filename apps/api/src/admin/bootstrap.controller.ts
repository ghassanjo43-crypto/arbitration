import { Controller, ForbiddenException, Get, NotFoundException, Query } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle } from '@nestjs/throttler';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { Role, UserStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PasswordService } from '../auth/password.service';

/**
 * One-shot, idempotent DEMO bootstrap exposed as a guarded HTTP endpoint.
 *
 * Render's free tier runs neither Shell nor `preDeployCommand`, so this gives a
 * way to (re)provision the demo entirely from a browser, with a JSON result you
 * can SEE (no logs needed). It is OFF by default: the route 404s unless a
 * `BOOTSTRAP_TOKEN` env var is configured, and the request must present a
 * matching `?token=`. The password comes from `DEMO_PASSWORD` (never hard-coded).
 *
 * Crucially it hashes through the app's own PasswordService, so the stored hash
 * is guaranteed to verify against the running API's pepper — which is the usual
 * reason demo logins fail (accounts seeded earlier with a different/placeholder
 * PASSWORD_PEPPER, then skipped by the self-skipping base seed). This force-
 * resets them.
 *
 *   GET /api/admin/bootstrap-demo?token=<BOOTSTRAP_TOKEN>
 *   GET /api/admin/bootstrap-demo?token=<BOOTSTRAP_TOKEN>&showcase=true
 *
 * Remove BOOTSTRAP_TOKEN (or rotate it) after use to disable the endpoint.
 */
const ACCOUNTS = [
  { email: 'superadmin@arbitration.example', role: Role.SUPER_ADMIN,    firstName: 'Sam',    lastName: 'Super',     displayName: 'Sam Super' },
  { email: 'registrar@arbitration.example',  role: Role.REGISTRAR,      firstName: 'Rana',   lastName: 'Registrar', displayName: 'Rana Registrar' },
  { email: 'council@arbitration.example',    role: Role.COUNCIL_MEMBER, firstName: 'Carmen', lastName: 'Counsel',   displayName: 'Carmen Counsel' },
  { email: 'arbitrator6@panel.example',      role: Role.ARBITRATOR,     firstName: 'Elena',  lastName: 'Petrova',   displayName: 'Elena Petrova' },
];

@Controller('admin/bootstrap-demo')
export class BootstrapController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly config: ConfigService,
  ) {}

  @SkipThrottle()
  @Get()
  async run(@Query('token') token?: string, @Query('showcase') showcase?: string) {
    // Disabled unless an admin has set a token; hide its existence otherwise.
    const expected = process.env.BOOTSTRAP_TOKEN;
    if (!expected) throw new NotFoundException();
    if (!token || token !== expected) throw new ForbiddenException('Invalid bootstrap token.');

    const password = process.env.DEMO_PASSWORD;
    if (!password) throw new ForbiddenException('DEMO_PASSWORD is not set on this service.');

    // Hash once via the SAME service login uses → guaranteed to verify.
    const passwordHash = await this.passwords.hash(password);

    const accounts: Array<Record<string, unknown>> = [];
    for (const acc of ACCOUNTS) {
      const existing = await this.prisma.user.findFirst({
        where: { email: acc.email },
        include: { roles: true },
      });

      if (existing) {
        await this.prisma.user.update({
          where: { id: existing.id },
          data: {
            passwordHash,
            status: UserStatus.ACTIVE,
            emailVerified: true,
            emailVerifiedAt: new Date(),
            failedLoginCount: 0,
            lockedUntil: null,
            deletedAt: null,
          },
        });
        const hasRole = existing.roles.some((r) => r.role === acc.role);
        if (!hasRole) {
          await this.prisma.userRole.create({ data: { userId: existing.id, role: acc.role } });
        }
        accounts.push({ email: acc.email, action: 'reset', role: acc.role, roleAdded: !hasRole });
      } else {
        await this.prisma.user.create({
          data: {
            email: acc.email,
            passwordHash,
            status: UserStatus.ACTIVE,
            emailVerified: true,
            emailVerifiedAt: new Date(),
            profile: { create: { firstName: acc.firstName, lastName: acc.lastName, displayName: acc.displayName } },
            roles: { create: [{ role: acc.role }] },
          },
        });
        accounts.push({ email: acc.email, action: 'created', role: acc.role });
      }
    }

    // Showcase is opt-in (it shells out to the additive loader and needs the base
    // seed present). Best-effort: never let it fail the account reset above.
    let showcaseResult = 'skipped (add &showcase=true to load GAAP-2026-000010)';
    if (showcase === 'true' || showcase === '1') {
      try {
        // Compiled path: apps/api/dist/admin -> apps/api
        const apiDir = path.resolve(__dirname, '..', '..');
        const out = execSync('npm run db:seed:showcase', {
          cwd: apiDir,
          encoding: 'utf8',
          timeout: 180_000,
          maxBuffer: 16 * 1024 * 1024,
        });
        showcaseResult = /already present/.test(out) ? 'already-present (GAAP-2026-000010)' : 'loaded (GAAP-2026-000010)';
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        showcaseResult = `failed: ${msg.slice(0, 400)}`;
      }
    }

    return {
      ok: true,
      message: 'Demo accounts provisioned. Log in with DEMO_PASSWORD.',
      accounts,
      showcase: showcaseResult,
      note: 'Remove or rotate BOOTSTRAP_TOKEN to disable this endpoint.',
    };
  }
}
