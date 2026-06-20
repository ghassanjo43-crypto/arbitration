import { createHash, randomUUID } from 'node:crypto';
import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DeliveryChannel,
  DeliveryOutcome,
  NoticeStatus,
} from '@prisma/client';
import { Permission } from '@gaap/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CaseAccessService } from '../authz/case-access.service';
import { EmailService } from '../providers/email/email.service';
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
    private readonly email: EmailService,
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
        await this.email.send({
          to: recipient.email,
          subject: `[Service] ${dto.subject}`,
          text:
            `A formal notice has been served on you in case ${caseId}.\n\n` +
            `Please log in to the portal to access and acknowledge the document.\n\n` +
            `This email is notice that a document awaits collection; it is not itself the served document.`,
        });
        await this.prisma.noticeDeliveryAttempt.create({
          data: {
            recipientId: recipient.id,
            channel: DeliveryChannel.EMAIL,
            outcome: DeliveryOutcome.SENT,
            detail: 'Notice-to-collect email dispatched (dispatch is not proof of receipt).',
          },
        });
        await this.prisma.noticeRecipient.update({
          where: { id: recipient.id },
          data: { status: NoticeStatus.EMAIL_SENT },
        });
      } catch (err) {
        await this.prisma.noticeDeliveryAttempt.create({
          data: {
            recipientId: recipient.id,
            channel: DeliveryChannel.EMAIL,
            outcome: DeliveryOutcome.FAILED,
            detail: `Email dispatch failed: ${(err as Error).message}`,
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

    return this.getNotice(user, notice.id);
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

    const updated = await this.prisma.noticeRecipient.update({
      where: { id: recipient.id },
      data: {
        status: NoticeStatus.ACKNOWLEDGED,
        acknowledgedAt: new Date(),
        acknowledgementMethod: dto.method ?? 'portal',
      },
    });
    await this.audit.record({
      userId: user.id,
      action: 'NOTICE_ACKNOWLEDGED',
      entityType: 'FormalNotice',
      entityId: noticeId,
      caseId: notice.caseId,
      ipAddress: ctx.ipAddress,
    });
    return updated;
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
        recipients: { include: { attempts: true, accessEvents: true } },
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
      recipients: notice.recipients.map((r) => ({
        label: r.label,
        email: r.email,
        status: r.status,
        portalAvailableAt: r.portalAvailableAt,
        firstAccessedAt: r.firstAccessedAt,
        acknowledgedAt: r.acknowledgedAt,
        attempts: r.attempts.map((a) => ({ channel: a.channel, outcome: a.outcome, at: a.createdAt, detail: a.detail })),
        accessEvents: r.accessEvents.map((e) => ({ action: e.action, at: e.createdAt })),
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

    await this.audit.record({
      userId: user.id,
      action: 'SERVICE_CERTIFICATE_GENERATED',
      entityType: 'ServiceCertificate',
      entityId: certificate.id,
      caseId: notice.caseId,
      metadata: { certificateNumber, allCompleted },
    });
    return certificate;
  }
}
