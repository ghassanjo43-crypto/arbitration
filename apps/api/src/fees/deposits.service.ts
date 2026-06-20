import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DepositStatus,
  FeeScheduleStatus,
  LedgerEntryKind,
  Prisma,
  ShareStatus,
} from '@prisma/client';
import { Permission } from '@gaap/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CaseAccessService } from '../authz/case-access.service';
import { AuthUser } from '../auth/types';
import { allocate, PartyShareInput } from './allocation-engine';
import { CreateDepositRequestDto, RecordDepositPaymentDto, RefundDto } from './deposits.dto';

const dec = (n: Prisma.Decimal | number): number => Number(n);

@Injectable()
export class DepositsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: CaseAccessService,
  ) {}

  private async assertFinance(user: AuthUser, caseId: string) {
    const m = await this.access.assertCanAccessCase(user, caseId);
    const ok =
      m.isRegistrar ||
      user.permissions.includes(Permission.INVOICE_MANAGE) ||
      user.permissions.includes(Permission.PAYMENT_RECORD);
    if (!ok) throw new ForbiddenException('Only finance or the registry may manage deposits.');
    return m;
  }

  // ---- Public fee schedule -------------------------------------------------

  async getActiveFeeSchedule(code: string) {
    const schedule = await this.prisma.feeSchedule.findUnique({ where: { code } });
    if (!schedule) throw new NotFoundException('Fee schedule not found.');
    const version = await this.prisma.feeScheduleVersion.findFirst({
      where: { feeScheduleId: schedule.id, status: FeeScheduleStatus.ACTIVE },
      orderBy: { effectiveDate: 'desc' },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!version) throw new NotFoundException('No active fee schedule version.');
    return { schedule, version };
  }

  async listFeeSchedules() {
    return this.prisma.feeSchedule.findMany({
      include: { versions: { select: { id: true, version: true, status: true, currency: true, effectiveDate: true } } },
    });
  }

  // ---- Deposit requests ----------------------------------------------------

  /**
   * Create a deposit request and allocate it among the parties via the pure
   * allocation engine. Charges are posted to the case ledger.
   */
  async createRequest(user: AuthUser, caseId: string, dto: CreateDepositRequestDto) {
    await this.assertFinance(user, caseId);

    const parties = await this.prisma.caseParty.findMany({ where: { caseId } });
    if (parties.length === 0) throw new BadRequestException('The case has no parties to allocate a deposit to.');

    const claims = await this.prisma.claim.findMany({ where: { caseId } });
    // Build engine inputs: claim value per side; weights for agreement/custom.
    const shareInputs: PartyShareInput[] = parties.map((p) => {
      const side = p.side as 'CLAIMANT' | 'RESPONDENT';
      const relevant = claims.filter((c) =>
        side === 'RESPONDENT' ? c.isCounterclaim : !c.isCounterclaim,
      );
      const claimValue = relevant.reduce((acc, c) => acc + (c.amountClaimed ? dec(c.amountClaimed) : 0), 0);
      return { partyId: p.id, side, claimValue, weight: dto.weights?.[p.id] };
    });

    const shares = allocate(dto.totalAmount, dto.allocationMethod, shareInputs);
    const currency = dto.currency ?? 'USD';

    const request = await this.prisma.depositRequest.create({
      data: {
        caseId,
        title: dto.title,
        description: dto.description,
        totalAmount: dto.totalAmount,
        currency,
        allocationMethod: dto.allocationMethod,
        dueAt: dto.dueAt ? new Date(dto.dueAt) : null,
        isSupplementary: dto.isSupplementary ?? false,
        requestedById: user.id,
        allocations: {
          create: shares.map((s) => ({
            partyId: s.partyId,
            side: s.side,
            shareAmount: s.shareAmount,
            currency,
            status: ShareStatus.OUTSTANDING,
          })),
        },
      },
      include: { allocations: true },
    });

    await this.prisma.financialLedgerEntry.create({
      data: {
        caseId, kind: LedgerEntryKind.CHARGE, description: `Deposit requested: ${dto.title}`,
        amount: new Prisma.Decimal(-dto.totalAmount), currency, relatedType: 'DepositRequest', relatedId: request.id,
        recordedById: user.id,
      },
    });

    await this.audit.record({
      userId: user.id, action: 'DEPOSIT_REQUESTED', entityType: 'DepositRequest', entityId: request.id, caseId,
      metadata: { totalAmount: dto.totalAmount, allocationMethod: dto.allocationMethod },
    });
    return request;
  }

  async listForCase(user: AuthUser, caseId: string) {
    await this.access.assertCanAccessCase(user, caseId);
    const [requests, ledger] = await Promise.all([
      this.prisma.depositRequest.findMany({
        where: { caseId },
        orderBy: { createdAt: 'desc' },
        include: { allocations: { include: { payments: true, defaults: true } } },
      }),
      this.prisma.financialLedgerEntry.findMany({ where: { caseId }, orderBy: { createdAt: 'asc' } }),
    ]);
    const balance = ledger.reduce((acc, e) => acc + dec(e.amount), 0);
    return { requests, ledger, balance };
  }

  // ---- Payments ------------------------------------------------------------

  /** Record a payment against an allocation (supports substitute payment). */
  async recordPayment(user: AuthUser, allocationId: string, dto: RecordDepositPaymentDto) {
    const allocation = await this.prisma.depositAllocation.findUnique({
      where: { id: allocationId },
      include: { depositRequest: true },
    });
    if (!allocation) throw new NotFoundException('Deposit allocation not found.');
    const caseId = allocation.depositRequest.caseId;
    await this.assertFinance(user, caseId);

    const substitute = dto.substitute ?? (!!dto.paidByPartyId && dto.paidByPartyId !== allocation.partyId);
    const newPaid = dec(allocation.paidAmount) + dto.amount;
    const share = dec(allocation.shareAmount);
    const status: ShareStatus =
      newPaid >= share ? (substitute ? ShareStatus.PAID_BY_SUBSTITUTE : ShareStatus.PAID) : ShareStatus.PARTIALLY_PAID;

    const receiptNumber = `RCP-${new Date().getUTCFullYear()}-${randomUUID().slice(0, 8).toUpperCase()}`;

    await this.prisma.$transaction([
      this.prisma.depositPayment.create({
        data: {
          allocationId, amount: dto.amount, currency: allocation.currency,
          paidByUserId: user.id, paidByPartyId: dto.paidByPartyId ?? allocation.partyId, substitute,
          provider: dto.provider ?? 'manual', providerRef: dto.providerRef, receiptNumber, recordedById: user.id,
        },
      }),
      this.prisma.depositAllocation.update({
        where: { id: allocationId },
        data: {
          paidAmount: newPaid, status,
          paidBySubstitutePartyId: substitute ? dto.paidByPartyId : allocation.paidBySubstitutePartyId,
        },
      }),
      this.prisma.financialLedgerEntry.create({
        data: {
          caseId, kind: substitute ? LedgerEntryKind.SUBSTITUTE_PAYMENT : LedgerEntryKind.PAYMENT,
          description: `Payment on deposit "${allocation.depositRequest.title}"${substitute ? ' (substitute, without prejudice)' : ''}`,
          amount: dto.amount, currency: allocation.currency, partyId: allocation.partyId,
          relatedType: 'DepositAllocation', relatedId: allocationId, recordedById: user.id,
        },
      }),
    ]);

    // If a default was open on this allocation, mark it cured.
    await this.prisma.paymentDefault.updateMany({
      where: { allocationId, status: 'OPEN' },
      data: { status: substitute ? 'CURED_BY_SUBSTITUTE' : 'CURED_BY_PARTY', resolvedAt: new Date() },
    });

    await this.recomputeDepositStatus(allocation.depositRequestId);

    await this.audit.record({
      userId: user.id, action: 'DEPOSIT_PAYMENT_RECORDED', entityType: 'DepositAllocation', entityId: allocationId, caseId,
      metadata: { amount: dto.amount, substitute, receiptNumber },
    });
    return { receiptNumber, status, paidAmount: newPaid };
  }

  private async recomputeDepositStatus(depositRequestId: string) {
    const allocations = await this.prisma.depositAllocation.findMany({ where: { depositRequestId } });
    const allPaid = allocations.every((a) => dec(a.paidAmount) >= dec(a.shareAmount));
    const anyPaid = allocations.some((a) => dec(a.paidAmount) > 0);
    const anyDefault = allocations.some((a) => a.status === ShareStatus.IN_DEFAULT);
    const status: DepositStatus = allPaid
      ? DepositStatus.PAID
      : anyDefault
        ? DepositStatus.IN_DEFAULT
        : anyPaid
          ? DepositStatus.PARTIALLY_PAID
          : DepositStatus.REQUESTED;
    await this.prisma.depositRequest.update({ where: { id: depositRequestId }, data: { status } });
  }

  /**
   * Declare default on overdue, unpaid allocations of a deposit request. Records
   * a PaymentDefault and flags the share — but never terminates a claim: the
   * consequence is referred to the tribunal / appointing authority.
   */
  async declareDefaults(user: AuthUser, depositRequestId: string) {
    const request = await this.prisma.depositRequest.findUnique({
      where: { id: depositRequestId },
      include: { allocations: true },
    });
    if (!request) throw new NotFoundException('Deposit request not found.');
    await this.assertFinance(user, request.caseId);
    if (!request.dueAt || request.dueAt.getTime() > Date.now()) {
      throw new BadRequestException('The deposit due date has not passed; default cannot be declared yet.');
    }

    const declared: string[] = [];
    for (const a of request.allocations) {
      const out = dec(a.shareAmount) - dec(a.paidAmount);
      if (out > 0 && a.status !== ShareStatus.IN_DEFAULT) {
        await this.prisma.$transaction([
          this.prisma.paymentDefault.create({
            data: {
              allocationId: a.id, partyId: a.partyId, amountOutstanding: out, currency: a.currency,
              status: 'OPEN', declaredById: user.id,
              note: 'Share unpaid after the due date. Another party may pay the outstanding share without prejudice; consequences are for the tribunal.',
            },
          }),
          this.prisma.depositAllocation.update({ where: { id: a.id }, data: { status: ShareStatus.IN_DEFAULT } }),
        ]);
        declared.push(a.id);
      }
    }
    await this.recomputeDepositStatus(depositRequestId);
    await this.audit.record({
      userId: user.id, action: 'PAYMENT_DEFAULT_DECLARED', entityType: 'DepositRequest', entityId: depositRequestId,
      caseId: request.caseId, metadata: { defaulted: declared.length },
    });
    return { defaulted: declared.length };
  }

  async refund(user: AuthUser, paymentId: string, dto: RefundDto) {
    const payment = await this.prisma.depositPayment.findUnique({
      where: { id: paymentId },
      include: { allocation: { include: { depositRequest: true } } },
    });
    if (!payment) throw new NotFoundException('Payment not found.');
    const caseId = payment.allocation.depositRequest.caseId;
    await this.assertFinance(user, caseId);
    if (dto.amount > dec(payment.amount)) {
      throw new BadRequestException('Refund cannot exceed the original payment.');
    }
    const refund = await this.prisma.refund.create({
      data: { paymentId, amount: dto.amount, currency: payment.currency, reason: dto.reason, authorisedById: user.id },
    });
    await this.prisma.financialLedgerEntry.create({
      data: {
        caseId, kind: LedgerEntryKind.REFUND, description: `Refund: ${dto.reason}`,
        amount: new Prisma.Decimal(-dto.amount), currency: payment.currency, relatedType: 'Refund', relatedId: refund.id,
        recordedById: user.id,
      },
    });
    await this.audit.record({
      userId: user.id, action: 'REFUND_ISSUED', entityType: 'Refund', entityId: refund.id, caseId,
      metadata: { amount: dto.amount },
    });
    return refund;
  }
}
