import { Injectable, Logger } from '@nestjs/common';
import { EmailDeliveryStatus, EmailFailureKind, NoticeStatus, DeliveryChannel } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EmailService, EmailSendError } from '../providers/email/email.service';

export interface TrackedSendInput {
  to: string;
  subject: string;
  text: string;
  html?: string;
  // Soft links to the platform record this email evidences.
  notificationId?: string;
  noticeId?: string;
  noticeRecipientId?: string;
  caseId?: string;
  noticeType?: string;
  templateKey?: string;
}

/** A normalised provider delivery event (from the webhook controller). */
export interface ProviderDeliveryEvent {
  providerMessageId: string;
  type: 'sent' | 'delivered' | 'delivery_delayed' | 'bounced' | 'complained' | 'failed' | 'opened' | 'clicked';
  providerEventId?: string;
  detail?: string;
}

const RETRY_BACKOFF_MINUTES = [2, 5, 15, 60];

function statusForEvent(type: ProviderDeliveryEvent['type']): EmailDeliveryStatus | null {
  switch (type) {
    case 'delivered': return EmailDeliveryStatus.DELIVERED;
    case 'bounced': return EmailDeliveryStatus.BOUNCED;
    case 'complained': return EmailDeliveryStatus.COMPLAINED;
    case 'opened': return EmailDeliveryStatus.OPENED;
    case 'clicked': return EmailDeliveryStatus.CLICKED;
    case 'failed': return EmailDeliveryStatus.FAILED;
    case 'sent': return EmailDeliveryStatus.SENT;
    case 'delivery_delayed': return null; // transient — keep current status
  }
}

/**
 * Central email-deliverability layer. Every outbound email (notifications AND
 * formal service notices) is recorded as an EmailDelivery with a provider
 * message id, a status trail, retry of transient failures, and a manual-service
 * fallback on permanent failure. Dispatch is NEVER treated as receipt.
 */
