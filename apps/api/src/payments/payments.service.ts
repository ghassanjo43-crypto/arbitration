import { Injectable, NotFoundException } from '@nestjs/common';
import { InvoiceStatus, PaymentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CaseAccessService } from '../authz/case-access.service';
import { PaymentService } from '../providers/payment/payment.service';
import { AuthUser } from '../auth/types';
import { AllocateDto, CreateInvoiceDto, RecordPaymentDto } from './dto';

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: CaseAccessService,
    private readonly provider: PaymentService,
  ) {}

  /** Full financial picture for the case (members + administering staff). */
  async caseFinance(user: AuthUser, caseId: string) {
    await this.access.assertCanAccessCase(user, caseId);
    const [estimates, invoices, payments] = await Promise.all([
      this.prisma.feeEstimate.findMany({ where: { caseId } }),
      this.prisma.invoice.findMany({ where: { caseId }, include: { allocations: true } }),
      this.prisma.payment.findMany({ where: { caseId }, orderBy: { createdAt: 'desc' } }),
    ]);
    const invoiced = invoices.reduce((s, i) => s + Number(i.total), 0);
    const paid = payments.filter((p) => p.status === PaymentStatus.SUCCEEDED).reduce((s, p) => s + Number(p.amount), 0);
    return {
      estimates,
      invoices,
      payments,
      summary: { invoiced, paid, outstanding: Math.max(invoiced - paid, 0) },
    };
  }

  async createInvoice(user: AuthUser, caseId: string, dto: CreateInvoiceDto) {
    await this.access.assertCanAccessCase(user, caseId);
    const tax = dto.tax ?? 0;
    const total = dto.subtotal + tax;
    const count = await this.prisma.invoice.count({ where: { caseId } });
    const invoice = await this.prisma.invoice.create({
      data: {
        caseId,
        number: `INV-${new Date().getFullYear()}-${String(count + 1).padStart(4, '0')}`,
        status: InvoiceStatus.ISSUED,
        currency: dto.currency,
        subtotal: dto.subtotal,
        tax,
        total,
        issuedAt: new Date(),
        dueAt: dto.dueAt ? new Date(dto.dueAt) : undefined,
      },
    });
    await this.audit.record({ userId: user.id, action: 'INVOICE_ISSUED', entityType: 'Invoice', entityId: invoice.id, caseId, metadata: { total, currency: dto.currency } });
    return invoice;
  }

  async allocate(user: AuthUser, invoiceId: string, dto: AllocateDto) {
    const invoice = await this.prisma.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) throw new NotFoundException('Invoice not found.');
    await this.access.assertCanAccessCase(user, invoice.caseId);
    await this.prisma.paymentAllocation.deleteMany({ where: { invoiceId } });
    await this.prisma.paymentAllocation.createMany({
      data: dto.allocations.map((a) => ({
        invoiceId,
        partyId: a.partyId,
        side: a.side,
        shareAmount: a.shareAmount,
        currency: invoice.currency,
      })),
    });
    await this.audit.record({ userId: user.id, action: 'INVOICE_ALLOCATED', entityType: 'Invoice', entityId: invoiceId, caseId: invoice.caseId });
    return this.prisma.paymentAllocation.findMany({ where: { invoiceId } });
  }

  async recordPayment(user: AuthUser, caseId: string, dto: RecordPaymentDto) {
    await this.access.assertCanAccessCase(user, caseId);

    // Create a provider intent (manual adapter records pending in dev), then mark recorded.
    const intent = await this.provider.createIntent(dto.amount, dto.currency);

    const payment = await this.prisma.payment.create({
      data: {
        caseId,
        invoiceId: dto.invoiceId,
        category: dto.category,
        amount: dto.amount,
        currency: dto.currency,
        status: PaymentStatus.SUCCEEDED, // registrar confirms receipt in dev/manual flow
        provider: 'manual',
        providerRef: intent.providerRef,
        paidByUserId: dto.paidByUserId ?? user.id,
        onBehalfOfPartyId: dto.onBehalfOfPartyId,
        recordedBy: user.id,
      },
    });

    // Reconcile the linked invoice status against total payments.
    if (dto.invoiceId) {
      const invoice = await this.prisma.invoice.findUnique({ where: { id: dto.invoiceId } });
      if (invoice) {
        const paid = await this.prisma.payment.aggregate({
          where: { invoiceId: dto.invoiceId, status: PaymentStatus.SUCCEEDED },
          _sum: { amount: true },
        });
        const paidTotal = Number(paid._sum.amount ?? 0);
        const status =
          paidTotal >= Number(invoice.total)
            ? InvoiceStatus.PAID
            : paidTotal > 0
              ? InvoiceStatus.PARTIALLY_PAID
              : invoice.status;
        await this.prisma.invoice.update({ where: { id: dto.invoiceId }, data: { status } });
      }
    }

    await this.audit.record({
      userId: user.id,
      action: 'PAYMENT_RECORDED',
      entityType: 'Payment',
      entityId: payment.id,
      caseId,
      metadata: { amount: dto.amount, currency: dto.currency, onBehalfOfPartyId: dto.onBehalfOfPartyId ?? null },
    });
    return payment;
  }
}
