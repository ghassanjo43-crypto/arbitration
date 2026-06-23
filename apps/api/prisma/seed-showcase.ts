/**
 * Showcase scenario — a single, richly populated flagship case that exercises
 * every major feature so the application can be explored end to end:
 * a constituted three-member tribunal, appointment invitations in several
 * states, conflict disclosures, a decided challenge, confidentiality-tiered
 * documents, ex-parte-guarded messages, deadlines, an online hearing with rooms,
 * an invoice + payment, an issued award, compliance screenings + a hold, and a
 * DRAFT rule version mid counsel-review.
 *
 * All data is clearly fake. Called from the main seed (fresh DB only).
 */
import {
  PrismaClient, CaseStage, PartySide, CaseRole, TribunalRole, TribunalComposition,
  TribunalMemberStatus, AppointmentStatus, AppointmentMethod, ChallengeStatus,
  ConfidentialityLevel, MessageCategory, HearingStatus, HearingRoomKind, InvoiceStatus,
  PaymentStatus, AwardType, DeadlineStatus, ScreeningSubjectType, ScreeningType,
  ScreeningStatus, ComplianceHoldStatus, RuleReviewStatus,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';

interface ArbRef { user: { id: string }; profile: { id: string; fullName: string } }
export interface ShowcaseRefs {
  prisma: PrismaClient;
  registrar: { id: string };
  council: { id: string };
  clients: { id: string }[];
  lawyers: { id: string }[];
  arbitrators: ArbRef[];
  v2Id: string;
  v3Id: string;
}

export async function seedShowcase(refs: ShowcaseRefs) {
  const { prisma, registrar, council, clients, lawyers, arbitrators, v2Id, v3Id } = refs;

  const claimantUser = clients[0];
  const claimantRep = lawyers[0];
  const respondentUser = clients[3];
  const respondentRep = lawyers[2];

  const chair = arbitrators[5];      // Elena Petrova — presiding (co-arbitrator nomination)
  const coClaimant = arbitrators[0]; // Amara Okonkwo — claimant-nominated
  const coRespondent = arbitrators[4]; // Tariq Al-Mansoori — respondent-nominated
  const declined = arbitrators[2];   // Mei Tanaka — declined
  const secretaryInvitee = arbitrators[6]; // David Chen — secretary invitation outstanding

  // ---- Flagship case at AWARD_ISSUED, both sides represented ----
  const c = await prisma.case.create({
    data: {
      reference: 'GAAP-2026-000010',
      title: 'Trans-Gulf Infrastructure Joint-Venture Dispute',
      stage: CaseStage.AWARD_ISSUED,
      category: 'CONSTRUCTION_ENGINEERING',
      seat: 'London, United Kingdom', governingLaw: 'English law', language: 'en',
      numberOfArbitrators: 3, appointmentMechanism: 'Party-nominated co-arbitrators; chair by the co-arbitrators',
      onlineConsent: true, electronicServiceConsent: true, filedById: claimantUser.id,
      registeredAt: new Date('2026-02-02T09:00:00Z'),
      parties: { create: [
        { side: PartySide.CLAIMANT, legalName: 'Meridian Infrastructure Partners Ltd', legalStatus: 'company', country: 'United Kingdom', countryOfIncorporation: 'United Kingdom', registrationNumber: 'UK-8847123', email: 'legal@meridian-infra.example', linkedUserId: claimantUser.id },
        { side: PartySide.RESPONDENT, legalName: 'Gulf Construction & Engineering LLC', legalStatus: 'company', country: 'United Arab Emirates', countryOfIncorporation: 'United Arab Emirates', registrationNumber: 'AE-552210', email: 'disputes@gulfconstruction.example', linkedUserId: respondentUser.id },
      ] },
      agreement: { create: { hasClause: true, seat: 'London, United Kingdom', governingLaw: 'English law', language: 'en', numberOfArbitrators: 3, clauseText: 'Any dispute shall be finally resolved by ad hoc arbitration administered through the portal, seat London, three arbitrators.' } },
      claims: { create: { title: 'Claim for unpaid milestone payments and prolongation costs', summaryOfFacts: 'The claimant alleges non-payment of certified milestones and seeks prolongation costs arising from delayed site access. (Sample facts.)', amountClaimed: 7_500_000, currency: 'USD', interestRequested: true } },
      reliefRequests: { create: [
        { description: 'Payment of USD 7,500,000 in certified sums', kind: 'monetary', amount: 7_500_000, currency: 'USD' },
        { description: 'Interest and costs of the arbitration', kind: 'non_monetary' },
      ] },
      statusHistory: { create: [
        { toStage: CaseStage.CASE_REGISTERED, changedBy: registrar.id, createdAt: new Date('2026-02-02T09:00:00Z') },
        { toStage: CaseStage.TRIBUNAL_CONSTITUTED, changedBy: registrar.id, createdAt: new Date('2026-03-15T09:00:00Z') },
        { toStage: CaseStage.AWARD_ISSUED, changedBy: chair.user.id, createdAt: new Date('2026-06-10T09:00:00Z') },
      ] },
      feeEstimates: { create: [
        { category: 'FILING', amount: 5000, currency: 'USD' },
        { category: 'ADMINISTRATIVE', amount: 18000, currency: 'USD' },
        { category: 'ARBITRATOR', amount: 180000, currency: 'USD' },
      ] },
      teamMembers: { create: [
        { userId: claimantUser.id, caseRole: CaseRole.CLAIMANT, side: PartySide.CLAIMANT },
        { userId: claimantRep.id, caseRole: CaseRole.CLAIMANT_REPRESENTATIVE, side: PartySide.CLAIMANT },
        { userId: respondentUser.id, caseRole: CaseRole.RESPONDENT, side: PartySide.RESPONDENT },
        { userId: respondentRep.id, caseRole: CaseRole.RESPONDENT_REPRESENTATIVE, side: PartySide.RESPONDENT },
        { userId: registrar.id, caseRole: CaseRole.CASE_REGISTRAR },
      ] },
    },
    include: { parties: true },
  });
  const claimantParty = c.parties.find((p) => p.side === PartySide.CLAIMANT)!;
  const respondentParty = c.parties.find((p) => p.side === PartySide.RESPONDENT)!;

  // Pin to the active rules + record both parties' acceptance.
  await prisma.caseRuleSet.create({ data: { caseId: c.id, ruleSetVersionId: v2Id, assignedById: registrar.id } });
  for (const [u, party] of [[claimantUser, 'Meridian Infrastructure Partners Ltd'], [respondentUser, 'Gulf Construction & Engineering LLC']] as const) {
    const acceptedAt = new Date('2026-02-10T12:00:00Z');
    await prisma.caseRuleAcceptance.create({
      data: {
        caseId: c.id, userId: u.id, ruleSetVersionId: v2Id, acceptedLanguage: 'en', partyRepresented: party,
        seat: 'London, United Kingdom', governingLaw: 'English law', languageOfProceedings: 'en', numberOfArbitrators: 3,
        appointmentMethod: 'Party-nominated co-arbitrators; chair by the co-arbitrators', consentElectronicService: true, consentOnlineHearings: true,
        receiptNumber: `ACC-2026-${randomUUID().slice(0, 8).toUpperCase()}`, receiptHash: randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, ''), acceptedAt,
      },
    });
  }

  // ---- Three-member tribunal (constituted) ----
  const tribunal = await prisma.tribunal.create({
    data: {
      caseId: c.id, composition: TribunalComposition.THREE_MEMBER, constituted: true, constitutedAt: new Date('2026-03-15T09:00:00Z'),
      members: { create: [
        { arbitratorUserId: coClaimant.user.id, role: TribunalRole.CO_ARBITRATOR, nominatedBy: PartySide.CLAIMANT, status: TribunalMemberStatus.ACTIVE, acceptedAt: new Date('2026-02-25T10:00:00Z') },
        { arbitratorUserId: coRespondent.user.id, role: TribunalRole.CO_ARBITRATOR, nominatedBy: PartySide.RESPONDENT, status: TribunalMemberStatus.ACTIVE, acceptedAt: new Date('2026-02-27T10:00:00Z') },
        { arbitratorUserId: chair.user.id, role: TribunalRole.CHAIR, status: TribunalMemberStatus.ACTIVE, acceptedAt: new Date('2026-03-10T10:00:00Z') },
      ] },
    },
  });
  // Tribunal members get deliberation-granting case-team rows.
  await prisma.caseTeamMember.createMany({ data: [
    { caseId: c.id, userId: coClaimant.user.id, caseRole: CaseRole.TRIBUNAL_MEMBER, addedBy: registrar.id },
    { caseId: c.id, userId: coRespondent.user.id, caseRole: CaseRole.TRIBUNAL_MEMBER, addedBy: registrar.id },
    { caseId: c.id, userId: chair.user.id, caseRole: CaseRole.TRIBUNAL_CHAIR, addedBy: registrar.id },
  ] });
  await prisma.deliberationNote.create({ data: { caseId: c.id, tribunalId: tribunal.id, authorUserId: chair.user.id, body: 'Majority view on quantum reached; chair to circulate the draft award. (Confidential — tribunal only.)' } });

  // ---- Appointment invitations in several states (drives the Tribunal tab) ----
  const inviteCommon = { caseId: c.id, feeAccepted: true, availabilityConfirmed: true };
  await prisma.appointmentInvitation.createMany({ data: [
    { ...inviteCommon, arbitratorId: coClaimant.profile.id, proposedRole: TribunalRole.CO_ARBITRATOR, nominatedBy: PartySide.CLAIMANT, appointmentMethod: AppointmentMethod.PARTY_NOMINATION, status: AppointmentStatus.ACCEPTED, respondedAt: new Date('2026-02-25T10:00:00Z') },
    { ...inviteCommon, arbitratorId: coRespondent.profile.id, proposedRole: TribunalRole.CO_ARBITRATOR, nominatedBy: PartySide.RESPONDENT, appointmentMethod: AppointmentMethod.PARTY_NOMINATION, status: AppointmentStatus.ACCEPTED, respondedAt: new Date('2026-02-27T10:00:00Z') },
    { ...inviteCommon, arbitratorId: chair.profile.id, proposedRole: TribunalRole.CHAIR, appointmentMethod: AppointmentMethod.CO_ARBITRATOR_NOMINATION, status: AppointmentStatus.ACCEPTED, respondedAt: new Date('2026-03-10T10:00:00Z') },
    { caseId: c.id, arbitratorId: declined.profile.id, proposedRole: TribunalRole.CO_ARBITRATOR, nominatedBy: PartySide.RESPONDENT, appointmentMethod: AppointmentMethod.PARTY_NOMINATION, status: AppointmentStatus.DECLINED, declineReason: 'Existing case commitments preclude availability within the procedural timetable.', respondedAt: new Date('2026-02-20T10:00:00Z') },
    // Outstanding secretary invitation with a live rule-driven deadline + a reminder already sent.
    { caseId: c.id, arbitratorId: secretaryInvitee.profile.id, proposedRole: TribunalRole.SECRETARY, appointmentMethod: AppointmentMethod.INSTITUTION_DEFAULT, status: AppointmentStatus.INVITED, reminderCount: 1, lastReminderAt: new Date(Date.now() - 2 * 86400000), expiresAt: new Date(Date.now() + 5 * 86400000) },
  ] });

  // ---- Conflict disclosures ----
  await prisma.conflictDisclosure.createMany({ data: [
    { caseId: c.id, arbitratorId: coClaimant.profile.id, hasConflict: false, independenceDeclared: true, impartialityDeclared: true },
    { caseId: c.id, arbitratorId: chair.profile.id, hasConflict: false, independenceDeclared: true, impartialityDeclared: true },
    { caseId: c.id, arbitratorId: coRespondent.profile.id, hasConflict: true, disclosureText: 'Sat as co-arbitrator in an unrelated matter involving the respondent\'s parent group three years ago; no ongoing relationship.', independenceDeclared: true, impartialityDeclared: true },
  ] });

  // ---- A challenge (decided: dismissed) ----
  await prisma.arbitratorChallenge.create({
    data: {
      caseId: c.id, challengedArbitratorUserId: coRespondent.user.id, raisedBy: claimantUser.id,
      grounds: 'Prior appointment involving the respondent\'s parent group, as disclosed.',
      status: ChallengeStatus.DISMISSED, decidedBy: council.id, decidedAt: new Date('2026-03-05T10:00:00Z'),
      decisionNote: 'The disclosed prior appointment, unrelated and concluded, does not give rise to justifiable doubts as to independence or impartiality. Challenge dismissed.',
    },
  });

  // ---- Documents at three confidentiality levels ----
  const docSeed = [
    { num: 'D-0001', cat: 'PLEADING', title: 'Statement of Claim', conf: ConfidentialityLevel.CASE_PARTIES, side: null, by: claimantRep.id },
    { num: 'D-0002', cat: 'EXHIBIT', title: 'Exhibit C-1 — EPC Contract', conf: ConfidentialityLevel.CASE_PARTIES, side: null, by: claimantRep.id, exhibit: 'C-1' },
    { num: 'D-0003', cat: 'CORRESPONDENCE', title: 'Claimant internal strategy memo', conf: ConfidentialityLevel.PARTY_PRIVATE, side: PartySide.CLAIMANT, by: claimantRep.id },
    { num: 'D-0004', cat: 'TRIBUNAL', title: 'Draft award outline', conf: ConfidentialityLevel.TRIBUNAL_ONLY, side: null, by: chair.user.id },
  ];
  for (const d of docSeed) {
    await prisma.document.create({
      data: {
        caseId: c.id, caseDocumentNumber: d.num, exhibitNumber: d.exhibit, category: d.cat, title: d.title,
        confidentiality: d.conf, visibleToSide: d.side ?? undefined, uploadedById: d.by, currentVersion: 1,
        versions: { create: { version: 1, storageKey: `seed/${d.num}.pdf`, fileName: `${d.title}.pdf`, mimeType: 'application/pdf', fileSize: 24000, fileHash: randomUUID().replace(/-/g, ''), virusScan: 'CLEAN', uploadedById: d.by } },
        activity: { create: { userId: d.by, action: 'UPLOAD' } },
      },
    });
  }

  // ---- Messages (incl. the ex-parte guard: an ADMIN_PRIVATE registry note) ----
  const partyMsg = await prisma.caseMessage.create({
    data: { caseId: c.id, senderId: claimantRep.id, category: MessageCategory.PARTY_SUBMISSION, subject: 'Request for a short extension', body: 'The claimant respectfully requests a 7-day extension for the reply submission.', restricted: false },
  });
  await prisma.messageRecipient.createMany({ data: [claimantUser, respondentUser, respondentRep, chair.user, coClaimant.user, coRespondent.user].map((u) => ({ messageId: partyMsg.id, userId: u.id, deliveredAt: new Date() })) });
  const regMsg = await prisma.caseMessage.create({
    data: { caseId: c.id, senderId: registrar.id, category: MessageCategory.REGISTRAR_NOTICE, subject: 'Hearing logistics', body: 'The online merits hearing will use the secure rooms provisioned in the calendar.', restricted: false },
  });
  await prisma.messageRecipient.createMany({ data: [claimantUser, claimantRep, respondentUser, respondentRep].map((u) => ({ messageId: regMsg.id, userId: u.id, deliveredAt: new Date() })) });
  // ADMIN_PRIVATE — registry-only (not delivered to parties); demonstrates the guard.
  await prisma.caseMessage.create({ data: { caseId: c.id, senderId: registrar.id, category: MessageCategory.ADMIN_PRIVATE, subject: 'Internal: fee reconciliation', body: 'Internal note — confirm arbitrator fee allocation before closing the file.', restricted: true } });

  // ---- Deadlines: one met, one open ----
  await prisma.deadline.createMany({ data: [
    { caseId: c.id, title: 'Statement of Claim', dueAt: new Date('2026-03-30T23:59:59Z'), status: DeadlineStatus.MET, completedAt: new Date('2026-03-28T16:00:00Z'), timezone: 'UTC', reminderRule: 'P7D,P2D,P1D' },
    { caseId: c.id, title: 'Statement of Costs', dueAt: new Date(Date.now() + 10 * 86400000), status: DeadlineStatus.OPEN, timezone: 'UTC', reminderRule: 'P7D,P2D,P1D' },
  ] });

  // ---- Hearings: a completed merits hearing + an upcoming costs hearing with rooms ----
  const rooms = [
    { kind: HearingRoomKind.MAIN, name: 'Main hearing room' },
    { kind: HearingRoomKind.TRIBUNAL, name: 'Tribunal private room' },
    { kind: HearingRoomKind.PARTY_WAITING, name: 'Party waiting room' },
    { kind: HearingRoomKind.WITNESS_WAITING, name: 'Witness waiting room' },
    { kind: HearingRoomKind.BREAKOUT, name: 'Breakout room' },
  ];
  const mkRooms = (label: string) => ({ create: rooms.map((r) => ({ kind: r.kind, name: r.name, joinUrl: `https://hearings.local/placeholder/${randomUUID()}?room=${encodeURIComponent(label + ' — ' + r.name)}` })) });
  await prisma.hearing.create({
    data: {
      caseId: c.id, title: 'Merits hearing', scheduledStart: new Date('2026-05-12T09:00:00Z'), scheduledEnd: new Date('2026-05-14T17:00:00Z'),
      timezone: 'Europe/London', status: HearingStatus.COMPLETED, provider: 'placeholder', agenda: 'Opening submissions, witness and expert evidence, closing submissions.', recordingPermitted: true,
      rooms: mkRooms('Merits hearing'),
      participants: { create: [
        { userId: chair.user.id, displayName: chair.profile.fullName, role: 'tribunal', attendedAt: new Date('2026-05-12T09:00:00Z') },
        { userId: claimantRep.id, displayName: 'Olivia Hart', role: 'counsel', attendedAt: new Date('2026-05-12T09:02:00Z') },
        { userId: respondentRep.id, displayName: 'Greta Voss', role: 'counsel', attendedAt: new Date('2026-05-12T09:01:00Z') },
        { displayName: 'Expert: delay analysis', role: 'witness' },
      ] },
    },
  });
  await prisma.hearing.create({
    data: {
      caseId: c.id, title: 'Costs hearing', scheduledStart: new Date(Date.now() + 14 * 86400000), timezone: 'Europe/London',
      status: HearingStatus.SCHEDULED, provider: 'placeholder', agenda: 'Submissions on costs.', rooms: mkRooms('Costs hearing'),
    },
  });

  // ---- Finance: an issued invoice + a recorded payment (FinanceTab) ----
  const invoice = await prisma.invoice.create({
    data: { caseId: c.id, number: `INV-2026-${randomUUID().slice(0, 6).toUpperCase()}`, status: InvoiceStatus.PARTIALLY_PAID, currency: 'USD', subtotal: 90000, tax: 0, total: 90000, issuedAt: new Date('2026-03-20T09:00:00Z'), dueAt: new Date('2026-04-03T09:00:00Z') },
  });
  await prisma.payment.create({
    data: { caseId: c.id, invoiceId: invoice.id, category: 'DEPOSIT', amount: 45000, currency: 'USD', status: PaymentStatus.SUCCEEDED, provider: 'manual', providerRef: `manual_${randomUUID()}`, paidByUserId: claimantUser.id, onBehalfOfPartyId: claimantParty.id, recordedBy: registrar.id },
  });
  // A substitute payment: claimant advances the respondent's share (without prejudice to costs).
  await prisma.payment.create({
    data: { caseId: c.id, invoiceId: invoice.id, category: 'DEPOSIT', amount: 45000, currency: 'USD', status: PaymentStatus.SUCCEEDED, provider: 'manual', providerRef: `manual_${randomUUID()}`, paidByUserId: claimantUser.id, onBehalfOfPartyId: respondentParty.id, recordedBy: registrar.id },
  });

  // ---- Award: signed + issued, delivered to both parties (AwardsTab + PDF) ----
  await prisma.award.create({
    data: {
      caseId: c.id, type: AwardType.FINAL, seat: 'London, United Kingdom', issueDate: new Date('2026-06-10T09:00:00Z'),
      signatureStatus: 'SIGNED', signatureMetadata: JSON.stringify({ method: 'e-signature (demo)', signedBy: 'tribunal' }), correctionStatus: 'NONE',
      deliveries: { create: [
        { recipientUserId: claimantUser.id, recipientLabel: 'Meridian Infrastructure Partners Ltd', deliveredAt: new Date('2026-06-10T09:05:00Z') },
        { recipientUserId: respondentUser.id, recipientLabel: 'Gulf Construction & Engineering LLC', deliveredAt: new Date('2026-06-10T09:05:00Z') },
      ] },
    },
  });

  // ---- Compliance: a CLEAR screening on the showcase case + a flagged hold elsewhere ----
  await prisma.screeningCheck.create({
    data: { subjectType: ScreeningSubjectType.PARTY, subjectId: claimantParty.id, subjectName: 'Meridian Infrastructure Partners Ltd', caseId: c.id, screeningType: ScreeningType.SANCTIONS, status: ScreeningStatus.CLEAR, provider: 'mock', providerRef: `mock_${randomUUID()}`, riskScore: 0, matchCount: 0, resultSummary: 'No watchlist match (mock provider).', triggerEvent: 'CASE_REGISTERED', requestedById: registrar.id, screenedAt: new Date('2026-02-02T09:05:00Z'), expiresAt: new Date('2027-02-02T09:05:00Z') },
  });
  const flagged = await prisma.screeningCheck.create({
    data: { subjectType: ScreeningSubjectType.PARTY, subjectName: 'Sanctioned Holdings (sample)', screeningType: ScreeningType.SANCTIONS, status: ScreeningStatus.POSSIBLE_MATCH, provider: 'mock', providerRef: `mock_${randomUUID()}`, riskScore: 80, matchCount: 1, resultSummary: 'Possible match on a watchlist token (mock provider).', triggerEvent: 'PARTY_ADDED', requestedById: registrar.id, screenedAt: new Date() },
  });
  await prisma.complianceHold.create({
    data: { subjectType: ScreeningSubjectType.PARTY, reason: 'Possible SANCTIONS match — manual review required', screeningCheckId: flagged.id, status: ComplianceHoldStatus.ACTIVE, createdById: registrar.id },
  });

  // ---- Rules review: seed mixed counsel-review decisions on the DRAFT v3 ----
  const draftRules = await prisma.rule.findMany({ where: { versionId: v3Id }, orderBy: { sortOrder: 'asc' } });
  for (let i = 0; i < draftRules.length; i++) {
    const r = draftRules[i];
    // Most cleared OK; one CHANGE_REQUIRED, one BLOCKER, the rest PENDING — so the
    // Activate gate is visibly blocked until counsel finishes.
    const status = i === 0 ? RuleReviewStatus.CHANGE_REQUIRED : i === 1 ? RuleReviewStatus.BLOCKER : i < 5 ? RuleReviewStatus.OK : RuleReviewStatus.PENDING;
    await prisma.ruleReviewItem.create({
      data: {
        versionId: v3Id, ruleId: r.id, status,
        jurisdiction: status === RuleReviewStatus.OK ? 'England & Wales' : undefined,
        note: status === RuleReviewStatus.CHANGE_REQUIRED ? 'Tighten the wording on commencement to match the seat\'s mandatory law.'
          : status === RuleReviewStatus.BLOCKER ? 'Electronic-service sufficiency must be confirmed for this seat before activation.'
          : status === RuleReviewStatus.OK ? 'Cleared for the seat.' : undefined,
        reviewedById: status === RuleReviewStatus.PENDING ? undefined : council.id,
        reviewedAt: status === RuleReviewStatus.PENDING ? undefined : new Date(),
      },
    });
  }

  return { caseId: c.id, reference: c.reference };
}
