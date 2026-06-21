import { FilingsService } from './filings.service';
import { CorrectionApproval, FilingStatus, FilingType } from '@prisma/client';
import { AuthUser } from '../auth/types';

const party = { id: 'u1', email: 'claimant@x.com', roles: [], permissions: [] } as unknown as AuthUser;

/**
 * Chapter 10 guarantee: a filed document is NEVER silently replaced. A correction
 * creates a new, superseding version; the original is retained.
 */
describe('FilingsService', () => {
  function base() {
    const calls: Record<string, unknown[]> = {};
    const rec = (k: string, v: unknown) => ((calls[k] ??= []).push(v), v);
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const engine = { applyEvent: jest.fn().mockResolvedValue([]) };
    return { calls, rec, audit, engine };
  }

  describe('submit', () => {
    function makeService() {
      const { calls, rec, audit, engine } = base();
      const prisma = {
        case: { findUnique: jest.fn().mockResolvedValue({ reference: 'GAAP-2026-1' }) },
        filing: {
          count: jest.fn().mockResolvedValue(0),
          create: jest.fn().mockImplementation(({ data }) => rec('filing.create', data) && { id: 'f1', ...data }),
          findUnique: jest.fn().mockResolvedValue({ id: 'f1', caseId: 'c1', documents: [], receipt: null, corrections: [] }),
          findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'f1', filingNumber: 'F-0001', version: 1, documents: [], case: { reference: 'GAAP-2026-1' } }),
        },
        filingReceipt: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn().mockImplementation(({ data }) => rec('receipt.create', data)) },
        caseProceduralEvent: { create: jest.fn().mockResolvedValue({ id: 'e1' }) },
      };
      const access = { assertCanAccessCase: jest.fn().mockResolvedValue({ isParty: true, isRegistrar: false }) };
      const notifications = { dispatch: jest.fn().mockResolvedValue(undefined), notifyCaseMembers: jest.fn().mockResolvedValue(undefined) };
      const service = new FilingsService(prisma as never, audit as never, access as never, engine as never, notifications as never);
      return { service, prisma, calls, engine };
    }

    it('assigns a sequential filing number, seals a content hash and issues a receipt', async () => {
      const { service, calls } = makeService();
      await service.submit(party, 'c1', { type: FilingType.STATEMENT_OF_CLAIM, title: 'Statement of Claim' });
      const created = calls['filing.create'][0] as { filingNumber: string; contentHash: string; status: string };
      expect(created.filingNumber).toBe('F-0001');
      expect(created.contentHash).toMatch(/^[a-f0-9]{64}$/);
      expect(created.status).toBe(FilingStatus.SUBMITTED);
      expect(calls['receipt.create']).toHaveLength(1);
    });

    it('records a FILING_SUBMITTED procedural event and runs the engine', async () => {
      const { service, prisma, engine } = makeService();
      await service.submit(party, 'c1', { type: FilingType.STATEMENT_OF_DEFENCE, title: 'Defence' });
      expect(prisma.caseProceduralEvent.create).toHaveBeenCalled();
      expect(engine.applyEvent).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'FILING_SUBMITTED' }));
    });
  });

  describe('decideCorrection — approval creates a superseding version', () => {
    function makeService(correctionApproval: CorrectionApproval = CorrectionApproval.PENDING) {
      const { calls, rec, audit, engine } = base();
      const filing = { id: 'f1', caseId: 'c1', filingNumber: 'F-0001', version: 1, type: FilingType.STATEMENT_OF_CLAIM, title: 'SoC', partyId: null, representativeUserId: null, officialTimezone: 'UTC', confidentiality: 'CASE_PARTIES', documents: [{ documentId: 'd1' }] };
      const prisma = {
        filingCorrection: {
          findUnique: jest.fn().mockResolvedValue({ id: 'corr1', approval: correctionApproval, previousVersion: 1, newVersion: 2, filing }),
          update: jest.fn().mockImplementation(({ data }) => rec('correction.update', data)),
        },
        filing: {
          create: jest.fn().mockImplementation(({ data }) => rec('filing.create', data) && { id: 'f2', ...data }),
          update: jest.fn().mockImplementation(({ where, data }) => rec('filing.update', { where, data })),
          findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'f2', filingNumber: 'F-0001-v2', version: 2, documents: [], case: { reference: 'GAAP-2026-1' } }),
        },
        filingReceipt: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({}) },
      };
      const access = { assertCanAccessCase: jest.fn().mockResolvedValue({ isRegistrar: true, isTribunal: false }) };
      const notifications = { dispatch: jest.fn().mockResolvedValue(undefined), notifyCaseMembers: jest.fn().mockResolvedValue(undefined) };
      const service = new FilingsService(prisma as never, audit as never, access as never, engine as never, notifications as never);
      return { service, calls };
    }

    it('creates a new version linked to the original and marks the original SUPERSEDED', async () => {
      const { service, calls } = makeService();
      await service.decideCorrection({ id: 'reg1', permissions: [], roles: [] } as unknown as AuthUser, 'corr1', { approve: true });

      const newFiling = calls['filing.create'][0] as { supersedesId: string; version: number };
      expect(newFiling.supersedesId).toBe('f1');
      expect(newFiling.version).toBe(2);

      const oldUpdate = calls['filing.update'][0] as { where: { id: string }; data: { status: string } };
      expect(oldUpdate.where.id).toBe('f1');
      expect(oldUpdate.data.status).toBe(FilingStatus.SUPERSEDED);

      const corrUpdate = calls['correction.update'][0] as { approval: string };
      expect(corrUpdate.approval).toBe(CorrectionApproval.APPROVED);
    });

    it('rejects deciding a correction that was already decided', async () => {
      const { service } = makeService(CorrectionApproval.APPROVED);
      await expect(
        service.decideCorrection({ id: 'reg1', permissions: [], roles: [] } as unknown as AuthUser, 'corr1', { approve: true }),
      ).rejects.toThrow();
    });
  });
});
