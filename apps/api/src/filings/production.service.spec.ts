import { ProductionService } from './production.service';
import { ProductionStatus } from '@prisma/client';
import { AuthUser } from '../auth/types';

const partyUser = { id: 'u1', email: 'p@x.com', roles: [], permissions: [] } as unknown as AuthUser;
const arbitratorUser = { id: 'a1', email: 'arb@x.com', roles: [], permissions: [] } as unknown as AuthUser;

/**
 * Chapter 12: the portal records the request schedule but the TRIBUNAL alone
 * decides production. The portal never grants relief itself.
 */
describe('ProductionService', () => {
  function makeService(membership: Record<string, unknown>, request?: Record<string, unknown>) {
    const updates: Record<string, unknown>[] = [];
    const prisma = {
      productionRequest: {
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockImplementation(({ data }) => ({ id: 'r1', ...data })),
        findUnique: jest.fn().mockResolvedValue(request ?? { id: 'r1', caseId: 'c1', status: ProductionStatus.REQUESTED }),
        update: jest.fn().mockImplementation(({ data }) => {
          updates.push(data);
          return { id: 'r1', ...data };
        }),
      },
      productionDocument: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const access = { assertCanAccessCase: jest.fn().mockResolvedValue(membership) };
    const service = new ProductionService(prisma as never, audit as never, access as never);
    return { service, prisma, updates };
  }

  it('lets a party create a request with a sequential number', async () => {
    const { service, prisma } = makeService({ isParty: true });
    await service.createRequest(partyUser, 'c1', { category: 'All EPC progress reports 2025' });
    const data = prisma.productionRequest.create.mock.calls[0][0].data;
    expect(data.requestNumber).toBe('R-0001');
    expect(data.status).toBe(ProductionStatus.REQUESTED);
  });

  it('forbids a non-party from creating a request', async () => {
    const { service } = makeService({ isParty: false, isTribunal: true });
    await expect(service.createRequest(arbitratorUser, 'c1', { category: 'x' })).rejects.toThrow();
  });

  it('lets ONLY the tribunal decide a request', async () => {
    const { service, updates } = makeService({ isTribunal: true, isParty: false });
    await service.decide(arbitratorUser, 'r1', { decision: ProductionStatus.GRANTED, reason: 'Relevant and material' });
    expect(updates[0].status).toBe(ProductionStatus.GRANTED);
    expect(updates[0].tribunalDecision).toBe(ProductionStatus.GRANTED);
  });

  it('forbids a party from deciding a request (no portal-granted relief)', async () => {
    const { service } = makeService({ isParty: true, isTribunal: false });
    await expect(service.decide(partyUser, 'r1', { decision: ProductionStatus.GRANTED, reason: 'x' })).rejects.toThrow();
  });

  it('rejects production before the tribunal has granted the request', async () => {
    const { service } = makeService({ isParty: true }, { id: 'r1', caseId: 'c1', status: ProductionStatus.OBJECTED });
    await expect(service.produce(partyUser, 'r1', { documentIds: ['d1'] })).rejects.toThrow();
  });

  it('allows production once the request is granted', async () => {
    const { service, updates } = makeService({ isParty: true }, { id: 'r1', caseId: 'c1', status: ProductionStatus.GRANTED });
    await service.produce(partyUser, 'r1', { documentIds: ['d1', 'd2'] });
    expect(updates[0].status).toBe(ProductionStatus.PRODUCED);
  });
});
