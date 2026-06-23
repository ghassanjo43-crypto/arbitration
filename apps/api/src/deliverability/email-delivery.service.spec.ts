import { createHmac } from 'crypto';
import { UnauthorizedException } from '@nestjs/common';
import { DeliveryChannel, EmailDeliveryStatus, EmailFailureKind, NoticeStatus } from '@prisma/client';
import { EmailDeliveryService } from './email-delivery.service';
import { EmailWebhookController } from './email-webhook.controller';
import { EmailSendError } from '../providers/email/email.service';

describe('EmailDeliveryService', () => {
  function make(emailSend = jest.fn().mockResolvedValue({ providerMessageId: 'msg_1', provider: 'resend' })) {
    const emailDeliveries: Record<string, unknown>[] = [];
    const emailDeliveryEvents: Record<string, unknown>[] = [];
    const noticeFailures: Record<string, unknown>[] = [];
    const noticeRecipientUpdates: Record<string, unknown>[] = [];
    const formalNoticeUpdates: Record<string, unknown>[] = [];
    const auditEvents: Record<string, unknown>[] = [];
    const deliveryRow = {
      id: 'ed1',
      provider: 'resend',
      providerMessageId: 'msg_1',
      toEmail: 'party@example.com',
      subject: 'Notice',
      status: EmailDeliveryStatus.SENT,
      failureKind: null as EmailFailureKind | null,
      errorDetail: null as string | null,
      attemptCount: 1,
      nextAttemptAt: null as Date | null,
      sentAt: null as Date | null,
      lastEventAt: null as Date | null,
      notificationId: null,
      noticeId: 'notice1',
      noticeRecipientId: 'recipient1',
      caseId: 'case1',
      noticeType: 'HEARING_NOTICE',
    };
    const prisma = {
      emailDelivery: {
        create: jest.fn().mockImplementation(({ data }) => {
          emailDeliveries.push(data);
          return { ...deliveryRow, id: 'ed1', status: data.status, provider: data.provider, providerMessageId: null, attemptCount: 0 };
        }),
        update: jest.fn().mockImplementation(({ data }) => {
          Object.assign(deliveryRow, data);
          return { ...deliveryRow };
        }),
        findFirst: jest.fn().mockResolvedValue(deliveryRow),
        findMany: jest.fn().mockResolvedValue([]),
      },
      emailDeliveryEvent: {
        create: jest.fn().mockImplementation(({ data }) => {
          emailDeliveryEvents.push(data);
          return data;
        }),
      },
      noticeRecipient: {
        update: jest.fn().mockImplementation(({ data }) => {
          noticeRecipientUpdates.push(data);
          return data;
        }),
      },
      noticeFailure: {
        create: jest.fn().mockImplementation(({ data }) => {
          noticeFailures.push(data);
          return data;
        }),
      },
      formalNotice: {
        update: jest.fn().mockImplementation(({ data }) => {
          formalNoticeUpdates.push(data);
          return data;
        }),
      },
    };
    const email = { providerName: 'resend', send: emailSend, verifyWebhook: jest.fn() };
    const audit = { record: jest.fn().mockImplementation((event) => (auditEvents.push(event), undefined)) };
    const service = new EmailDeliveryService(prisma as never, email as never, audit as never);
    return { service, prisma, email, auditEvents, emailDeliveries, emailDeliveryEvents, noticeFailures, noticeRecipientUpdates, formalNoticeUpdates, deliveryRow };
  }

  it('records queued and sent evidence with a provider message id', async () => {
    const { service, auditEvents, emailDeliveries, deliveryRow } = make();
    const result = await service.sendTracked({ to: 'party@example.com', subject: 'Notice', text: 'Body', notificationId: 'notif1', caseId: 'case1' });
    expect(emailDeliveries[0]).toMatchObject({ status: EmailDeliveryStatus.QUEUED, notificationId: 'notif1' });
    expect(result).toMatchObject({ status: EmailDeliveryStatus.SENT, providerMessageId: 'msg_1' });
    expect(deliveryRow.sentAt).toBeInstanceOf(Date);
    expect(auditEvents.map((e) => e.action)).toEqual(expect.arrayContaining(['EMAIL_QUEUED', 'EMAIL_DISPATCHED']));
  });

  it('records delivered provider events without treating them as legal receipt', async () => {
    const { service, noticeRecipientUpdates, auditEvents, deliveryRow } = make();
    await service.handleProviderEvent({ providerMessageId: 'msg_1', type: 'delivered', providerEventId: 'evt_1' });
    expect(deliveryRow.status).toBe(EmailDeliveryStatus.DELIVERED);
    expect(noticeRecipientUpdates).toHaveLength(0);
    expect(auditEvents.map((e) => e.action)).toContain('EMAIL_PROVIDER_EVENT');
  });

  it('routes bounced and failed provider events to manual-service fallback', async () => {
    const { service, noticeFailures, noticeRecipientUpdates, formalNoticeUpdates } = make();
    await service.handleProviderEvent({ providerMessageId: 'msg_1', type: 'bounced', providerEventId: 'evt_bounce', detail: 'mailbox unavailable' });
    expect(noticeRecipientUpdates[0]).toMatchObject({ status: NoticeStatus.DELIVERY_FAILED });
    expect(noticeFailures[0]).toMatchObject({ channel: DeliveryChannel.EMAIL, reason: 'ELECTRONIC_DELIVERY_FAILED' });
    expect(formalNoticeUpdates[0]).toMatchObject({ status: NoticeStatus.SUBSTITUTE_SERVICE_REQUIRED });
  });

  it('records retryable provider failures without immediate manual fallback', async () => {
    const temporary = jest.fn().mockRejectedValue(new EmailSendError('rate limited', 'TEMPORARY', 'resend'));
    const { service, noticeFailures, deliveryRow, auditEvents } = make(temporary);
    const result = await service.sendTracked({ to: 'party@example.com', subject: 'Notice', text: 'Body', noticeId: 'notice1', noticeRecipientId: 'recipient1', caseId: 'case1' });
    expect(result).toMatchObject({ status: EmailDeliveryStatus.FAILED, failureKind: EmailFailureKind.TEMPORARY });
    expect(deliveryRow.nextAttemptAt).toBeInstanceOf(Date);
    expect(noticeFailures).toHaveLength(0);
    expect(auditEvents.map((e) => e.action)).toContain('EMAIL_SEND_FAILED');
  });

  it('does not silently retry permanent failures and raises manual fallback', async () => {
    const permanent = jest.fn().mockRejectedValue(new EmailSendError('invalid recipient', 'PERMANENT', 'resend'));
    const { service, noticeFailures, deliveryRow } = make(permanent);
    await service.sendTracked({ to: 'bad@example.com', subject: 'Notice', text: 'Body', noticeId: 'notice1', noticeRecipientId: 'recipient1', caseId: 'case1' });
    expect(deliveryRow.nextAttemptAt).toBeNull();
    expect(noticeFailures).toHaveLength(1);
  });

  it('audits retry sweeps for due temporary failures', async () => {
    const { service, prisma, auditEvents, emailDeliveryEvents } = make();
    prisma.emailDelivery.findMany.mockResolvedValueOnce([{ id: 'ed1', toEmail: 'party@example.com', subject: 'Notice', notificationId: null, noticeId: 'notice1', noticeRecipientId: 'recipient1', caseId: 'case1', noticeType: 'HEARING_NOTICE', attemptCount: 1 }]);
    const result = await service.retryDue();
    expect(result).toEqual({ retried: 1 });
    expect(emailDeliveryEvents[0]).toMatchObject({ deliveryId: 'ed1', type: 'retry' });
    expect(auditEvents.map((e) => e.action)).toEqual(expect.arrayContaining(['EMAIL_RETRY_ATTEMPT', 'EMAIL_RETRY_SWEEP']));
  });
});

