/**
 * Additive, non-destructive loader for the showcase scenario.
 *
 * Unlike `db:reset`, this does NOT drop the database. It loads the flagship
 * showcase case (GAAP-2026-000010) onto an already-seeded dev database, reusing
 * the existing staff / arbitrators / rules, and creating the DRAFT v3 rule
 * version if it is not already present. Safe to run repeatedly: it skips if the
 * showcase case already exists.
 *
 *   npm run db:seed:showcase   (with the dev DB running + env exported)
 */
import { RuleVersionStatus } from '@prisma/client';
import { prisma, buildVersion } from './seed';
import { seedShowcase } from './seed-showcase';

async function findUser(email: string) {
  const u = await prisma.user.findFirst({ where: { email } });
  if (!u) throw new Error(`Expected seeded user ${email} — run the base seed first (db:seed).`);
  return u;
}

async function main() {
  const existing = await prisma.case.findFirst({ where: { reference: 'GAAP-2026-000010' } });
  if (existing) {
    console.log('Showcase case GAAP-2026-000010 already present — nothing to do.');
    return;
  }

  console.log('Loading showcase scenario (additive)…');

  const registrar = await findUser('registrar@arbitration.example');
  const council = await findUser('council@arbitration.example');
  const clients = [];
  for (let i = 1; i <= 5; i++) clients.push(await findUser(`client${i}@example.example`));
  const lawyers = [];
  for (let i = 1; i <= 3; i++) lawyers.push(await findUser(`lawyer${i}@firm.example`));

  const arbitrators = [];
  for (let i = 1; i <= 10; i++) {
    const user = await findUser(`arbitrator${i}@panel.example`);
    const profile = await prisma.arbitratorProfile.findUnique({ where: { userId: user.id }, select: { id: true, fullName: true } });
    if (!profile) throw new Error(`Arbitrator ${i} has no profile — run the base seed first.`);
    arbitrators.push({ user: { id: user.id }, profile });
  }

  // The active rules version, and the DRAFT v3 (create it if missing).
  const v2 = await prisma.ruleSetVersion.findFirst({ where: { status: RuleVersionStatus.ACTIVE }, orderBy: { effectiveDate: 'desc' } });
  if (!v2) throw new Error('No ACTIVE rule version found — run the base seed first.');
  let v3 = await prisma.ruleSetVersion.findFirst({ where: { version: '3.0-draft' } });
  if (!v3) {
    v3 = await buildVersion(v2.ruleSetId, '3.0-draft', RuleVersionStatus.DRAFT, {
      effectiveDate: new Date('2026-07-01T00:00:00Z'),
      changeSummary: 'Draft amendment: expedited-track timelines and revised default-appointment wording — under counsel review.',
      changeSummaryAr: 'تعديل مشروع: مهل المسار المعجّل وصياغة منقّحة للتعيين التلقائي — قيد مراجعة المحامي.', responseDays: 30,
    });
    console.log('  Created DRAFT rule version 3.0-draft for the review demo.');
  }

  const res = await seedShowcase({ prisma, registrar, council, clients, lawyers, arbitrators, v2Id: v2.id, v3Id: v3.id });
  console.log(`Showcase loaded: ${res.reference}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
