import { ForbiddenException, Injectable } from '@nestjs/common';
import {
  AppointmentStatus,
  CaseRole,
  CaseStage,
  DeadlineStatus,
  HearingStatus,
  NoticeStatus,
} from '@prisma/client';
import { Permission, Role } from '@gaap/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/types';

const TRIBUNAL_ROLES: CaseRole[] = [CaseRole.TRIBUNAL_CHAIR, CaseRole.TRIBUNAL_MEMBER, CaseRole.TRIBUNAL_SECRETARY];
const SOON_DAYS = 14;

function soon(): Date {
  return new Date(Date.now() + SOON_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * Role dashboards: aggregate, read-only worklists assembled from real case data.
 * Each method is gated by the permission/role the spec assigns to that desk.
 */
@Injectable()
export class DashboardsService {
  constructor(private readonly prisma: PrismaService) {}

  // ---- Registrar ----------------------------------------------------------

  async registrar(user: AuthUser) {
    if (!user.permissions.includes(Permission.CASE_VIEW_QUEUE)) {
      throw new ForbiddenException('Registry dashboard requires the case queue permission.');
    }
    const now = new Date();
    const caseFields = { select: { id: true, reference: true, title: true, stage: true } };

    const [newFilings, deficiencies, serviceFailures, overdueDeadlines, dueSoon, pendingAppointments, conflictDisclosures, paymentDefaults, upcomingHearings, awardsPending] =
      await Promise.all([
        this.prisma.case.findMany({ where: { stage: { in: [CaseStage.SUBMITTED, CaseStage.ADMINISTRATIVE_REVIEW] } }, ...caseFields, take: 10 }),
        this.prisma.case.findMany({ where: { stage: { in: [CaseStage.DEFICIENCY_NOTICE_ISSUED, CaseStage.AWAITING_CLAIMANT_CORRECTION] } }, ...caseFields, take: 10 }),
        this.prisma.formalNotice.findMany({ where: { status: { in: [NoticeStatus.DELIVERY_FAILED, NoticeStatus.SUBSTITUTE_SERVICE_REQUIRED] } }, select: { id: true, subject: true, status: true, caseId: true, case: { select: { reference: true } } }, take: 10 }),
        this.prisma.deadline.count({ where: { status: { in: [DeadlineStatus.OPEN, DeadlineStatus.EXTENDED] }, dueAt: { lt: now } } }),
        this.prisma.deadline.count({ where: { status: { in: [DeadlineStatus.OPEN, DeadlineStatus.EXTENDED] }, dueAt: { gte: now, lte: soon() } } }),
        this.prisma.appointmentInvitation.count({ where: { status: { in: [AppointmentStatus.INVITED, AppointmentStatus.CONFLICT_CHECK] } } }),
        this.prisma.conflictDisclosure.count(),
        this.prisma.paymentDefault.findMany({ where: { status: 'OPEN' }, select: { id: true, amountOutstanding: true, currency: true }, take: 10 }),
        this.prisma.hearing.findMany({ where: { scheduledStart: { gte: now }, status: { in: [HearingStatus.SCHEDULED, HearingStatus.CONFIRMED] } }, select: { id: true, title: true, scheduledStart: true, case: { select: { reference: true } } }, orderBy: { scheduledStart: 'asc' }, take: 10 }),
        this.prisma.award.findMany({ where: { deliveries: { none: { deliveredAt: { not: null } } } }, select: { id: true, type: true, signatureStatus: true, case: { select: { reference: true } } }, take: 10 }),
      ]);

    return {
      newFilings,
      deficiencies,
      serviceFailures,
      deadlines: { overdue: overdueDeadlines, dueSoon },
      pendingAppointments,
      conflictDisclosures,
      paymentDefaults,
      upcomingHearings,
      awardsPendingDelivery: awardsPending,
    };
  }

  // ---- Arbitrator ---------------------------------------------------------

  async arbitrator(user: AuthUser) {
    if (!user.roles.includes(Role.ARBITRATOR)) {
      throw new ForbiddenException('Arbitrator dashboard is for arbitrators.');
    }
    const now = new Date();
    const memberships = await this.prisma.caseTeamMember.findMany({
      where: { userId: user.id, active: true, caseRole: { in: TRIBUNAL_ROLES } },
      select: { caseId: true },
    });
    const caseIds = [...new Set(memberships.map((m) => m.caseId))];

    const profile = await this.prisma.arbitratorProfile.findUnique({ where: { userId: user.id }, select: { id: true } });

    const [invitations, deadlines, hearings, draftAwards] = await Promise.all([
      profile
        ? this.prisma.appointmentInvitation.findMany({ where: { arbitratorId: profile.id, status: { in: [AppointmentStatus.INVITED, AppointmentStatus.CONFLICT_CHECK] } }, select: { id: true, proposedRole: true, status: true, case: { select: { reference: true, title: true } } } })
        : Promise.resolve([]),
      caseIds.length ? this.prisma.deadline.findMany({ where: { caseId: { in: caseIds }, status: { in: [DeadlineStatus.OPEN, DeadlineStatus.EXTENDED, DeadlineStatus.OVERDUE] } }, select: { id: true, title: true, dueAt: true, status: true, case: { select: { reference: true } } }, orderBy: { dueAt: 'asc' }, take: 15 }) : Promise.resolve([]),
      caseIds.length ? this.prisma.hearing.findMany({ where: { caseId: { in: caseIds }, scheduledStart: { gte: now } }, select: { id: true, title: true, scheduledStart: true, case: { select: { reference: true } } }, orderBy: { scheduledStart: 'asc' }, take: 10 }) : Promise.resolve([]),
      caseIds.length ? this.prisma.award.findMany({ where: { caseId: { in: caseIds }, signatureStatus: { not: 'SIGNED' } }, select: { id: true, type: true, signatureStatus: true, case: { select: { reference: true } } }, take: 10 }) : Promise.resolve([]),
    ]);

    return { invitations, deadlines, hearings, draftAwards };
  }

  // ---- Finance ------------------------------------------------------------

  async finance(user: AuthUser) {
    const canSee = user.permissions.includes(Permission.INVOICE_MANAGE) || user.permissions.includes(Permission.PAYMENT_RECORD);
    if (!canSee) throw new ForbiddenException('Finance dashboard requires invoice/payment permissions.');

    const [depositsByStatus, invoicesByStatus, outstandingAgg, substitutePayments, refunds, ledger] = await Promise.all([
      this.prisma.depositRequest.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.invoice.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.depositAllocation.findMany({ where: { status: { in: ['OUTSTANDING', 'PARTIALLY_PAID'] } }, select: { shareAmount: true, paidAmount: true, currency: true } }),
      this.prisma.depositPayment.findMany({ where: { substitute: true }, select: { id: true, amount: true, currency: true, receiptNumber: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 10 }),
      this.prisma.refund.findMany({ select: { id: true, amount: true, currency: true, status: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 10 }),
      this.prisma.financialLedgerEntry.findMany({ select: { id: true, kind: true, description: true, amount: true, currency: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 15 }),
    ]);

    const outstandingByCurrency: Record<string, number> = {};
    for (const a of outstandingAgg) {
      const remaining = Number(a.shareAmount) - Number(a.paidAmount);
      if (remaining > 0) outstandingByCurrency[a.currency] = (outstandingByCurrency[a.currency] ?? 0) + remaining;
    }

    return {
      deposits: depositsByStatus.map((d) => ({ status: d.status, count: d._count._all })),
      invoices: invoicesByStatus.map((i) => ({ status: i.status, count: i._count._all })),
      outstandingByCurrency,
      substitutePayments,
      refunds,
      ledger,
    };
  }
}
