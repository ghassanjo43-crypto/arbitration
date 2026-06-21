import { ExpeditedService } from './expedited.service';
import { MultiPartyService } from './multiparty.service';
import { ExpeditedBasis, ExpeditedStatus, JoinderStatus, JoinderType } from '@prisma/client';
import { AuthUser } from '../auth/types';

const party = { id: 'p1', email: 'p@x.com', roles: [], permissions: [] } as unknown as AuthUser;
const registrar = { id: 'r1', email: 'r@x.com', roles: [], permissions: [] } as unknown as AuthUser;
const arbitrator = { id: 'a1', email: 'a@x.com', roles: [], permissions: [] } as unknown as AuthUser;

// ---- Expedited (Ch23) -----------------------------------------------------

describe('ExpeditedService (Ch23) — never automatic', () => {
  function make(membership: Record<string, unknown>, track?: Record<string, unknown>, consents: Record<string, unknown>[] = []) {
    const updates: Record<string, unknown>[] = [];
    const prisma = {
      expeditedTrack: {
        findUnique: jest.fn().mockResolvedValue(track ?? null),
        create: jest.fn(({ data }) => ({ id: 't1', ...data })),
        update: jest.fn(({ data }) => (updates.push(data), { id: 't1', ...data })),
      },
      expeditedConsent: {
        upsert: jest.fn(({ create }) => create),
        findMany: jest.fn().mockResolvedValue(consents),
      },
    };
    const audit = { record: jest.fn() };
    const access = { assertCanAccessCase: jest.fn().mockResolvedValue(membership) };
    return { service: new ExpeditedService(prisma as never, audit as never, access as never), prisma, updates };
  }

  it('blocks activation on a party-agreement basis when no party has consented', async () => {
    const track = { id: 't1', caseId: 'c1', basis: ExpeditedBasis.PARTY_AGREEMENT, status: ExpeditedStatus.PROPOSED };
    const { service } = make({ isRegistrar: true }, track, []); // no consents
    await expect(service.activate(registrar, 'c1')).rejects.toThrow(/agreement/i);
  });

  it('blocks activation when a party has declined', async () => {
    const track = { id: 't1', caseId: 'c1', basis: ExpeditedBasis.PARTY_AGREEMENT, status: ExpeditedStatus.PROPOSED };
    const { service } = make({ isRegistrar: true }, track, [{ consented: true }, { consented: false }]);
    await expect(service.activate(registrar, 'c1')).rejects.toThrow(/agreement/i);
  });

  it('activates on a party-agreement basis once parties agree (deliberate, authorised)', async () => {
    const track = { id: 't1', caseId: 'c1', basis: ExpeditedBasis.PARTY_AGREEMENT, status: ExpeditedStatus.AGREED };
    const { service, updates } = make({ isRegistrar: true }, track, [{ consented: true }, { consented: true }]);
    await service.activate(registrar, 'c1');
    expect(updates[0].status).toBe(ExpeditedStatus.ACTIVE);
  });

  it('forbids a party (non-registry/tribunal) from activating', async () => {
    const track = { id: 't1', caseId: 'c1', basis: ExpeditedBasis.RULES_THRESHOLD, status: ExpeditedStatus.PROPOSED };
    const { service } = make({ isParty: true, isRegistrar: false, isTribunal: false }, track, []);
    await expect(service.activate(party, 'c1')).rejects.toThrow();
  });
});

// ---- Multi-party (Ch24) ---------------------------------------------------

describe('MultiPartyService (Ch24) — tribunal/appointing authority decides', () => {
  function make(membership: Record<string, unknown>, request?: Record<string, unknown>) {
    const updates: Record<string, unknown>[] = [];
    const prisma = {
      partyJoinderRequest: {
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn(({ data }) => ({ id: 'j1', ...data })),
        findUnique: jest.fn().mockResolvedValue(request ?? { id: 'j1', caseId: 'c1', status: JoinderStatus.REQUESTED, decidedAt: null, requestedById: 'p1' }),
        update: jest.fn(({ data }) => (updates.push(data), { id: 'j1', ...data })),
      },
      joinderComment: { create: jest.fn(({ data }) => ({ id: 'cm1', ...data })) },
    };
    const audit = { record: jest.fn() };
    const access = { assertCanAccessCase: jest.fn().mockResolvedValue(membership) };
    return { service: new MultiPartyService(prisma as never, audit as never, access as never), prisma, updates };
  }

  it('lets a party file a consolidation request with a sequential number', async () => {
    const { service, prisma } = make({ isParty: true });
    await service.request(party, 'c1', { type: JoinderType.CONSOLIDATION, subjectDescription: 'Related case GAAP-2026-9' });
    expect(prisma.partyJoinderRequest.create.mock.calls[0][0].data.requestNumber).toBe('J-0001');
  });

  it('lets the tribunal decide a request', async () => {
    const { service, updates } = make({ isTribunal: true });
    await service.decide(arbitrator, 'j1', { grant: true, reason: 'Same parties, related contracts' });
    expect(updates[0].status).toBe(JoinderStatus.GRANTED);
  });

  it('lets the appointing authority (registry) decide a request', async () => {
    const { service, updates } = make({ isRegistrar: true, isTribunal: false });
    await service.decide(registrar, 'j1', { grant: false, reason: 'Distinct disputes' });
    expect(updates[0].status).toBe(JoinderStatus.DENIED);
  });

  it('forbids a mere party from deciding its own request', async () => {
    const { service } = make({ isParty: true, isTribunal: false, isRegistrar: false });
    await expect(service.decide(party, 'j1', { grant: true, reason: 'x' })).rejects.toThrow();
  });

  it('rejects deciding an already-decided request', async () => {
    const { service } = make({ isTribunal: true }, { id: 'j1', caseId: 'c1', decidedAt: new Date() });
    await expect(service.decide(arbitrator, 'j1', { grant: true, reason: 'x' })).rejects.toThrow(/already been decided/i);
  });
});
