/**
 * Reset (or create) a login account directly in the database.
 *
 * Password verification uses argon2 with a server-side pepper, so the new hash
 * MUST be produced with the SAME PASSWORD_PEPPER the running API uses — otherwise
 * login will still report "wrong credentials".
 *
 * Usage (run with the target DB's env):
 *   DATABASE_URL="<render external url>" PASSWORD_PEPPER="<render pepper>" \
 *     node apps/api/scripts/reset-password.mjs <email> <newPassword> [role]
 *
 *   role defaults to SUPER_ADMIN when the account is created. For an existing
 *   account only the password/status are updated (roles are left untouched).
 */
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

const [, , email, newPassword, role = 'SUPER_ADMIN'] = process.argv;

if (!email || !newPassword) {
  console.error('Usage: node apps/api/scripts/reset-password.mjs <email> <newPassword> [role]');
  process.exit(1);
}
if (!process.env.PASSWORD_PEPPER) {
  console.error('PASSWORD_PEPPER is not set — it MUST match the API runtime value or login will fail.');
  process.exit(1);
}

const prisma = new PrismaClient();
const pepper = Buffer.from(process.env.PASSWORD_PEPPER);

async function main() {
  const passwordHash = await argon2.hash(newPassword, {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
    secret: pepper,
  });

  const existing = await prisma.user.findFirst({ where: { email } });
  if (existing) {
    await prisma.user.update({
      where: { id: existing.id },
      data: { passwordHash, status: 'ACTIVE', emailVerified: true, emailVerifiedAt: new Date(), failedLoginCount: 0, lockedUntil: null },
    });
    console.log(`Updated password for existing account: ${email}`);
  } else {
    await prisma.user.create({
      data: {
        email, passwordHash, status: 'ACTIVE', emailVerified: true, emailVerifiedAt: new Date(),
        profile: { create: { firstName: 'Admin', lastName: 'User', displayName: 'Admin User' } },
        roles: { create: [{ role }] },
      },
    });
    console.log(`Created new ${role} account: ${email}`);
  }
  console.log('You can now log in with the password you provided.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
