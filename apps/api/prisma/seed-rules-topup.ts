/**
 * Additive, NON-DESTRUCTIVE top-up: loads the rules engine demo data into an
 * already-seeded database without resetting it. Safe to run repeatedly.
 *
 *   ts-node --transpile-only prisma/seed-rules-topup.ts
 *
 * It only writes to the new (previously empty) rules / calendar / service tables
 * and pins the existing seeded cases to a rule-set version. Existing users,
 * cases, documents, etc. are never modified or deleted.
 */
import { NoticeType, NoticeStatus, DeliveryChannel, DeliveryOutcome, DayKind } from '@prisma/client';
import { prisma, seedRules, seedAcceptance, seedFeeSchedule, seedDepositWorkflow } from './seed';
import { computeDeadline } from '../src/deadlines/deadline-engine';

async function main() {
  console.log('Topping up rules-engine / fees demo data (idempotent)…');

  // --- Rules set + versions + calendar (create once, else reuse) ---
  let v1, v2, calendar;
  const existing = await prisma.ruleSet.findUnique({ where: { code: 'GAAP_ONLINE_ADHOC' } });
  if (!existing) {
    ({ v1, v2, calendar } = await seedRules());
  } else {
    v1 = await prisma.ruleSetVersion.findFirstOrThrow({ where: { ruleSetId: existing.id, version: '1.0' } });
    v2 = await prisma.ruleSetVersion.findFirstOrThrow({ where: { ruleSetId: existing.id, version: '2.0' } });
    calendar = await prisma.holidayCalendar.findFirstOrThrow({ where: { code: 'UNCITRAL_DEFAULT' } });
  }

  const registrar = await prisma.user.findFirst({ where: { email: 'registrar@arbitration.example' } });
  const case1 = await prisma.case.findUnique({ where: { reference: 'GAAP-2026-000001' } });
  const case2 = await prisma.case.findUnique({ where: { reference: 'GAAP-2026-000002' } });

  if (case1 && !(await prisma.caseRuleSet.findUnique({ where: { caseId: case1.id } }))) {
    await prisma.caseRuleSet.create({ data: { caseId: case1.id, ruleSetVersionId: v1.id, assignedById: registrar?.id } });

    // Electronic service with a delivery FAILURE + substitute service.
    const failed = await prisma.formalNotice.create({
      data: {
        caseId: case1.id, type: NoticeType.NOTICE_OF_ARBITRATION,
        subject: 'Notice of Arbitration — Solar EPC Contract Dispute', issuedById: registrar!.id,
        issuedAt: new Date('2026-04-15T10:00:00Z'), status: NoticeStatus.DELIVERY_FAILED,
        body: 'You are hereby served with the Notice of Arbitration. Please log in to the portal to access the document.',
        recipients: { create: { label: 'Helios Energy Holdings Ltd', email: 'bounce@invalid.example', status: NoticeStatus.DELIVERY_FAILED, portalAvailableAt: new Date('2026-04-15T10:00:00Z') } },
      },
      include: { recipients: true },
    });
    await prisma.noticeDeliveryAttempt.createMany({
      data: [
        { recipientId: failed.recipients[0].id, channel: DeliveryChannel.PORTAL, outcome: DeliveryOutcome.DELIVERED, detail: 'Document made available in the secure case portal.' },
        { recipientId: failed.recipients[0].id, channel: DeliveryChannel.EMAIL, outcome: DeliveryOutcome.BOUNCED, detail: 'Email dispatch failed: recipient address bounced.' },
      ],
    });
    await prisma.substituteServiceOrder.create({
      data: { noticeId: failed.id, method: DeliveryChannel.COURIER, orderedById: registrar!.id, instructions: 'Effect service by international courier to the registered office; file proof of delivery.' },
    });
  }

  if (case2 && !(await prisma.caseRuleSet.findUnique({ where: { caseId: case2.id } }))) {
    await prisma.caseRuleSet.create({ data: { caseId: case2.id, ruleSetVersionId: v2.id, assignedById: registrar?.id } });

    const claimant = (await prisma.caseTeamMember.findFirst({ where: { caseId: case2.id, caseRole: 'CLAIMANT' } }));
    if (claimant) {
      await seedAcceptance(case2.id, claimant.userId, v2.id, {
        seat: 'Singapore', governingLaw: 'English law', languageOfProceedings: 'en', numberOfArbitrators: 1, appointmentMethod: 'Appointing authority',
      });
    }

    const event = await prisma.caseProceduralEvent.create({
      data: { caseId: case2.id, type: 'NOTICE_SERVED', actorUserId: registrar?.id, effectiveDate: new Date('2026-05-01T09:00:00Z'), metadata: JSON.stringify({ note: 'Notice of Arbitration served electronically.' }) },
    });
    const def = await prisma.ruleDeadlineDefinition.findFirst({ where: { key: 'RESPONSE_TO_NOTICE', rule: { versionId: v2.id } } });
    if (def) {
      const computed = computeDeadline({
        triggerDate: event.effectiveDate ?? event.occurredAt, days: def.days,
        dayKind: def.dayKind === DayKind.BUSINESS ? 'BUSINESS' : 'CALENDAR',
        calendar: { timezone: calendar.timezone, weekend: calendar.weekend, holidays: [] },
      });
      await prisma.deadline.create({
        data: {
          caseId: case2.id, title: def.label, description: def.requiredAction, dueAt: computed.dueAt, timezone: calendar.timezone,
          status: 'OPEN', reminderRule: def.reminderRule, ruleId: def.ruleId, definitionKey: def.key, triggerEventId: event.id,
          triggerDate: event.effectiveDate, days: def.days, dayKind: def.dayKind, holidayCalendarId: calendar.id,
          responsibleRole: def.responsibleRole, requiredAction: def.requiredAction,
        },
      });
    }
  }

  // --- Fee schedule (create once) ---
  if (!(await prisma.feeSchedule.findUnique({ where: { code: 'GAAP_DEFAULT_FEES' } }))) {
    await seedFeeSchedule();
  }

  // --- Deposit workflow demo on case 2 (create once) ---
  if (case2 && registrar && !(await prisma.depositRequest.findFirst({ where: { caseId: case2.id } }))) {
    await seedDepositWorkflow(case2.id, registrar.id);
  }

  console.log('Top-up complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