describe('EmailWebhookController', () => {
  it('accepts a verified Resend-style webhook and links it by provider message id', async () => {
    const body = { id: 'evt_1', type: 'email.delivered', data: { email_id: 'msg_1', reason: 'ok' } };
    const raw = JSON.stringify(body);
    const signature = createHmac('sha256', 'secret').update(raw).digest('hex');
    const delivery = {
      verifyWebhook: jest.fn((payload: string, sig?: string) => sig === signature && payload === raw),
      handleProviderEvent: jest.fn().mockResolvedValue({ matched: true, deliveryId: 'ed1' }),
    };
    const controller = new EmailWebhookController(delivery as never);
    await expect(controller.receive({ rawBody: Buffer.from(raw) } as never, signature, body)).resolves.toMatchObject({ accepted: true, matched: true });
    expect(delivery.handleProviderEvent).toHaveBeenCalledWith(expect.objectContaining({ providerMessageId: 'msg_1', type: 'delivered', providerEventId: 'evt_1' }));
  });

  it('rejects unauthorized provider webhooks', async () => {
    const delivery = { verifyWebhook: jest.fn().mockReturnValue(false), handleProviderEvent: jest.fn() };
    const controller = new EmailWebhookController(delivery as never);
    await expect(controller.receive({ rawBody: Buffer.from('{}') } as never, 'bad', {})).rejects.toBeInstanceOf(UnauthorizedException);
    expect(delivery.handleProviderEvent).not.toHaveBeenCalled();
  });
});