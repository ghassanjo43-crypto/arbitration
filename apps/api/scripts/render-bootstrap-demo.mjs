/**
 * One-time, idempotent DEMO bootstrap — runs inside the Render preDeploy step.
 *
 * Render's free tier has no Shell, so the demo accounts and the showcase case
 * are provisioned through the normal deploy instead. This script:
 *   1. resets/creates the four demo login accounts with the LIVE PASSWORD_PEPPER
 *      (so the hashes verify against the running API), marks them ACTIVE +
 *      verified, clears any lockout, and ensures the correct role is assigned;
 *   2. runs the additive showcase loader for GAAP-2026-000010.
 *
 * It is GATED: it does nothing unless `BOOTSTRAP_DEMO=true`. The demo password
 * is read from `DEMO_PASSWORD` (never hard-coded in Git). Safe to run on every
 * deploy — account resets are idempotent and the showcase loader self-skips when
 * the case already exists. Turn the flag off (or remove it) once it has run.
 *
 *   BOOTSTRAP_DEMO=true DEMO_PASSWORD=... PASSWORD_PEPPER=... DATABASE_URL=... \
 *     npm run db:bootstrap:demo -w @gaap/api
 *
 * Password verification uses argon2 with a server-side pepper, so the hash MUST
 * be produced with the SAME PASSWORD_PEPPER the running API uses — Render injects
 * it into this process automatically (same service env).
 */
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

// ---- Gate: do nothing unless explicitly enabled --------------------------
if (process.env.BOOTSTRAP_DEMO !== 'true') {
  console.log('[bootstrap-demo] BOOTSTRAP_DEMO is not "true" — skipping (no changes).');
  process.exit(0);
}

const password = process.env.DEMO_PASSWORD;
if (!password) {
  console.error('[bootstrap-demo] DEMO_PASSWORD is required when BOOTSTRAP_DEMO=true (no password is hard-coded).');
  process.exit(1);
}
if (!process.env.PASSWORD_PEPPER) {
  console.error('[bootstrap-demo] PASSWORD_PEPPER is not set — it MUST match the API runtime value or login will fail.');
  process.exit(1);
}

// The demo accounts the live showcase needs. Names/role are only applied when an
// account has to be created — for an existing account the role is added if
// missing and the rest of the profile is left untouched.
const ACCOUNTS = [
  { email: 'superadmin@arbitration.example', role: 'SUPER_ADMIN',    firstName: 'Sam',   lastName: 'Super',   displayName: 'Sam Super' },
  { email: 'registrar@arbitration.example',  role: 'REGISTRAR',      firstName: 'Rana',  lastName: 'Registrar', displayName: 'Rana Registrar' },
  { email: 'council@arbitration.example',    role: 'COUNCIL_MEMBER', firstName: 'Carmen', lastName: 'Counsel', displayName: 'Carmen Counsel' },
  { email: 'arbitrator6@panel.example',      role: 'ARBITRATOR',     firstName: 'Elena', lastName: 'Petrova', displayName: 'Elena Petrova' },
];

const prisma = new PrismaClient();
const pepper = Buffer.from(process.env.PASSWORD_PEPPER);

async function hash(plain) {
  return argon2.hash(plain, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1, secret: pepper });
}

async function upsertAccount({ email, role, firstName, lastName, displayName }) {
  const passwordHash = await hash(password);
  const existing = await prisma.user.findFirst({ where: { email }, include: { roles: true } });

  if (existing) {
    await prisma.user.update({
      where: { id: existing.id },
      data: {
        passwordHash,
        status: 'ACTIVE',
        emailVerified: true,
        emailVerifiedAt: new Date(),
        failedLoginCount: 0,
        lockedUntil: null,
      },
    });
    const hasRole = existing.roles.some((r) => r.role === role);
    if (!hasRole) {
      await prisma.userRole.create({ data: { userId: existing.id, role } });
    }
    console.log(`  ✓ reset ${email} — role ${role} ${hasRole ? 'present' : 'ADDED'}, active+verified, lockout cleared`);
  } else {
    await prisma.user.create({
      data: {
        email,
        passwordHash,
        status: 'ACTIVE',
        emailVerified: true,
        emailVerifiedAt: new Date(),
        profile: { create: { firstName, lastName, displayName } },
        roles: { create: [{ role }] },
      },
    });
    console.log(`  + created ${email} — role ${role}, active+verified`);
  }
}

async function main() {
  console.log('[bootstrap-demo] enabled — provisioning demo accounts with the live pepper…');
  for (const account of ACCOUNTS) {
    await upsertAccount(account);
  }
  await prisma.$disconnect();

  // Additive showcase loader (GAAP-2026-000010). It self-skips if the case
  // already exists and reuses the base-seeded staff/arbitrators/rules. Run it
  // from the api workspace dir regardless of how this script was invoked.
  const apiDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  console.log('[bootstrap-demo] running the additive showcase loader (GAAP-2026-000010)…');
  execSync('npm run db:seed:showcase', { cwd: apiDir, stdio: 'inherit' });

  console.log('[bootstrap-demo] done. Set BOOTSTRAP_DEMO=false (or remove it) and redeploy.');
}

main().catch(async (e) => {
  console.error('[bootstrap-demo] FAILED:', e);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
