import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Permission, Role } from '@gaap/shared';
import { CasesService } from './cases.service';
import { AuthUser } from '../auth/types';

const registrar = { id: 'r1', email: 'reg@x.com', roles: [Role.REGISTRAR], permissions: [Permission.CASE_VIEW_QUEUE] } as unknown as AuthUser;
const party = { id: 'p1', email: 'party@x.com', roles: [Role.INDIVIDUAL], permissions: [] } as unknown as AuthUser;
const company = { id: 'co1', email: 'co@x.com', roles: [Role.COMPANY_CLIENT], permissions: [] } as unknown as AuthUser;
const lawyer = { id: 'l1', email: 'law@x.com', roles: [Role.LAWYER], permissions: [] } as unknown as AuthUser;
const arbitrator = { id: 'a1', email: 'arb@x.com', roles: [Role.ARBITRATOR], permissions: [] } as unknown as AuthUser;
const council = { id: 'cm1', email: 'council@x.com', roles: [Role.COUNCIL_MEMBER], permissions: [] } as unknown as AuthUser;
const superAdmin = { id: 's1', email: 'sa@x.com', roles: [Role.SUPER_ADMIN], permissions: [Permission.USER_MANAGE] } as unknown as AuthUser;
const arbitratorAndParty = { id: 'ap1', email: 'both@x.com', roles: [Role.ARBITRATOR, Role.INDIVIDUAL], permissions: [] } as unknown as AuthUser;

const FILING_403 = 'Only claimants, company parties, or authorized representatives may file a case.';

function make(over: { auditRows?: unknown[] } = {}) {
  const prisma = {
    case: {
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'c1', reference: 'GAAP-1', ...data })),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'new-case', reference: data.reference, stage: data.stage })),
    },
    auditLog: { findMany: jest.fn().mockResolvedValue(over.auditRows ?? []) },
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  // assertCanAccessCase resolves (membership/staff is checked there); the
  // administrative-reach check is real logic inside CasesService.
  const access = { assertCanAccessCase: jest.fn().mockResolvedValue({ isTribunal: false, isRegistrar: true, caseRoles: [] }) };
  const notifications = { notifyCaseMembers: jest.fn() };
  const service = new CasesService(prisma as never, audit as never, access as never, notifications as never);
  return { service, prisma, audit, access };
}

describe('CasesService — case-filing authorization (role separation)', () => {
  it('lets an Individual claimant file a case (creates a draft)', async () => {
    const { service, prisma, audit } = make();
    const res = await service.createDraft(party, { title: 'Acme v Beta' } as never);
    expect(prisma.case.create).toHaveBeenCalledTimes(1);
    expect(res).toEqual(expect.objectContaining({ id: 'new-case', stage: 'DRAFT' }));
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'CASE_DRAFT_CREATED' }));
  });

  it('lets a Company party file a case', async () => {
    const { service, prisma } = make();
    await service.createDraft(company, { title: 'Co claim' } as never);
    expect(prisma.case.create).toHaveBeenCalledTimes(1);
  });

  it('lets an authorized representative (Lawyer) file on behalf of a claimant', async () => {
    const { service, prisma } = make();
    await service.createDraft(lawyer, { title: 'Filed by counsel' } as never);
    expect(prisma.case.create).toHaveBeenCalledTimes(1);
  });

  it('rejects an Arbitrator-only account with a clear 403, without creating anything', async () => {
    const { service, prisma } = make();
    await expect(service.createDraft(arbitrator, { title: 'x' } as never)).rejects.toMatchObject({ message: FILING_403 });
    await expect(service.createDraft(arbitrator, { title: 'x' } as never)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.case.create).not.toHaveBeenCalled();
  });

  it('rejects Registrar, Council and Super Admin accounts from filing a case', async () => {
    for (const staff of [registrar, council, superAdmin]) {
      const { service, prisma } = make();
      await expect(service.createDraft(staff, { title: 'x' } as never)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.case.create).not.toHaveBeenCalled();
    }
  });

  it('allows a dual Arbitrator+Party account to file (party capacity present)', async () => {
    const { service, prisma } = make();
    await service.createDraft(arbitratorAndParty, { title: 'dual' } as never);
    expect(prisma.case.create).toHaveBeenCalledTimes(1);
  });
});

describe('CasesService — registrar administration (non-merits)', () => {
  it('lets a registrar edit administrative case fields and audits it', async () => {
    const { service, prisma, audit } = make();
    const res = await service.updateAdminInfo(registrar, 'c1', { seat: 'Geneva', language: 'en' });
    expect(prisma.case.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'c1' }, data: { seat: 'Geneva', language: 'en' } }));
    expect(res.seat).toBe('Geneva');
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'CASE_ADMIN_UPDATED', caseId: 'c1' }));
  });

  it('blocks a party from editing administrative case fields', async () => {
    const { service } = make();
    await expect(service.updateAdminInfo(party, 'c1', { seat: 'Geneva' })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects an empty administrative update', async () => {
    const { service } = make();
    await expect(service.updateAdminInfo(registrar, 'c1', {})).rejects.toBeInstanceOf(BadRequestException);
  });

  it('records an administrative note on the audit trail', async () => {
    const { service, audit } = make();
    const res = await service.addAdminNote(registrar, 'c1', { note: 'Claimant asked for an extension by phone.' });
    expect(res).toEqual({ ok: true });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'CASE_ADMIN_NOTE', caseId: 'c1',
      metadata: expect.objectContaining({ note: expect.stringContaining('extension'), author: 'reg@x.com' }),
    }));
  });

  it('blocks a party from adding an administrative note', async () => {
    const { service } = make();
    await expect(service.addAdminNote(party, 'c1', { note: 'x' })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('lists administrative notes from the audit trail', async () => {
    const { service } = make({ auditRows: [{ id: 'a1', metadata: JSON.stringify({ note: 'hello', author: 'reg@x.com' }), createdAt: new Date('2026-06-20') }] });
    const notes = await service.listAdminNotes(registrar, 'c1');
    expect(notes).toEqual([{ id: 'a1', note: 'hello', author: 'reg@x.com', at: new Date('2026-06-20') }]);
  });
});
