/**
 * Seed script — clearly fake demonstration data.
 * Default password for every seeded account: "Password!2026" (development only).
 */
import {
  PrismaClient,
  Role,
  CaseStage,
  PartySide,
  CaseRole,
  RuleVersionStatus,
  DayKind,
  NoticeType,
  NoticeStatus,
  DeliveryChannel,
  DeliveryOutcome,
} from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { computeDeadline } from '../src/deadlines/deadline-engine';
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
  // Idempotency guard: safe to run on every deploy (e.g. a Render pre-deploy hook).
  const already = await prisma.user.findFirst({ where: { email: 'superadmin@arbitration.example' } });
  if (already) {
    console.log('Seed data already present — skipping.');
    return;
  }

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

  // ---- Rules engine: rule set, versions (v1 superseded, v2 active), calendar ----
  const { v1, v2, calendar } = await seedRules();

  // ---- Sample cases ----
  const case1 = await seedCase({
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

  // ---- Rule-set pinning: case 1 on the OLDER version, case 2 on the LATEST ----
  await prisma.caseRuleSet.create({
    data: { caseId: case1.id, ruleSetVersionId: v1.id, assignedById: registrar.id },
  });
  await prisma.caseRuleSet.create({
    data: { caseId: constituted.id, ruleSetVersionId: v2.id, assignedById: registrar.id },
  });

  // ---- Rule acceptance with immutable receipt (claimant on case 2) ----
  await seedAcceptance(constituted.id, clients[1].id, v2.id, {
    seat: 'Singapore', governingLaw: 'English law', languageOfProceedings: 'en',
    numberOfArbitrators: 1, appointmentMethod: 'Appointing authority',
  });

  // ---- Procedural event + engine-generated deadline (case 2) ----
  const serviceEvent = await prisma.caseProceduralEvent.create({
    data: {
      caseId: constituted.id, type: 'NOTICE_SERVED', actorUserId: registrar.id,
      effectiveDate: new Date('2026-05-01T09:00:00Z'),
      metadata: JSON.stringify({ note: 'Notice of Arbitration served electronically.' }),
    },
  });
  const responseDef = await prisma.ruleDeadlineDefinition.findFirst({
    where: { key: 'RESPONSE_TO_NOTICE', rule: { versionId: v2.id } },
  });
  if (responseDef) {
    const computed = computeDeadline({
      triggerDate: serviceEvent.effectiveDate ?? serviceEvent.occurredAt,
      days: responseDef.days,
      dayKind: responseDef.dayKind === DayKind.BUSINESS ? 'BUSINESS' : 'CALENDAR',
      calendar: { timezone: calendar.timezone, weekend: calendar.weekend, holidays: [] },
    });
    await prisma.deadline.create({
      data: {
        caseId: constituted.id, title: responseDef.label, description: responseDef.requiredAction,
        dueAt: computed.dueAt, timezone: calendar.timezone, status: 'OPEN', reminderRule: responseDef.reminderRule,
        ruleId: responseDef.ruleId, definitionKey: responseDef.key, triggerEventId: serviceEvent.id,
        triggerDate: serviceEvent.effectiveDate, days: responseDef.days, dayKind: responseDef.dayKind,
        holidayCalendarId: calendar.id, responsibleRole: responseDef.responsibleRole, requiredAction: responseDef.requiredAction,
      },
    });
  }

  // ---- Electronic service with a delivery FAILURE + substitute service (case 1) ----
  const failedNotice = await prisma.formalNotice.create({
    data: {
      caseId: case1.id, type: NoticeType.NOTICE_OF_ARBITRATION,
      subject: 'Notice of Arbitration — Solar EPC Contract Dispute', issuedById: registrar.id,
      issuedAt: new Date('2026-04-15T10:00:00Z'), status: NoticeStatus.DELIVERY_FAILED,
      body: 'You are hereby served with the Notice of Arbitration. Please log in to the portal to access the document.',
      recipients: {
        create: {
          label: 'Helios Energy Holdings Ltd', email: 'bounce@invalid.example',
          status: NoticeStatus.DELIVERY_FAILED, portalAvailableAt: new Date('2026-04-15T10:00:00Z'),
        },
      },
    },
    include: { recipients: true },
  });
  await prisma.noticeDeliveryAttempt.createMany({
    data: [
      { recipientId: failedNotice.recipients[0].id, channel: DeliveryChannel.PORTAL, outcome: DeliveryOutcome.DELIVERED, detail: 'Document made available in the secure case portal.' },
      { recipientId: failedNotice.recipients[0].id, channel: DeliveryChannel.EMAIL, outcome: DeliveryOutcome.BOUNCED, detail: 'Email dispatch failed: recipient address bounced.' },
    ],
  });
  await prisma.substituteServiceOrder.create({
    data: {
      noticeId: failedNotice.id, method: DeliveryChannel.COURIER, orderedById: registrar.id,
      instructions: 'Effect service by international courier to the respondent’s registered office; file proof of delivery.',
    },
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

/** Record an immutable rule-acceptance receipt (mirrors RulesService logic). */
async function seedAcceptance(
  caseId: string,
  userId: string,
  ruleSetVersionId: string,
  choices: { seat: string; governingLaw: string; languageOfProceedings: string; numberOfArbitrators: number; appointmentMethod: string },
) {
  const acceptedAt = new Date('2026-04-20T12:00:00Z');
  const receiptNumber = `ACC-2026-${randomUUID().slice(0, 8).toUpperCase()}`;
  const canonical = JSON.stringify({ caseId, userId, ruleSetVersionId, ...choices, acceptedAt: acceptedAt.toISOString() });
  const receiptHash = createHash('sha256').update(canonical).digest('hex');
  return prisma.caseRuleAcceptance.create({
    data: {
      caseId, userId, ruleSetVersionId, acceptedLanguage: 'en',
      seat: choices.seat, governingLaw: choices.governingLaw, languageOfProceedings: choices.languageOfProceedings,
      numberOfArbitrators: choices.numberOfArbitrators, appointmentMethod: choices.appointmentMethod,
      consentElectronicService: true, consentOnlineHearings: true,
      feeAllocationAgreement: 'Each party bears its share of the deposit equally, subject to the tribunal’s final costs decision.',
      ipAddress: '203.0.113.10', userAgent: 'Mozilla/5.0 (seed)', authMethod: 'password',
      receiptNumber, receiptHash, acceptedAt,
    },
  });
}

// Chapter + rule content (English and Arabic). Kept compact but representative.
interface RuleSeed {
  number: string;
  title: string;
  titleAr: string;
  text: string;
  textAr: string;
  triggeringEvent?: string;
  responsibleRole?: CaseRole;
  deadline?: { key: string; label: string; labelAr: string; triggerEvent: string; days: number; dayKind: DayKind; responsibleRole?: CaseRole; requiredAction?: string };
}
interface ChapterSeed { number: number; title: string; titleAr: string; summary: string; summaryAr: string; rules: RuleSeed[] }

function chapterContent(responseDays: number): ChapterSeed[] {
  return [
    {
      number: 1, title: 'General Provisions', titleAr: 'أحكام عامة',
      summary: 'Scope, the ad hoc nature of proceedings, the administrative role of the portal, and the independence of the tribunal.',
      summaryAr: 'النطاق، والطبيعة الحرة للإجراءات، والدور الإداري للمنصة، واستقلال هيئة التحكيم.',
      rules: [
        { number: '1.1', title: 'Scope of application', titleAr: 'نطاق التطبيق',
          text: 'These rules govern online ad hoc arbitration administered through the portal where the parties have agreed to their application. Mandatory provisions of the law of the seat prevail over any conflicting provision of these rules.',
          textAr: 'تحكم هذه القواعد التحكيم الحر عبر الإنترنت الذي تتم إدارته من خلال المنصة حيثما اتفق الأطراف على تطبيقها. وتسمو الأحكام الآمرة لقانون مقر التحكيم على أي حكم مخالف في هذه القواعد.' },
        { number: '1.2', title: 'Administrative role of the portal', titleAr: 'الدور الإداري للمنصة',
          text: 'The operating company provides administration and technology only. It does not determine jurisdiction, admissibility, evidence, the merits, or costs, all of which remain within the authority of the tribunal.',
          textAr: 'تقدّم الشركة المشغّلة الإدارة والتقنية فقط، ولا تفصل في الاختصاص أو القبول أو الأدلة أو الموضوع أو التكاليف، وكلها تبقى من سلطة هيئة التحكيم.' },
        { number: '1.3', title: 'Equal treatment and fair opportunity', titleAr: 'المساواة في المعاملة والفرصة العادلة',
          text: 'The parties shall be treated with equality and each party shall be given a reasonable opportunity to present its case.',
          textAr: 'يُعامَل الأطراف على قدم المساواة وتُتاح لكل طرف فرصة معقولة لعرض قضيته.' },
      ],
    },
    {
      number: 2, title: 'Communications and Electronic Service', titleAr: 'المراسلات والإعلان الإلكتروني',
      summary: 'How notices and documents are served electronically, with evidence of delivery and access.',
      summaryAr: 'كيفية إعلان الإخطارات والمستندات إلكترونياً مع إثبات التسليم والاطلاع.',
      rules: [
        { number: '2.1', title: 'Electronic service', titleAr: 'الإعلان الإلكتروني',
          text: 'Documents are served by being made available in the secure portal, with a notice-to-collect dispatched by email. Email dispatch alone is not treated as conclusive proof of receipt.',
          textAr: 'تُعلَن المستندات بإتاحتها في المنصة الآمنة مع إرسال إشعار بالاستلام عبر البريد الإلكتروني. ولا يُعد إرسال البريد الإلكتروني وحده دليلاً قاطعاً على التسلّم.' },
        { number: '2.2', title: 'Certificate of electronic service', titleAr: 'شهادة الإعلان الإلكتروني',
          text: 'On request, the registrar generates a Certificate of Electronic Service recording recipients, methods, timestamps, delivery and access status, and supporting audit events.',
          textAr: 'بناءً على الطلب، يُصدر المسجّل شهادة إعلان إلكتروني تُسجّل المرسَل إليهم وطرق الإعلان والطوابع الزمنية وحالة التسليم والاطلاع والأحداث المؤيدة في سجل التدقيق.' },
      ],
    },
    {
      number: 3, title: 'Commencement of Arbitration', titleAr: 'بدء التحكيم',
      summary: 'When the arbitration is treated as commenced.',
      summaryAr: 'متى يُعد التحكيم قد بدأ.',
      rules: [
        { number: '3.1', title: 'Date of commencement', titleAr: 'تاريخ البدء', triggeringEvent: 'CASE_REGISTERED',
          text: 'The arbitration commences when the Notice of Arbitration has been submitted in complete form, the filing fee has been paid or waived, and the portal has issued a case registration confirmation, subject to any determination by the tribunal or applicable law.',
          textAr: 'يبدأ التحكيم عند تقديم إخطار التحكيم مكتملاً ودفع رسم التسجيل أو الإعفاء منه وإصدار المنصة تأكيد تسجيل القضية، وذلك مع مراعاة أي قرار لهيئة التحكيم أو القانون الواجب التطبيق.' },
      ],
    },
    {
      number: 4, title: 'Notice of Arbitration', titleAr: 'إخطار التحكيم',
      summary: 'Required contents of the Notice of Arbitration and administrative completeness review.',
      summaryAr: 'المحتويات المطلوبة لإخطار التحكيم ومراجعة الاكتمال الإدارية.',
      rules: [
        { number: '4.1', title: 'Contents of the Notice', titleAr: 'محتويات الإخطار', responsibleRole: CaseRole.CLAIMANT,
          text: 'The Notice of Arbitration shall identify the parties and representatives, the arbitration agreement and contract, the nature of the dispute, the claims and relief sought, and proposals as to seat, language, and the number of arbitrators.',
          textAr: 'يجب أن يحدد إخطار التحكيم الأطراف وممثليهم، واتفاق التحكيم والعقد، وطبيعة النزاع، والطلبات والتعويضات المطلوبة، والمقترحات بشأن المقر واللغة وعدد المحكمين.' },
      ],
    },
    {
      number: 5, title: 'Response to the Notice', titleAr: 'الرد على الإخطار',
      summary: 'The respondent’s structured response and the time allowed for it.',
      summaryAr: 'رد المدّعى عليه المنظَّم والمهلة المتاحة له.',
      rules: [
        { number: '5.1', title: 'Time to respond', titleAr: 'مهلة الرد', triggeringEvent: 'NOTICE_SERVED', responsibleRole: CaseRole.RESPONDENT,
          text: `The respondent shall submit its Response within ${responseDays} days of service of the Notice of Arbitration, unless the tribunal or the parties agree otherwise.`,
          textAr: `يقدّم المدّعى عليه ردّه خلال ${responseDays} يوماً من إعلان إخطار التحكيم، ما لم تتفق هيئة التحكيم أو الأطراف على خلاف ذلك.`,
          deadline: { key: 'RESPONSE_TO_NOTICE', label: 'Response to Notice of Arbitration', labelAr: 'الرد على إخطار التحكيم', triggerEvent: 'NOTICE_SERVED', days: responseDays, dayKind: DayKind.CALENDAR, responsibleRole: CaseRole.RESPONDENT, requiredAction: 'File the Response to the Notice of Arbitration.' } },
      ],
    },
    {
      number: 6, title: 'Time Limits and Deadlines', titleAr: 'المهل والمواعيد',
      summary: 'How procedural time limits are calculated.',
      summaryAr: 'كيفية احتساب المهل الإجرائية.',
      rules: [
        { number: '6.1', title: 'Calculation of periods', titleAr: 'احتساب المدد',
          text: 'A period begins on the day following the triggering event. If the last day is a non-business day in the official case time zone, the period extends to the next business day. Periods may be expressed in calendar or business days.',
          textAr: 'تبدأ المدة في اليوم التالي للحدث المُحرِّك. وإذا صادف آخر يوم يوم عطلة في المنطقة الزمنية الرسمية للقضية، تُمدّ المدة إلى يوم العمل التالي. ويجوز التعبير عن المدد بأيام تقويمية أو أيام عمل.' },
      ],
    },
  ];
}

async function buildVersion(ruleSetId: string, version: string, status: RuleVersionStatus, opts: { effectiveDate: Date; supersededAt?: Date; changeSummary: string; changeSummaryAr: string; responseDays: number; publishedById?: string }) {
  const rsv = await prisma.ruleSetVersion.create({
    data: {
      ruleSetId, version, status, effectiveDate: opts.effectiveDate, supersededAt: opts.supersededAt,
      changeSummary: opts.changeSummary, changeSummaryAr: opts.changeSummaryAr,
      mandatoryLawNoticeAr: 'تسمو الأحكام الآمرة لقانون المقر على القواعد المخالفة. وتتطلب هذه القواعد مراجعة من محامٍ تحكيمي مؤهل قبل الإطلاق الإنتاجي.',
      publishedById: opts.publishedById,
    },
  });
  const chapters = chapterContent(opts.responseDays);
  for (const ch of chapters) {
    const chapter = await prisma.ruleChapter.create({
      data: { versionId: rsv.id, number: ch.number, title: ch.title, titleAr: ch.titleAr, summary: ch.summary, summaryAr: ch.summaryAr, sortOrder: ch.number },
    });
    let order = 0;
    for (const r of ch.rules) {
      const rule = await prisma.rule.create({
        data: {
          versionId: rsv.id, chapterId: chapter.id, number: r.number, title: r.title, titleAr: r.titleAr,
          text: r.text, textAr: r.textAr, sortOrder: order++, triggeringEvent: r.triggeringEvent, responsibleRole: r.responsibleRole,
          publicVisible: true, auditRequired: true,
        },
      });
      if (r.deadline) {
        await prisma.ruleDeadlineDefinition.create({
          data: {
            ruleId: rule.id, key: r.deadline.key, label: r.deadline.label, labelAr: r.deadline.labelAr,
            triggerEvent: r.deadline.triggerEvent, days: r.deadline.days, dayKind: r.deadline.dayKind,
            responsibleRole: r.deadline.responsibleRole, requiredAction: r.deadline.requiredAction,
            extensionAuthority: 'Tribunal (or the registrar before constitution)',
          },
        });
      }
    }
  }
  return rsv;
}

async function seedRules() {
  const ruleSet = await prisma.ruleSet.create({
    data: {
      code: 'GAAP_ONLINE_ADHOC',
      title: 'Global Ad Hoc Arbitration Panel Rules for Online Arbitration',
      titleAr: 'قواعد المنصة العالمية للتحكيم الحر للتحكيم عبر الإنترنت',
      description: 'Original platform rules for online ad hoc arbitration, drawing on the UNCITRAL Arbitration Rules as a reference framework. These rules require review by qualified arbitration counsel before production launch.',
      descriptionAr: 'قواعد منصّة أصلية للتحكيم الحر عبر الإنترنت، تستند إلى قواعد الأونسيترال للتحكيم كإطار مرجعي. وتتطلب هذه القواعد مراجعة من محامٍ تحكيمي مؤهل قبل الإطلاق الإنتاجي.',
    },
  });
  const v1 = await buildVersion(ruleSet.id, '1.0', RuleVersionStatus.SUPERSEDED, {
    effectiveDate: new Date('2025-01-01T00:00:00Z'), supersededAt: new Date('2026-01-01T00:00:00Z'),
    changeSummary: 'Initial published version.', changeSummaryAr: 'النسخة المنشورة الأولى.', responseDays: 28,
  });
  const v2 = await buildVersion(ruleSet.id, '2.0', RuleVersionStatus.ACTIVE, {
    effectiveDate: new Date('2026-01-01T00:00:00Z'),
    changeSummary: 'Response period harmonised to 30 days; electronic-service evidence provisions strengthened.',
    changeSummaryAr: 'توحيد مهلة الرد إلى 30 يوماً وتعزيز أحكام إثبات الإعلان الإلكتروني.', responseDays: 30,
  });

  const calendar = await prisma.holidayCalendar.create({
    data: {
      code: 'UNCITRAL_DEFAULT', name: 'Default international calendar', nameAr: 'التقويم الدولي الافتراضي',
      timezone: 'UTC', weekend: [6, 0],
      holidays: {
        create: [
          { date: new Date('2026-01-01T00:00:00Z'), name: 'New Year’s Day', nameAr: 'رأس السنة الميلادية' },
          { date: new Date('2026-05-01T00:00:00Z'), name: 'International Workers’ Day', nameAr: 'عيد العمال' },
          { date: new Date('2026-12-25T00:00:00Z'), name: 'Christmas Day', nameAr: 'عيد الميلاد' },
        ],
      },
    },
  });

  return { ruleSet, v1, v2, calendar };
}

export { prisma, seedRules, seedAcceptance };

if (require.main === module) {
  main()
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
