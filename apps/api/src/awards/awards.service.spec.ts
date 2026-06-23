import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { AwardsService } from './awards.service';
import { AuthUser } from '../auth/types';

const arbitrator = { id: 'a1', email: 'a@x.com', roles: [], permissions: [] } as unknown as AuthUser;
const party = { id: 'p1', email: 'p@x.com', roles: [], permissions: [] } as unknown as AuthUser;

function make(membership: Record<string, unknown>, award: Record<string, unknown> | null) {
  const prisma = {
    award: {
      findUnique: jest.fn().mockResolvedValue(award),
      update: jest.fn(({ data }: { data: Record<string, unknown> }) => ({ id: 'aw1', ...data })),
    },
    case: { findUnique: jest.fn().mockResolvedValue({ reference: 'GAAP-2026-1', title: 'Acme v Globex' }) },
    caseParty: { findMany: jest.fn().mockResolvedValue([{ side: 'CLAIMANT', legalName: 'Acme' }]) },
    caseTeamMember: { findMany: jest.fn().mockResolvedValue([{ caseRole: 'TRIBUNAL_CHAIR', user: { email: 'a@x.com', profile: { displayName: 'Dr Smith' } } }]) },
  };
  const audit = { record: jest.fn() };
  const access = { assertCanAccessCase: jest.fn().mockResolvedValue(membership) };
  const notifications = { notifyCaseMembers: jest.fn() };
  const storage = { put: jest.fn().mockResolvedValue({ storageKey: '2026/award.pdf', fileHash: 'h', fileSize: 1234 }), get: jest.fn().mockResolvedValue(Buffer.from('%PDF-')) };
  const pdf = { renderAward: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.7 award')) };
  const service = new AwardsService(prisma as never, audit as never, access as never, notifications as never, storage as never, pdf as never);
  return { service, prisma, audit, storage, pdf };
}

describe('AwardsService — document generation', () => {
  it('lets the tribunal generate, store and seal the award PDF', async () => {
    const { service, storage, pdf } = make({ isTribunal: true }, { id: 'aw1', caseId: 'c1', type: 'FINAL', seat: 'Singapore', issueDate: null });
    const res = await service.generateDocument(arbitrator, 'aw1', { body: 'Operative text.' });
    expect(pdf.renderAward).toHaveBeenCalled();
    expect(storage.put).toHaveBeenCalled();
    expect(res.documentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(res.generatedDocumentKey).toBe('2026/award.pdf');
  });

  it('forbids a non-tribunal user from generating the award PDF', async () => {
    const { service } = make({ isTribunal: false, isParty: true }, { id: 'aw1', caseId: 'c1', type: 'FINAL', issueDate: null });
    await expect(service.generateDocument(party, 'aw1', {})).rejects.toThrow(ForbiddenException);
  });

  it('keeps a DRAFT award document away from parties', async () => {
    const { service } = make({ isTribunal: false, isParty: true }, { id: 'aw1', caseId: 'c1', issueDate: null, generatedDocumentKey: '2026/award.pdf' });
    await expect(service.downloadDocument(party, 'aw1')).rejects.toThrow(ForbiddenException);
  });

  it('lets a party download an ISSUED award document', async () => {
    const { service, storage } = make({ isTribunal: false, isParty: true }, { id: 'aw1', caseId: 'c1', issueDate: new Date(), generatedDocumentKey: '2026/award.pdf' });
    const res = await service.downloadDocument(party, 'aw1');
    expect(storage.get).toHaveBeenCalledWith('2026/award.pdf');
    expect(res.fileName).toContain('.pdf');
  });

  it('404s when no document has been generated yet', async () => {
    const { service } = make({ isTribunal: true }, { id: 'aw1', caseId: 'c1', issueDate: new Date(), generatedDocumentKey: null });
    await expect(service.downloadDocument(arbitrator, 'aw1')).rejects.toThrow(NotFoundException);
  });
});
