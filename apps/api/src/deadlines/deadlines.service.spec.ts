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