@Injectable()
export class EmailDeliveryService {
  private readonly logger = new Logger(EmailDeliveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Send an email and track it. Never throws — a send failure is recorded (and
   * retried/escalated) rather than breaking the originating workflow.
   */
  async sendTracked(input: TrackedSendInput) {
    const delivery = await this.prisma.emailDelivery.create({
      data: {
        provider: this.email.providerName, toEmail: input.to, subject: input.subject,
        status: EmailDeliveryStatus.QUEUED, notificationId: input.notificationId, noticeId: input.noticeId,
        noticeRecipientId: input.noticeRecipientId, caseId: input.caseId, noticeType: input.noticeType, templateKey: input.templateKey,
        events: { create: { type: 'queued' } },
      },
    });
    await this.audit.record({
      action: 'EMAIL_QUEUED', entityType: 'EmailDelivery', entityId: delivery.id, caseId: input.caseId,
      metadata: { to: input.to, noticeId: input.noticeId, noticeRecipientId: input.noticeRecipientId, noticeType: input.noticeType, templateKey: input.templateKey },
    });
    return this.attemptSend(delivery.id, input, 1);
  }

  /** One send attempt against an existing delivery record. */
  private async attemptSend(deliveryId: string, input: TrackedSendInput, attempt: number) {
    try {
      const res = await this.email.send({ to: input.to, subject: input.subject, text: input.text, html: input.html });
      const updated = await this.prisma.emailDelivery.update({
        where: { id: deliveryId },
        data: {
          status: EmailDeliveryStatus.SENT, provider: res.provider, providerMessageId: res.providerMessageId,
          attemptCount: attempt, sentAt: new Date(), lastEventAt: new Date(), errorDetail: null, failureKind: null, nextAttemptAt: null,
          events: { create: { type: 'sent', providerEventId: res.providerMessageId } },
        },
      });
      await this.audit.record({
        action: 'EMAIL_DISPATCHED', entityType: 'EmailDelivery', entityId: deliveryId, caseId: input.caseId,
        metadata: { to: input.to, providerMessageId: res.providerMessageId, noticeType: input.noticeType, templateKey: input.templateKey, attempt },
      });
      return updated;
    } catch (err) {
      const kind = err instanceof EmailSendError ? err.kind : 'TEMPORARY';
      const detail = (err as Error).message;
      const retryable = kind === 'TEMPORARY' && attempt < 4;
      const nextAttemptAt = retryable ? new Date(Date.now() + RETRY_BACKOFF_MINUTES[Math.min(attempt - 1, RETRY_BACKOFF_MINUTES.length - 1)] * 60000) : null;
      const updated = await this.prisma.emailDelivery.update({
        where: { id: deliveryId },
        data: {
          status: EmailDeliveryStatus.FAILED, failureKind: kind as EmailFailureKind, errorDetail: detail,
          attemptCount: attempt, lastEventAt: new Date(), nextAttemptAt,
          events: { create: { type: 'failed', detail: `${kind}: ${detail}` } },
        },
      });
      await this.audit.record({
        action: 'EMAIL_SEND_FAILED', entityType: 'EmailDelivery', entityId: deliveryId, caseId: input.caseId,
        metadata: { to: input.to, kind, attempt, retryable, detail },
      });
      // A permanent failure on a formal-service notice triggers manual fallback now;
      // a transient one waits for the retry sweep. Permanent failures are NEVER
      // silently retried.
      if ((kind === 'PERMANENT' || !retryable) && input.noticeRecipientId) {
        await this.raiseManualFallback(input.noticeId, input.noticeRecipientId, input.caseId, detail);
      }
      this.logger.warn(`Tracked email to ${input.to} failed (${kind}, attempt ${attempt}, retryable=${retryable}).`);
      return updated;
    }
  }

  /**
   * Apply a provider delivery webhook event to its delivery record. Idempotent
   * and safe against unknown message ids. Dispatch≠receipt is enforced: a
   * `delivered`/`opened`/`clicked` event updates the EmailDelivery only — it
   * never marks a formal notice as received. A `bounced`/`complained` event marks
   * the notice recipient failed and raises manual-service fallback.
   */
  async handleProviderEvent(evt: ProviderDeliveryEvent) {
    const delivery = await this.prisma.emailDelivery.findFirst({ where: { providerMessageId: evt.providerMessageId } });
    if (!delivery) {
      this.logger.warn(`Webhook event for unknown providerMessageId=${evt.providerMessageId} (ignored).`);
      return { matched: false };
    }
    const nextStatus = statusForEvent(evt.type);
    await this.prisma.emailDelivery.update({
      where: { id: delivery.id },
      data: {
        ...(nextStatus ? { status: nextStatus } : {}),
        lastEventAt: new Date(),
        events: { create: { type: evt.type, providerEventId: evt.providerEventId, detail: evt.detail } },
      },
    });
    await this.audit.record({
      action: 'EMAIL_PROVIDER_EVENT', entityType: 'EmailDelivery', entityId: delivery.id, caseId: delivery.caseId ?? undefined,
      metadata: { type: evt.type, providerMessageId: evt.providerMessageId, providerEventId: evt.providerEventId },
    });

    // A hard bounce / spam complaint on a formal-service notice fails service and
    // routes it to manual fallback. Delivery/opened/clicked never change receipt.
    if ((evt.type === 'bounced' || evt.type === 'complained' || evt.type === 'failed') && delivery.noticeRecipientId) {
      await this.raiseManualFallback(delivery.noticeId, delivery.noticeRecipientId, delivery.caseId, `${evt.type}: ${evt.detail ?? ''}`);
    }
    return { matched: true, deliveryId: delivery.id };
  }

  /** Mark a formal-service notice recipient failed and require manual service. */
  private async raiseManualFallback(noticeId: string | null | undefined, recipientId: string, caseId: string | null | undefined, detail: string) {
    // Resilient: a partial failure here must not break the originating flow.
    try {
      await this.prisma.noticeRecipient.update({ where: { id: recipientId }, data: { status: NoticeStatus.DELIVERY_FAILED } });
      await this.prisma.noticeFailure.create({
        data: { recipientId, channel: DeliveryChannel.EMAIL, reason: 'ELECTRONIC_DELIVERY_FAILED', detail },
      });
      if (noticeId) {
        await this.prisma.formalNotice.update({ where: { id: noticeId }, data: { status: NoticeStatus.SUBSTITUTE_SERVICE_REQUIRED } });
      }
    } catch (e) {
      this.logger.warn(`Manual-service fallback could not be fully recorded for recipient ${recipientId}: ${(e as Error).message}`);
    }
    await this.audit.record({
      action: 'MANUAL_SERVICE_FALLBACK', entityType: 'NoticeRecipient', entityId: recipientId, caseId: caseId ?? undefined,
      metadata: { noticeId, detail },
    });
  }

  /**
   * Retry transient failures whose backoff has elapsed (scheduled job). Never
   * retries PERMANENT failures. Returns how many were retried.
   */
  async retryDue(limit = 50): Promise<{ retried: number }> {
    const due = await this.prisma.emailDelivery.findMany({
      where: { status: EmailDeliveryStatus.FAILED, failureKind: EmailFailureKind.TEMPORARY, nextAttemptAt: { lte: new Date() }, attemptCount: { lt: 4 } },
      take: limit,
    });
    let retried = 0;
    for (const d of due) {
      await this.prisma.emailDeliveryEvent.create({ data: { deliveryId: d.id, type: 'retry' } });
      await this.audit.record({
        action: 'EMAIL_RETRY_ATTEMPT', entityType: 'EmailDelivery', entityId: d.id, caseId: d.caseId ?? undefined,
        metadata: { attempt: d.attemptCount + 1, to: d.toEmail, noticeId: d.noticeId, noticeRecipientId: d.noticeRecipientId },
      });
      // We do not retain the original body; re-send a short notice-to-collect.
      const text = d.noticeId
        ? 'A formal notice awaits collection in the secure case portal. Please log in to access it.'
        : 'You have a new notification in the case portal.';
      await this.attemptSend(d.id, { to: d.toEmail, subject: d.subject, text, notificationId: d.notificationId ?? undefined, noticeId: d.noticeId ?? undefined, noticeRecipientId: d.noticeRecipientId ?? undefined, caseId: d.caseId ?? undefined, noticeType: d.noticeType ?? undefined }, d.attemptCount + 1);
      retried++;
    }
    if (retried > 0) await this.audit.record({ action: 'EMAIL_RETRY_SWEEP', entityType: 'EmailDelivery', metadata: { retried } });
    return { retried };
  }

  /** Delivery evidence for a case (admin / case-workspace view). */
  async listForCase(caseId: string) {
    return this.prisma.emailDelivery.findMany({
      where: { caseId },
      orderBy: { createdAt: 'desc' },
      include: { events: { orderBy: { occurredAt: 'asc' } } },
    });
  }

  /** Verify the inbound webhook signature (delegates to the provider adapter). */
  verifyWebhook(rawBody: string, signature: string | undefined): boolean {
    return this.email.verifyWebhook(rawBody, signature);
  }
}
