import { DepositsService } from './deposits.service';
import { ShareStatus } from '@prisma/client';
import { AuthUser } from '../auth/types';
import { Permission } from '@gaap/shared';

/**
 * Verifies the spec rules: a party may pay another party's unpaid share
 * (substitute payment) WITHOUT admission/waiver, an open default is then cured,
 * and the share is marked PAID_BY_SUBSTITUTE.
 */
describe('DepositsService.recordPayment — substitute payment', () => {
  const finance = {
    id: 'fin1', email: 'finance@example.com', roles: [],
    permissions: [Permission.PAYMENT_RECORD],
  } as unknown as AuthUser;

  function makeService(shareAmount: number, alreadyPaid: number) {
    const allocation = {
      id: 'a1', partyId: 'respondent', depositRequestId: 'dr1', currency: 'USD',
      shareAmount, paidAmount: alreadyPaid, paidBySubstitutePartyId: null,
      depositRequest: { caseId: 'c1', title: 'Initial deposit' },
    };
    const updates: Record<string, unknown>[] = [];
    const defaultsUpdated: Record<string, unknown>[] = [];
    const prisma = {
      depositAllocation: {
        findUnique: jest.fn().mockResolvedValue(allocation),
        update: jest.fn().mockImplementation(({ data }) => { updates.push(data); return data; }),
        findMany: jest.fn().mockResolvedValue([{ id: 'a1', shareAmount, paidAmount: shareAmount, status: ShareStatus.PAID_BY_SUBSTITUTE }]),
      },
      depositPayment: { create: jest.fn().mockImplementation(({ data }) => data) },
      financialLedgerEntry: { create: jest.fn().mockResolvedValue({}) },
      depositRequest: { update: jest.fn().mockResolvedValue({}) },
      paymentDefault: { updateMany: jest.fn().mockImplementation((arg) => { defaultsUpdated.push(arg.data); return { count: 1 }; }) },
      $transaction: jest.fn().mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops)),
    };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const access = { assertCanAccessCase: jest.fn().mockResolvedValue({ isRegistrar: false }) };
    const service = new DepositsService(prisma as never, audit as never, access as never);
    return { service, updates, defaultsUpdated, prisma };
  }

  it('marks the share PAID_BY_SUBSTITUTE when another party covers it in full', async () => {
    const { service, updates } = makeService(5000, 0);
    const res = await service.recordPayment(finance, 'a1', { amount: 5000, paidByPartyId: 'claimant' });
    expect(res.status).toBe(ShareStatus.PAID_BY_SUBSTITUTE);
    const allocUpdate = updates.find((u) => u.status === ShareStatus.PAID_BY_SUBSTITUTE);
    expect(allocUpdate?.paidBySubstitutePartyId).toBe('claimant');
  });

  it('cures an open default via substitute payment', async () => {
    const { service, defaultsUpdated } = makeService(5000, 0);
    await service.recordPayment(finance, 'a1', { amount: 5000, paidByPartyId: 'claimant', substitute: true });
    expect(defaultsUpdated[0]?.status).toBe('CURED_BY_SUBSTITUTE');
  });

  it('records a partial payment without prematurely marking the share paid', async () => {
    const { service } = makeService(5000, 0);
    const res = await service.recordPayment(finance, 'a1', { amount: 2000 });
    expect(res.status).toBe(ShareStatus.PARTIALLY_PAID);
  });
});
