/**
 * Seed script — clearly fake demonstration data.
 * Default password for every seeded account: "Password!2026" (development only).
 */
import { PrismaClient, Role, CaseStage, PartySide, CaseRole } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();
const PASSWORD = 'Password!2026';
const PEPPER = Buffer.from(process.env.PASSWORD_PEPPER ?? 'dev-pepper-change-me');

async function hash(pw: string): Promise<string> {
  return argon2.hash(pw, { type: argon2.argon2id, secret: PEPPER });
}

interface SeedUserInput {
  email: string;
  first: string;
  last: string;
  roles: Role[];
  lang?: string;
}

async function createUser(input: SeedUserInput) {
  const passwordHash = await hash(PASSWORD);
  return prisma.user.create({
    data: {
      email: input.email,
      passwordHash,
      status: 'ACTIVE',
      emailVerified: true,
      emailVerifiedAt: new Date(),
      preferredLanguage: input.lang ?? 'en',
      termsAcceptedAt: new Date(),
      termsVersion: '1.0',
      privacyAcceptedAt: new Date(),
      privacyVersion: '1.0',
      profile: { create: { firstName: input.first, lastName: input.last, displayName: `${input.first} ${input.last}` } },
      roles: { create: input.roles.map((role) => ({ role })) },
    },
  });
}

const ARB_SEED = [
  { first: 'Amara', last: 'Okonkwo', nat: 'Nigerian', country: 'United Kingdom', fields: ['ENERGY', 'OIL_AND_GAS'], industries: ['ENERGY'], langs: ['English', 'French'], years: 24, chair: 30, sole: 18 },
  { first: 'Henrik', last: 'Lindqvist', nat: 'Swedish', country: 'Sweden', fields: ['CONSTRUCTION_ENGINEERING'], industries: ['CONSTRUCTION_ENGINEERING'], langs: ['English', 'Swedish'], years: 30, chair: 45, sole: 22 },
  { first: 'Mei', last: 'Tanaka', nat: 'Japanese', country: 'Singapore', fields: ['INTERNATIONAL_TRADE', 'MARITIME'], industries: ['SHIPPING'], langs: ['English', 'Japanese'], years: 19, chair: 14, sole: 26 },
  { first: 'Sofia', last: 'Marquez', nat: 'Spanish', country: 'Spain', fields: ['CORPORATE_COMMERCIAL', 'BANKING_FINANCE'], industries: ['BANKING_FINANCE'], langs: ['English', 'Spanish'], years: 22, chair: 20, sole: 30 },
  { first: 'Tariq', last: 'Al-Mansoori', nat: 'Emirati', country: 'United Arab Emirates', fields: ['CONSTRUCTION_ENGINEERING', 'REAL_ESTATE'], industries: ['REAL_ESTATE'], langs: ['English', 'Arabic'], years: 27, chair: 33, sole: 15 },
  { first: 'Elena', last: 'Petrova', nat: 'Bulgarian', country: 'Switzerland', fields: ['INVESTMENT', 'CORPORATE_COMMERCIAL'], industries: ['ENERGY'], langs: ['English', 'Russian', 'French'], years: 28, chair: 38, sole: 20 },
  { first: 'David', last: 'Chen', nat: 'Canadian', country: 'Canada', fields: ['TECHNOLOGY', 'INTELLECTUAL_PROPERTY', 'DATA_CYBERSECURITY'], industries: ['TECHNOLOGY'], langs: ['English', 'Mandarin'], years: 16, chair: 8, sole: 19 },
  { first: 'Fatima', last: 'Haddad', nat: 'Lebanese', country: 'France', fields: ['INTERNATIONAL_TRADE', 'AGENCY_DISTRIBUTION'], industries: ['INTERNATIONAL_TRADE'], langs: ['English', 'Arabic', 'French'], years: 21, chair: 17, sole: 24 },
  { first: 'James', last: 'O’Brien', nat: 'Irish', country: 'Ireland', fields: ['INSURANCE', 'BANKING_FINANCE'], industries: ['INSURANCE'], langs: ['English'], years: 33, chair: 50, sole: 28 },
  { first: 'Priya', last: 'Nair', nat: 'Indian', country: 'India', fields: ['SOFTWARE', 'ARTIFICIAL_INTELLIGENCE', 'TECHNOLOGY'], industries: ['TELECOMMUNICATIONS'], langs: ['English', 'Hindi'], years: 18, chair: 11, sole: 21 },
];

