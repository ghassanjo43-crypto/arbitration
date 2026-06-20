import { ServiceService } from './service.service';
import { DeliveryOutcome, NoticeStatus, NoticeType } from '@prisma/client';
import { AuthUser } from '../auth/types';
import { Permission } from '@gaap/shared';

/**
 * Core spec guarantee: "Do not treat email dispatch alone as conclusive proof
 * of receipt." A served notice with a dispatched email must NOT reach an
 * ACCESSED/ACKNOWLEDGED/SERVICE_COMPLETED state from sending alone.
 */
describe('ServiceService.issueNotice — email dispatch is not receipt', () => {
  const registrar = {
    id: 'reg1',
    email: 'registrar@example.com',
    roles: [],
    permissions: [Permission.CASE_MANAGE_SERVICE],
  } as unknown as AuthUser;

  function makeService(emailWorks: boolean) {
    const attempts: Record<string, unknown>[] = [];
    const recipientUpdates: Record<string, unknown>[] = [];
    const createdRecipient = { id: 'r1', email: 'party@example.com', firstAccessedAt: null };

    const prisma = {
      formalNotice: {
        create: jest.fn().mockResolvedValue({ id: 'n1', caseId: 'c1', recipients: [createdRecipient] }),
        findUnique: jest.fn().mockResolvedValue({
          id: 'n1',
          caseId: 'c1',
          recipients: [{ ...createdRecipient, status: emailWorks ? NoticeStatus.EMAIL_SENT : NoticeStatus.DELIVERY_FAILED, attempts: [], accessEvents: [] }],
          certificate: null,
        }),
      },
      noticeDeliveryAttempt: {
        create: jest.fn().mockImplementation(({ data }) => {
          attempts.push(data);
          return data;
        }),
      },
      noticeRecipient: {
        update: jest.fn().mockImplementation(({ data }) => {
          recipientUpdates.push(data);
          return data;
        }),
      },
    };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const access = { assertCanAccessCase: jest.fn().mockResolvedValue({ isRegistrar: true, isTribunal: false }) };
    const email = {
      send: emailWorks
        ? jest.fn().mockResolvedValue(undefined)
        : jest.fn().mockRejectedValue(new Error('bounce')),
    };
    const service = new ServiceService(prisma as never, audit as never, access as never, email as never);
    return { service, attempts, recipientUpdates, email };
  }

  const dto = {
    type: NoticeType.NOTICE_OF_ARBITRATION,
    subject: 'Notice of Arbitration',
    body: 'You are hereby served.',
    recipients: [{ label: 'Respondent Ltd', userId: 'u2', email: 'party@example.com' }],
  };

  it('records EMAIL_SENT (not DELIVERED/ACCESSED) when dispatch succeeds', async () => {
    const { service, attempts, recipientUpdates, email } = makeService(true);
    await service.issueNotice(registrar, 'c1', dto, {});
    expect(email.send).toHaveBeenCalledTimes(1);

    const emailAttempt = attempts.find((a) => a.channel === 'EMAIL');
    expect(emailAttempt?.outcome).toBe(DeliveryOutcome.SENT);
    // Never auto-promote to ACCESSED/ACKNOWLEDGED from a send.
    const statuses = recipientUpdates.map((u) => u.status);
    expect(statuses).toContain(NoticeStatus.EMAIL_SENT);
    expect(statuses).not.toContain(NoticeStatus.ACCESSED);
    expect(statuses).not.toContain(NoticeStatus.ACKNOWLEDGED);
    expect(statuses).not.toContain(NoticeStatus.SERVICE_COMPLETED);
  });

  it('records DELIVERY_FAILED honestly when dispatch throws (no false receipt)', async () => {
    const { service, attempts, recipientUpdates } = makeService(false);
    await service.issueNotice(registrar, 'c1', dto, {});
    const emailAttempt = attempts.find((a) => a.channel === 'EMAIL');
    expect(emailAttempt?.outcome).toBe(DeliveryOutcome.FAILED);
    expect(recipientUpdates.map((u) => u.status)).toContain(NoticeStatus.DELIVERY_FAILED);
  });
});
