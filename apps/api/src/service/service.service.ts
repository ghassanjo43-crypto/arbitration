import { createHash, randomUUID } from 'node:crypto';
import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DeliveryChannel,
  DeliveryOutcome,
  EmailDeliveryStatus,
  NoticeStatus,
} from '@prisma/client';
import { Permission } from '@gaap/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CaseAccessService } from '../authz/case-access.service';
import { EmailDeliveryService } from '../deliverability/email-delivery.service';
import { StorageService } from '../providers/storage/storage.service';
import { PdfService } from '../providers/pdf/pdf.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuthUser } from '../auth/types';
import {
  AcknowledgeNoticeDto,
  IssueNoticeDto,
  SubstituteServiceDto,
} from './dto';

interface RequestContext {
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Electronic service of documents (Chapter 2).
 *
 * Principle enforced here: email dispatch alone is NEVER treated as conclusive
 * proof of receipt. A notice advances to ACCESSED / ACKNOWLEDGED only on real
 * portal access or an explicit acknowledgement — not on email send.
 */
@Injectable()
export class ServiceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: CaseAccessService,
    private readonly delivery: EmailDeliveryService,
    private readonly notifications: NotificationsService,
    private readonly storage: StorageService,
    private readonly pdf: PdfService,
  ) {}

  private async assertCanServe(user: AuthUser, caseId: string) {
    const m = await this.access.assertCanAccessCase(user, caseId);
    const canServe =
      m.isRegistrar ||
      m.isTribunal ||
      user.permissions.includes(Permission.CASE_MANAGE_SERVICE);
    if (!canServe) {
      throw new ForbiddenException('Only the registry or the tribunal may effect formal service.');
    }
  }

  /**
   * Issue and serve a formal notice. The document is made available on the
   * portal (PORTAL_AVAILABLE) and an email dispatch is attempted per recipient.
   * Delivery outcome is recorded honestly: a successful send becomes EMAIL_SENT,
   * a send failure becomes DELIVERY_FAILED — neither implies receipt.
   */
  async issueNotice(user: AuthUser, caseId: string, dto: IssueNoticeDto, ctx: RequestContext) {
    await this.assertCanServe(user, caseId);

    const now = new Date();
    const notice = await this.prisma.formalNotice.create({
      data: {
        caseId,
        type: dto.type,
        subject: dto.subject,
        body: dto.body,
        documentId: dto.documentId,
        issuedById: user.id,
        issuedAt: now,
        status: NoticeStatus.PORTAL_AVAILABLE,
        recipients: {
          create: dto.recipients.map((r) => ({
            userId: r.userId,
            label: r.label,
            email: r.email,
            partyId: r.partyId,
            status: NoticeStatus.PORTAL_AVAILABLE,
            portalAvailableAt: now,
          })),
        },
      },
      include: { recipients: true },
    });

    // Attach served documents (a notice may serve several). The scalar
    // documentId is preserved for back-compat and also recorded as a document.
    const docs = [
      ...(dto.documentId ? [{ filename: 'served-document', documentId: dto.documentId }] : []),
      ...(dto.documents ?? []),
    ];
    if (docs.length > 0) {
      await this.prisma.noticeDocument.createMany({
        data: docs.map((d, i) => ({
          noticeId: notice.id,
          documentId: d.documentId,
          filename: d.filename,
          contentHash: 'contentHash' in d ? d.contentHash : undefined,
          byteSize: 'byteSize' in d ? d.byteSize : undefined,
          sortOrder: i,
        })),
      });
    }

    // Attempt email dispatch per recipient (best-effort notice-to-collect).
    for (const recipient of notice.recipients) {
      // Portal availability is itself a delivery attempt and is always recorded.
      await this.prisma.noticeDeliveryAttempt.create({
        data: {
          recipientId: recipient.id,
          channel: DeliveryChannel.PORTAL,
          outcome: DeliveryOutcome.DELIVERED,
          detail: 'Document made available in the secure case portal.',
        },
      });

      if (!recipient.email) continue;
      try {
        const delivery = await this.delivery.sendTracked({
          to: recipient.email,
          subject: `[Service] ${dto.subject}`,
          text:
            `A formal notice has been served on you in case ${caseId}.\n\n` +
            `Please log in to the portal to access and acknowledge the document.\n\n` +
            `This email is notice that a document awaits collection; it is not itself the served document.`,
          noticeId: notice.id,
          noticeRecipientId: recipient.id,
          caseId,
          noticeType: dto.type,
        });
        if (delivery.status === EmailDeliveryStatus.SENT) {
          await this.prisma.noticeDeliveryAttempt.create({
            data: {
              recipientId: recipient.id,
              channel: DeliveryChannel.EMAIL,
              outcome: DeliveryOutcome.SENT,
              detail: `Notice-to-collect email dispatched (dispatch is not proof of receipt). Provider message ID: ${delivery.providerMessageId ?? 'pending'}.`,
            },
          });
          await this.prisma.noticeRecipient.update({
            where: { id: recipient.id },
            data: { status: NoticeStatus.EMAIL_SENT },
          });
        } else if (delivery.status === EmailDeliveryStatus.FAILED && delivery.nextAttemptAt) {
          await this.prisma.noticeDeliveryAttempt.create({
            data: {
              recipientId: recipient.id,
              channel: DeliveryChannel.EMAIL,
              outcome: DeliveryOutcome.PENDING,
              detail: `Temporary email failure recorded; retry scheduled for ${delivery.nextAttemptAt.toISOString()}.`,
            },
          });
        } else if (delivery.status === EmailDeliveryStatus.FAILED) {
          await this.prisma.noticeDeliveryAttempt.create({
            data: {
              recipientId: recipient.id,
              channel: DeliveryChannel.EMAIL,
              outcome: DeliveryOutcome.FAILED,
              detail: `Email dispatch failed: ${delivery.errorDetail ?? 'Unknown provider failure'}`,
            },
          });
          await this.prisma.noticeRecipient.update({
            where: { id: recipient.id },
            data: { status: NoticeStatus.DELIVERY_FAILED },
          });
        }
      } catch (err) {
        const message = (err as Error).message;
        await this.prisma.noticeDeliveryAttempt.create({
          data: {
            recipientId: recipient.id,
            channel: DeliveryChannel.EMAIL,
            outcome: DeliveryOutcome.FAILED,
            detail: `Email dispatch failed: ${message}`,
          },
        });
        // A failure is captured explicitly so it can drive substitute service.
        await this.prisma.noticeFailure.create({
          data: {
            recipientId: recipient.id,
            channel: DeliveryChannel.EMAIL,
            reason: 'EMAIL_DISPATCH_FAILED',
            detail: message,
          },
        });
        await this.prisma.noticeRecipient.update({
          where: { id: recipient.id },
          data: { status: NoticeStatus.DELIVERY_FAILED },
        });
      }
    }

    await this.audit.record({
      userId: user.id,
      action: 'NOTICE_ISSUED',
      entityType: 'FormalNotice',
      entityId: notice.id,
      caseId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      metadata: { type: dto.type, recipientCount: dto.recipients.length },
    });

    // Notify recipients who have a portal account that a notice awaits them.
    const ref = await this.prisma.case.findUnique({ where: { id: caseId }, select: { reference: true } });
    const vars = { caseRef: ref?.reference ?? caseId, noticeType: dto.type.replaceAll('_', ' ') };
    const link = `/app/cases/${caseId}`;
    for (const recipient of notice.recipients) {
      if (recipient.userId) {
        await this.notifications.dispatch({ userId: recipient.userId, to: recipient.email ?? undefined, key: 'NOTICE_ISSUED', vars, link }).catch(() => undefined);
      }
    }

    return this.getNotice(user, notice.id);
  }

  /**
   * Email-delivery evidence for the case: every tracked send with its provider
   * message id, status trail and failure/fallback details. Restricted to the
   * registry/tribunal (it shows recipient addresses and delivery internals).
   */
  async listEmailDeliveries(user: AuthUser, caseId: string) {
    await this.assertCanServe(user, caseId);
    return this.delivery.listForCase(caseId);
  }

  async listForCase(user: AuthUser, caseId: string) {
    await this.access.assertCanAccessCase(user, caseId);
    return this.prisma.formalNotice.findMany({
      where: { caseId },
      orderBy: { createdAt: 'desc' },
      include: { recipients: { include: { attempts: true } }, certificate: true },
    });
  }

  async getNotice(user: AuthUser, noticeId: string) {
    const notice = await this.prisma.formalNotice.findUnique({
      where: { id: noticeId },
      include: {
        recipients: { include: { attempts: true, accessEvents: true } },
        certificate: true,
      },
    });
    if (!notice) throw new NotFoundException('Notice not found.');
    await this.access.assertCanAccessCase(user, notice.caseId);
    return notice;
  }

  /**
   * Record that a recipient accessed (opened/downloaded) the served document.
   * This is the event that actually evidences receipt.
   */
  async recordAccess(user: AuthUser, noticeId: string, action: 'OPENED' | 'DOWNLOADED', ctx: RequestContext) {
    const notice = await this.prisma.formalNotice.findUnique({
      where: { id: noticeId },
      include: { recipients: true },
    });
    if (!notice) throw new NotFoundException('Notice not found.');
    await this.access.assertCanAccessCase(user, notice.caseId);

    const recipient = notice.recipients.find((r) => r.userId === user.id);
    if (!recipient) {
      throw new ForbiddenException('You are not a recipient of this notice.');
    }

    await this.prisma.noticeAccessEvent.create({
      data: { recipientId: recipient.id, action, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
    });
    await this.prisma.noticeRecipient.update({
      where: { id: recipient.id },
      data: {
        status: NoticeStatus.ACCESSED,
        firstAccessedAt: recipient.firstAccessedAt ?? new Date(),
      },
    });
    await this.audit.record({
      userId: user.id,
      action: 'NOTICE_ACCESSED',
      entityType: 'FormalNotice',
      entityId: noticeId,
      caseId: notice.caseId,
      ipAddress: ctx.ipAddress,
      metadata: { action },
    });
    return { ok: true };
  }

  /** A recipient formally acknowledges receipt. */
  async acknowledge(user: AuthUser, noticeId: string, dto: AcknowledgeNoticeDto, ctx: RequestContext) {
    const notice = await this.prisma.formalNotice.findUnique({
      where: { id: noticeId },
      include: { recipients: true },
    });
    if (!notice) throw new NotFoundException('Notice not found.');
    await this.access.assertCanAccessCase(user, notice.caseId);
    const recipient = notice.recipients.find((r) => r.userId === user.id);
    if (!recipient) throw new ForbiddenException('You are not a recipient of this notice.');

    const acknowledgedAt = new Date();
    const method = dto.method ?? 'portal';
    // Seal the acknowledgement payload so it cannot later be altered unnoticed.
    const ackPayload = JSON.stringify({
      noticeId, recipientId: recipient.id, userId: user.id, method,
      statementText: dto.statementText ?? null, acknowledgedAt: acknowledgedAt.toISOString(),
    });
    const receiptHash = createHash('sha256').update(ackPayload).digest('hex');

    const [, , ack] = await this.prisma.$transaction([
      this.prisma.noticeRecipient.update({
        where: { id: recipient.id },
        data: { status: NoticeStatus.ACKNOWLEDGED, acknowledgedAt, acknowledgementMethod: method },
      }),
      // The notice itself is acknowledged: status reflects completed service.
      this.prisma.formalNotice.update({ where: { id: noticeId }, data: { status: NoticeStatus.ACKNOWLEDGED } }),
      this.prisma.noticeAcknowledgement.create({
        data: {
          recipientId: recipient.id,
          acknowledgedById: user.id,
          method,
          statementText: dto.statementText,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          signatureMetadata: dto.signatureMetadata ? JSON.stringify(dto.signatureMetadata) : null,
          receiptHash,
        },
      }),
    ]);

    await this.audit.record({
      userId: user.id,
      action: 'NOTICE_ACKNOWLEDGED',
      entityType: 'FormalNotice',
      entityId: noticeId,
      caseId: notice.caseId,
      ipAddress: ctx.ipAddress,
      metadata: { receiptHash, method },
    });
    return ack;
  }

  /** Order additional (non-electronic) service when electronic service fails. */
  async orderSubstituteService(user: AuthUser, noticeId: string, dto: SubstituteServiceDto) {
    const notice = await this.prisma.formalNotice.findUnique({ where: { id: noticeId } });
    if (!notice) throw new NotFoundException('Notice not found.');
    await this.assertCanServe(user, notice.caseId);

    const order = await this.prisma.substituteServiceOrder.create({
      data: { noticeId, method: dto.method, instructions: dto.instructions, orderedById: user.id },
    });
    await this.prisma.formalNotice.update({
      where: { id: noticeId },
      data: { status: NoticeStatus.SUBSTITUTE_SERVICE_REQUIRED },
    });
    // Link the outstanding failures on this notice to the substitute order so
    // the audit trail shows which failures the order addresses.
    await this.prisma.noticeFailure.updateMany({
      where: { recipient: { noticeId }, substituteOrderId: null, resolvedAt: null },
      data: { substituteOrderId: order.id, resolvedAt: new Date() },
    });
    await this.audit.record({
      userId: user.id,
      action: 'SUBSTITUTE_SERVICE_ORDERED',
      entityType: 'FormalNotice',
      entityId: noticeId,
      caseId: notice.caseId,
      metadata: { method: dto.method },
    });
    return order;
  }

  /**
   * Generate the immutable Certificate of Electronic Service from the recorded
   * audit trail. The payload snapshots every recipient, method, timestamp and
   * status, and is sealed with a SHA-256 hash.
   */
  async generateCertificate(user: AuthUser, noticeId: string) {
    const notice = await this.prisma.formalNotice.findUnique({
      where: { id: noticeId },
      include: {
        case: { select: { reference: true } },
        documents: true,
        recipients: { include: { attempts: true, accessEvents: true, acknowledgements: true, failures: true } },
      },
    });
    if (!notice) throw new NotFoundException('Notice not found.');
    await this.assertCanServe(user, notice.caseId);

    const existing = await this.prisma.serviceCertificate.findUnique({ where: { noticeId } });
    if (existing) return existing;

    const payloadObj = {
      caseReference: notice.case.reference,
      noticeId: notice.id,
      noticeType: notice.type,
      subject: notice.subject,
      issuedById: notice.issuedById,
      issuedAt: notice.issuedAt,
      generatedAt: new Date().toISOString(),
      documents: notice.documents.map((d) => ({ filename: d.filename, contentHash: d.contentHash, byteSize: d.byteSize })),
      recipients: notice.recipients.map((r) => ({
        label: r.label,
        email: r.email,
        status: r.status,
        portalAvailableAt: r.portalAvailableAt,
        firstAccessedAt: r.firstAccessedAt,
        acknowledgedAt: r.acknowledgedAt,
        attempts: r.attempts.map((a) => ({ channel: a.channel, outcome: a.outcome, at: a.createdAt, detail: a.detail })),
        accessEvents: r.accessEvents.map((e) => ({ action: e.action, at: e.createdAt })),
        acknowledgements: r.acknowledgements.map((a) => ({ method: a.method, at: a.createdAt, receiptHash: a.receiptHash })),
        failures: r.failures.map((f) => ({ channel: f.channel, reason: f.reason, at: f.createdAt, resolvedAt: f.resolvedAt, substituteOrderId: f.substituteOrderId })),
      })),
    };
    const payload = JSON.stringify(payloadObj);
    const payloadHash = createHash('sha256').update(payload).digest('hex');
    const certificateNumber = `COS-${new Date().getUTCFullYear()}-${randomUUID().slice(0, 8).toUpperCase()}`;

    const allCompleted = notice.recipients.every(
      (r) => r.status === NoticeStatus.ACCESSED || r.status === NoticeStatus.ACKNOWLEDGED,
    );

    const [certificate] = await this.prisma.$transaction([
      this.prisma.serviceCertificate.create({
        data: { noticeId, certificateNumber, generatedById: user.id, payload, payloadHash },
      }),
      this.prisma.formalNotice.update({
        where: { id: noticeId },
        data: allCompleted ? { status: NoticeStatus.SERVICE_COMPLETED } : {},
      }),
    ]);

    // Render the certificate as a sealed PDF and store it durably.
    const pdfBuffer = await this.pdf.renderServiceCertificate({
      certificateNumber,
      caseReference: notice.case.reference,
      noticeType: notice.type,
      subject: notice.subject,
      issuedAt: notice.issuedAt,
      generatedAt: new Date(),
      payloadHash,
      recipients: payloadObj.recipients.map((r) => ({
        label: r.label, email: r.email, status: r.status,
        portalAvailableAt: r.portalAvailableAt, firstAccessedAt: r.firstAccessedAt, acknowledgedAt: r.acknowledgedAt,
      })),
      documents: payloadObj.documents.map((d) => ({ filename: d.filename, contentHash: d.contentHash })),
    });
    const documentHash = createHash('sha256').update(pdfBuffer).digest('hex');
    const stored = await this.storage.put(pdfBuffer, `certificate-${certificateNumber}.pdf`);
    const withDoc = await this.prisma.serviceCertificate.update({
      where: { id: certificate.id },
      data: { documentKey: stored.storageKey, documentHash },
    });

    await this.audit.record({
      userId: user.id,
      action: 'SERVICE_CERTIFICATE_GENERATED',
      entityType: 'ServiceCertificate',
      entityId: certificate.id,
      caseId: notice.caseId,
      metadata: { certificateNumber, allCompleted, documentHash },
    });
    return withDoc;
  }

  /** Stream the generated Certificate of Electronic Service PDF. */
  async downloadCertificate(user: AuthUser, noticeId: string, ctx: RequestContext) {
    const notice = await this.prisma.formalNotice.findUnique({
      where: { id: noticeId },
      include: { case: { select: { reference: true } }, certificate: true },
    });
    if (!notice) throw new NotFoundException('Notice not found.');
    await this.assertCanServe(user, notice.caseId);
    if (!notice.certificate?.documentKey) {
      throw new NotFoundException('No certificate document has been generated for this notice.');
    }
    const buffer = await this.storage.get(notice.certificate.documentKey);
    await this.audit.record({
      userId: user.id,
      action: 'SERVICE_CERTIFICATE_DOWNLOADED',
      entityType: 'ServiceCertificate',
      entityId: notice.certificate.id,
      caseId: notice.caseId,
      ipAddress: ctx.ipAddress,
    });
    return { buffer, fileName: `certificate-${notice.certificate.certificateNumber}.pdf` };
  }

  /**
   * Notice requirements raised by the rules engine for this case (REQUIRE_NOTICE
   * actions). This is how the engine drives service: a recorded procedural event
   * tells the registry which formal notices the rules require to be served.
   */
  async listNoticeRequirements(user: AuthUser, caseId: string) {
    await this.access.assertCanAccessCase(user, caseId);
    const executions = await this.prisma.caseRuleExecution.findMany({
      where: { caseId, actionKind: 'REQUIRE_NOTICE' },
      orderBy: { executedAt: 'asc' },
      include: { rule: { select: { number: true, title: true, requiredNotice: true } } },
    });
    return executions.map((e) => {
      let targetKey: string | undefined;
      try {
        targetKey = (JSON.parse(e.detail ?? '{}') as { targetKey?: string }).targetKey;
      } catch {
        targetKey = undefined;
      }
      return {
        executionId: e.id,
        rule: e.rule,
        requiredNotice: targetKey ?? e.rule.requiredNotice,
        status: e.status,
        executedAt: e.executedAt,
      };
    });
  }
}