async function main() {
  console.log('Seeding…');

  // ---- Staff ----
  const superAdmin = await createUser({ email: 'superadmin@arbitration.example', first: 'Sasha', last: 'Admin', roles: [Role.SUPER_ADMIN] });
  const registrar = await createUser({ email: 'registrar@arbitration.example', first: 'Robin', last: 'Registry', roles: [Role.REGISTRAR] });
  await createUser({ email: 'council@arbitration.example', first: 'Dr. Noor', last: 'Specialist', roles: [Role.COUNCIL_MEMBER] });
  await createUser({ email: 'admin@arbitration.example', first: 'Alex', last: 'Operator', roles: [Role.ADMIN] });

  // ---- Lawyers ----
  const lawyers = [];
  for (const l of [
    { email: 'lawyer1@firm.example', first: 'Olivia', last: 'Hart', firm: 'Hart & Vance LLP', bar: 'New York' },
    { email: 'lawyer2@firm.example', first: 'Karim', last: 'Saleh', firm: 'Saleh Chambers', bar: 'DIFC Courts' },
    { email: 'lawyer3@firm.example', first: 'Greta', last: 'Voss', firm: 'Voss Disputes', bar: 'Frankfurt' },
  ]) {
    const u = await createUser({ email: l.email, first: l.first, last: l.last, roles: [Role.LAWYER] });
    await prisma.lawyerProfile.create({
      data: {
        userId: u.id, fullName: `${l.first} ${l.last}`, lawFirm: l.firm, barAssociation: l.bar,
        barNumber: `BAR-${Math.floor(Math.random() * 90000 + 10000)}`, jurisdiction: l.bar, yearsOfPractice: 12,
        languages: ['English'], practiceAreas: ['International Arbitration'], verificationStatus: 'VERIFIED',
      },
    });
    lawyers.push(u);
  }

  // ---- Clients (individuals + companies) ----
  const clients = [];
  for (let i = 1; i <= 5; i++) {
    const u = await createUser({ email: `client${i}@example.example`, first: `Client${i}`, last: 'Party', roles: [i % 2 === 0 ? Role.COMPANY_CLIENT : Role.INDIVIDUAL] });
    clients.push(u);
  }

  // ---- Arbitrators ----
  const arbitrators = [];
  for (let i = 0; i < ARB_SEED.length; i++) {
    const a = ARB_SEED[i];
    const u = await createUser({ email: `arbitrator${i + 1}@panel.example`, first: a.first, last: a.last, roles: [Role.ARBITRATOR] });
    const profile = await prisma.arbitratorProfile.create({
      data: {
        userId: u.id, fullName: `${a.first} ${a.last}`, professionalTitle: 'Independent Arbitrator',
        nationality: a.nat, countryOfResidence: a.country,
        biography: `${a.first} ${a.last} is an independent arbitrator with ${a.years} years of experience in international disputes, sitting as sole arbitrator, co-arbitrator, and chair across multiple institutional and ad hoc proceedings.`,
        qualifications: 'LL.M; FCIArb', yearsExperience: a.years, casesAsChair: a.chair, casesAsSole: a.sole, casesAsCoArbitrator: Math.floor(a.years / 2),
        familiarRules: ['UNCITRAL', 'Ad Hoc'], jurisdictions: [a.country], hourlyRate: 650 + i * 25, feeBand: i < 3 ? 'PREMIUM' : i < 7 ? 'SENIOR' : 'STANDARD',
        availability: i % 4 === 0 ? 'LIMITED' : 'AVAILABLE', verificationStatus: 'VERIFIED', approvalStatus: 'APPROVED',
        independenceDeclared: true, impartialityDeclared: true, confidentialityUndertaking: true, cybersecurityUndertaking: true,
        memberships: ['CIArb', 'ICCA'], publications: [`Trends in ${a.fields[0]} arbitration`],
        legalFields: { create: [
          ...a.fields.map((f) => ({ kind: 'LEGAL_FIELD' as const, field: f })),
          ...a.industries.map((f) => ({ kind: 'INDUSTRY' as const, field: f })),
        ] },
        languages: { create: a.langs.map((language) => ({ language, proficiency: 'fluent' })) },
      },
    });
    arbitrators.push({ user: u, profile });
  }

  // ---- Sample cases ----
  await seedCase({
    reference: 'GAAP-2026-000001', title: 'Solar EPC Contract Dispute', stage: CaseStage.AWAITING_RESPONSE,
    claimant: clients[0], claimantRep: lawyers[0], registrar, respondentName: 'Helios Energy Holdings Ltd',
    category: 'RENEWABLE_ENERGY', seat: 'London, United Kingdom',
  });

  const constituted = await seedCase({
    reference: 'GAAP-2026-000002', title: 'Cross-Border Software Licensing Claim', stage: CaseStage.STATEMENT_OF_DEFENCE,
    claimant: clients[1], claimantRep: lawyers[1], registrar, respondentName: 'Northwind Software GmbH',
    category: 'SOFTWARE', seat: 'Singapore',
  });
  // Constitute a tribunal on case 2 and add deliberation-only membership.
  const tribunal = await prisma.tribunal.create({
    data: {
      caseId: constituted.id, composition: 'SOLE', constituted: true, constitutedAt: new Date(),
      members: { create: { arbitratorUserId: arbitrators[3].user.id, role: 'SOLE', acceptedAt: new Date() } },
    },
  });
  await prisma.caseTeamMember.create({
    data: { caseId: constituted.id, userId: arbitrators[3].user.id, caseRole: CaseRole.TRIBUNAL_CHAIR },
  });
  await prisma.deliberationNote.create({
    data: { caseId: constituted.id, tribunalId: tribunal.id, authorUserId: arbitrators[3].user.id, body: 'Preliminary view on jurisdiction — to be discussed before the procedural conference. (Confidential, tribunal only.)' },
  });

  await seedCase({
    reference: 'GAAP-2026-000003', title: 'Maritime Charterparty Demurrage', stage: CaseStage.DRAFT,
    claimant: clients[2], registrar, respondentName: 'Blue Horizon Shipping S.A.',
    category: 'MARITIME', seat: 'Geneva, Switzerland',
  });

  // ---- Content ----
  await prisma.newsArticle.createMany({
    data: [
      { slug: 'uncitral-2026-update', title: 'UNCITRAL Working Group advances reforms on expedited arbitration', excerpt: 'Delegates discussed new provisions intended to streamline lower-value disputes.', body: 'Full article body (sample content).', category: 'Legislation', status: 'PUBLISHED', authorName: 'Editorial Desk', publishedAt: new Date(), tags: ['UNCITRAL', 'reform'] },
      { slug: 'ai-disputes-rise', title: 'Disputes involving AI procurement contracts on the rise', excerpt: 'Practitioners report growing demand for arbitrators fluent in technology and data issues.', body: 'Full article body (sample content).', category: 'Trends', status: 'PUBLISHED', authorName: 'Editorial Desk', publishedAt: new Date(), tags: ['AI', 'technology'] },
      { slug: 'energy-transition-arbitration', title: 'Energy transition reshapes the arbitration landscape', excerpt: 'Renewable energy projects are generating a new wave of construction and investment disputes.', body: 'Full article body (sample content).', category: 'Sector', status: 'PUBLISHED', authorName: 'Editorial Desk', publishedAt: new Date(), tags: ['energy'] },
    ],
  });

  await prisma.courtHighlight.createMany({
    data: [
      { slug: 'enforcement-ny-convention-2026', courtName: 'Court of Appeal', jurisdiction: 'England & Wales', caseName: 'Helios v. Meridian (sample)', citation: '[2026] EWCA Civ 000', legalIssue: 'Recognition under the New York Convention', summary: 'The court considered the public-policy exception to enforcement of a foreign award.', outcome: 'Enforcement upheld', appealStatus: 'Final', source: 'Sample reporter', status: 'PUBLISHED', publishedAt: new Date(), decisionDate: new Date('2026-02-10'), tags: ['enforcement', 'New York Convention'] },
      { slug: 'arbitrability-shareholder-2026', courtName: 'Supreme Court', jurisdiction: 'Singapore', caseName: 'Northwind v. Crest (sample)', citation: '[2026] SGCA 00', legalIssue: 'Arbitrability of shareholder disputes', summary: 'The court clarified the boundary between arbitrable and non-arbitrable corporate claims.', outcome: 'Stay granted in favour of arbitration', appealStatus: 'Final', source: 'Sample reporter', status: 'PUBLISHED', publishedAt: new Date(), decisionDate: new Date('2026-03-22'), tags: ['arbitrability'] },
    ],
  });

  await prisma.publication.create({
    data: { slug: 'guide-to-ad-hoc-arbitration', title: 'A Practical Guide to Online Ad Hoc Arbitration', abstract: 'An overview of administering ad hoc proceedings through a secure online portal.', authorName: 'Panel Secretariat', status: 'PUBLISHED', publishedAt: new Date(), tags: ['guide'] },
  });

  await prisma.systemSetting.upsert({
    where: { key: 'fees.currency.default' }, update: {}, create: { key: 'fees.currency.default', value: JSON.stringify('USD') },
  });

  console.log('Seed complete.');
  console.log(`  Super admin: superadmin@arbitration.example / ${PASSWORD}`);
  console.log(`  Registrar:   registrar@arbitration.example / ${PASSWORD}`);
  console.log(`  Lawyer:      lawyer1@firm.example / ${PASSWORD}`);
  console.log(`  Arbitrator:  arbitrator4@panel.example (tribunal on case 2) / ${PASSWORD}`);
  console.log(`  Super admin id ${superAdmin.id}`);
}

