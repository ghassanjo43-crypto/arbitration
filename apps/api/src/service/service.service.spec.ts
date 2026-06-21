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
    const failures: Record<string, unknown>[] = [];
    const documents: Record<string, unknown>[] = [];
    const createdRecipient = { id: 'r1', email: 'party@example.com', firstAccessedAt: null };

    const prisma = {
      case: { findUnique: jest.fn().mockResolvedValue({ reference: 'GAAP-2026-1' }) },
      formalNotice: {
        create: jest.fn().mockResolvedValue({ id: 'n1', caseId: 'c1', recipients: [createdRecipient] }),
        findUnique: jest.fn().mockResolvedValue({
          id: 'n1',
          caseId: 'c1',
          recipients: [{ ...createdRecipient, status: emailWorks ? NoticeStatus.EMAIL_SENT : NoticeStatus.DELIVERY_FAILED, attempts: [], accessEvents: [] }],
          certificate: null,
        }),
      },
      noticeDocument: {
        createMany: jest.fn().mockImplementation(({ data }) => {
          documents.push(...data);
          return { count: data.length };
        }),
      },
      noticeDeliveryAttempt: {
        create: jest.fn().mockImplementation(({ data }) => {
          attempts.push(data);
          return data;
        }),
      },
      noticeFailure: {
        create: jest.fn().mockImplementation(({ data }) => {
          failures.push(data);
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
    const notifications = { dispatch: jest.fn().mockResolvedValue(undefined) };
    const service = new ServiceService(prisma as never, audit as never, access as never, email as never, notifications as never);
    return { service, attempts, recipientUpdates, failures, documents, email };
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

  it('captures an explicit NoticeFailure when email dispatch fails', async () => {
    const { service, failures } = makeService(false);
    await service.issueNotice(registrar, 'c1', dto, {});
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ channel: 'EMAIL', reason: 'EMAIL_DISPATCH_FAILED' });
  });

  it('records each served document with its content hash', async () => {
    const { service, documents } = makeService(true);
    await service.issueNotice(
      registrar,
      'c1',
      { ...dto, documents: [{ filename: 'notice.pdf', contentHash: 'abc123' }] },
      {},
    );
    expect(documents).toHaveLength(1);
    expect(documents[0]).toMatchObject({ filename: 'notice.pdf', contentHash: 'abc123', noticeId: 'n1' });
  });
});

/**
 * Acknowledgement is a distinct, sealed event — not a mere portal access — and
 * is recorded immutably with a hash over its payload.
 */
describe('ServiceService.acknowledge — sealed acknowledgement', () => {
  const party = { id: 'u2', email: 'party@example.com', roles: [], permissions: [] } as unknown as AuthUser;

  function makeService() {
    const acks: Record<string, unknown>[] = [];
    const prisma = {
      formalNotice: {
        findUnique: jest.fn().mockResolvedValue({ id: 'n1', caseId: 'c1', recipients: [{ id: 'r1', userId: 'u2' }] }),
        update: jest.fn().mockResolvedValue({}),
      },
      noticeRecipient: { update: jest.fn().mockResolvedValue({}) },
      noticeAcknowledgement: {
        create: jest.fn().mockImplementation(({ data }) => {
          acks.push(data);
          return { id: 'ack1', ...data };
        }),
      },
      $transaction: jest.fn().mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops)),
    };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const access = { assertCanAccessCase: jest.fn().mockResolvedValue({}) };
    const service = new ServiceService(prisma as never, audit as never, access as never, { send: jest.fn() } as never, { dispatch: jest.fn() } as never);
    return { service, acks };
  }

  it('creates an immutable acknowledgement sealed with a SHA-256 receipt hash', async () => {
    const { service, acks } = makeService();
    const result = await service.acknowledge(party, 'n1', { statementText: 'I acknowledge receipt.' }, { ipAddress: '203.0.113.4' });
    expect(acks).toHaveLength(1);
    expect(acks[0].method).toBe('portal');
    expect(acks[0].statementText).toBe('I acknowledge receipt.');
    expect((acks[0].receiptHash as string)).toMatch(/^[a-f0-9]{64}$/);
    expect((result as { id: string }).id).toBe('ack1');
  });
});
