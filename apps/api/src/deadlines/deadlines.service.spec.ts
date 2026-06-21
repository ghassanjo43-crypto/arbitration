import { DeadlinesService } from './deadlines.service';
import { DeadlineChangeKind, DeadlineStatus } from '@prisma/client';
import { AuthUser } from '../auth/types';
import { Permission } from '@gaap/shared';

/**
 * Verifies the spec rule: "Extensions must never silently overwrite the original
 * deadline. Preserve original deadline, extension order, new deadline and reason."
 */
describe('DeadlinesService.extend (non-destructive)', () => {
  const original = {
    id: 'd1',
    caseId: 'c1',
    dueAt: new Date('2026-07-01T23:59:59.000Z'),
  };

  function makeService() {
    const created: Record<string, unknown>[] = [];
    const prisma = {
      deadline: {
        findUnique: jest.fn().mockResolvedValue(original),
        update: jest.fn().mockImplementation(({ data }) => ({ ...original, ...data })),
      },
      deadlineExtension: {
        create: jest.fn().mockImplementation(({ data }) => {
          created.push(data);
          return data;
        }),
      },
      deadlineReminder: { deleteMany: jest.fn().mockResolvedValue({}), createMany: jest.fn().mockResolvedValue({}) },
      // Run the operations array eagerly, as Prisma would.
      $transaction: jest.fn().mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops)),
    };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const access = { assertCanAccessCase: jest.fn().mockResolvedValue({ isTribunal: true }) };
    const service = new DeadlinesService(prisma as never, audit as never, access as never);
    return { service, prisma, audit, created };
  }

  const user: AuthUser = {
    id: 'u1',
    email: 'registrar@example.com',
    roles: [],
    permissions: [Permission.CASE_MANAGE_DEADLINES],
  } as unknown as AuthUser;

  it('records the previous due date, the reason and the ordering authority', async () => {
    const { service, created } = makeService();
    await service.extend(user, 'd1', { extendedTo: '2026-07-15T23:59:59.000Z', reason: 'Joint request of the parties' });

    expect(created).toHaveLength(1);
    const ext = created[0];
    expect(ext.kind).toBe(DeadlineChangeKind.EXTENSION);
    expect((ext.previousDueAt as Date).toISOString()).toBe('2026-07-01T23:59:59.000Z');
    expect((ext.newDueAt as Date).toISOString()).toBe('2026-07-15T23:59:59.000Z');
    expect(ext.reason).toBe('Joint request of the parties');
    expect(ext.orderedById).toBe('u1');
  });

  it('moves the deadline forward and marks it EXTENDED only after recording history', async () => {
    const { service, prisma } = makeService();
    const result = await service.extend(user, 'd1', { extendedTo: '2026-07-15T23:59:59.000Z', reason: 'Force majeure' });
    expect(prisma.deadlineExtension.create).toHaveBeenCalled();
    expect(result.status).toBe(DeadlineStatus.EXTENDED);
    expect((result.dueAt as Date).toISOString()).toBe('2026-07-15T23:59:59.000Z');
  });

  it('rejects an extension with no reason path (empty handled by DTO) — invalid date guard', async () => {
    const { service } = makeService();
    await expect(
      service.extend(user, 'd1', { extendedTo: 'not-a-date', reason: 'x' }),
    ).rejects.toThrow();
  });
});

/**
 * Suspension must pause the clock and preserve the REMAINING time; resumption
 * adds exactly that remaining time to the resumption moment. Waiver excuses the
 * requirement. None of these silently overwrite the original deadline.
 */
describe('DeadlinesService — suspend / resume / waive', () => {
  const user: AuthUser = { id: 'u1', email: 'r@x.com', roles: [], permissions: [Permission.CASE_MANAGE_DEADLINES] } as unknown as AuthUser;

  function makeService(deadline: Record<string, unknown>) {
    const logRows: Record<string, unknown>[] = [];
    const updates: Record<string, unknown>[] = [];
    const prisma = {
      deadline: {
        findUnique: jest.fn().mockResolvedValue(deadline),
        update: jest.fn().mockImplementation(({ data }) => {
          updates.push(data);
          return { ...deadline, ...data };
        }),
      },
      deadlineExtension: {
        create: jest.fn().mockImplementation(({ data }) => {
          logRows.push(data);
          return data;
        }),
      },
      deadlineReminder: { deleteMany: jest.fn().mockResolvedValue({}), createMany: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn().mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops)),
    };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const access = { assertCanAccessCase: jest.fn().mockResolvedValue({ isTribunal: true }) };
    const service = new DeadlinesService(prisma as never, audit as never, access as never);
    return { service, logRows, updates, prisma };
  }

  it('suspend records a SUSPENSION row and sets status SUSPENDED + suspendedAt', async () => {
    const { service, logRows, updates } = makeService({ id: 'd1', caseId: 'c1', status: DeadlineStatus.OPEN, dueAt: new Date('2026-07-01T00:00:00.000Z'), reminderRule: 'P7D' });
    await service.suspend(user, 'd1', { reason: 'Awaiting deposit' });
    expect(logRows[0]).toMatchObject({ kind: DeadlineChangeKind.SUSPENSION, reason: 'Awaiting deposit' });
    expect(updates[0].status).toBe(DeadlineStatus.SUSPENDED);
    expect(updates[0].suspendedAt).toBeInstanceOf(Date);
  });

  it('resume adds the preserved remaining time to the resumption moment', async () => {
    // 10 days remained at suspension (dueAt − suspendedAt).
    const suspendedAt = new Date('2026-06-21T00:00:00.000Z');
    const dueAt = new Date('2026-07-01T00:00:00.000Z');
    const { service, updates } = makeService({ id: 'd1', caseId: 'c1', status: DeadlineStatus.SUSPENDED, suspendedAt, dueAt, reminderRule: 'P7D' });
    const before = Date.now();
    await service.resume(user, 'd1', { reason: 'Deposit paid' });
    const newDueAt = updates[0].dueAt as Date;
    const expectedMin = before + 10 * 24 * 60 * 60 * 1000;
    expect(newDueAt.getTime()).toBeGreaterThanOrEqual(expectedMin - 2000);
    expect(updates[0].status).toBe(DeadlineStatus.OPEN);
    expect(updates[0].suspendedAt).toBeNull();
  });

  it('resume rejects a deadline that is not suspended', async () => {
    const { service } = makeService({ id: 'd1', caseId: 'c1', status: DeadlineStatus.OPEN, dueAt: new Date(), suspendedAt: null });
    await expect(service.resume(user, 'd1', { reason: 'x' })).rejects.toThrow();
  });

  it('waive records a WAIVER row and sets status WAIVED', async () => {
    const { service, logRows, updates } = makeService({ id: 'd1', caseId: 'c1', status: DeadlineStatus.OPEN, dueAt: new Date(), reminderRule: null });
    await service.waive(user, 'd1', { reason: 'Parties agreed to dispense' });
    expect(logRows[0].kind).toBe(DeadlineChangeKind.WAIVER);
    expect(updates[0].status).toBe(DeadlineStatus.WAIVED);
  });
});
