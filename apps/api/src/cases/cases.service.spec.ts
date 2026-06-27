import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Permission, Role } from '@gaap/shared';
import { CasesService } from './cases.service';
import { AuthUser } from '../auth/types';

const registrar = { id: 'r1', email: 'reg@x.com', roles: [Role.REGISTRAR], permissions: [Permission.CASE_VIEW_QUEUE] } as unknown as AuthUser;
const party = { id: 'p1', email: 'party@x.com', roles: [Role.INDIVIDUAL], permissions: [] } as unknown as AuthUser;

function make(over: { auditRows?: unknown[] } = {}) {
  const prisma = {
    case: { update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'c1', reference: 'GAAP-1', ...data })) },
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