interface SeedCaseInput {
  reference: string;
  title: string;
  stage: CaseStage;
  claimant: { id: string };
  claimantRep?: { id: string };
  registrar: { id: string };
  respondentName: string;
  category: string;
  seat: string;
}

async function seedCase(input: SeedCaseInput) {
  const c = await prisma.case.create({
    data: {
      reference: input.reference, title: input.title, stage: input.stage, category: input.category,
      seat: input.seat, governingLaw: 'English law', language: 'en', numberOfArbitrators: 1,
      filedById: input.claimant.id,
      parties: { create: [
        { side: PartySide.CLAIMANT, legalName: 'Acme Holdings (sample)', legalStatus: 'company', country: 'United Kingdom', email: 'party@example.example' },
        { side: PartySide.RESPONDENT, legalName: input.respondentName, legalStatus: 'company', country: 'Germany' },
      ] },
      agreement: { create: { hasClause: true, seat: input.seat, governingLaw: 'English law', language: 'en', numberOfArbitrators: 1, clauseText: 'Disputes shall be finally resolved by ad hoc arbitration administered through the portal.' } },
      claims: { create: { title: input.title, summaryOfFacts: 'Summary of facts (sample).', amountClaimed: 1_250_000, currency: 'USD', interestRequested: true } },
      statusHistory: { create: { toStage: input.stage, changedBy: input.registrar.id } },
      deadlines: input.stage !== CaseStage.DRAFT ? { create: { title: 'Response to Notice of Arbitration', dueAt: new Date(Date.now() + 21 * 86400000), status: 'OPEN', reminderRule: 'P7D,P2D,P1D' } } : undefined,
      feeEstimates: { create: [
        { category: 'FILING', amount: 2500, currency: 'USD' },
        { category: 'ADMINISTRATIVE', amount: 8000, currency: 'USD' },
        { category: 'ARBITRATOR', amount: 45000, currency: 'USD' },
      ] },
      teamMembers: { create: [
        { userId: input.claimant.id, caseRole: CaseRole.CLAIMANT, side: PartySide.CLAIMANT },
        ...(input.claimantRep ? [{ userId: input.claimantRep.id, caseRole: CaseRole.CLAIMANT_REPRESENTATIVE, side: PartySide.CLAIMANT }] : []),
        { userId: input.registrar.id, caseRole: CaseRole.CASE_REGISTRAR },
      ] },
    },
  });
  return c;
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
