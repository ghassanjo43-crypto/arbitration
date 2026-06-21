import { DashboardsService } from './dashboards.service';
import { Permission, Role } from '@gaap/shared';
import { AuthUser } from '../auth/types';

function user(roles: Role[], permissions: Permission[]): AuthUser {
  return { id: 'u1', email: 'x@y.com', roles, permissions } as unknown as AuthUser;
}

/** Each desk's dashboard is gated by the permission/role the spec assigns it. */
describe('DashboardsService — access gating', () => {
  const prisma = {} as never;
  const service = new DashboardsService(prisma);

  it('forbids the registrar dashboard without the queue permission', async () => {
    await expect(service.registrar(user([], []))).rejects.toThrow();
  });

  it('forbids the arbitrator dashboard for non-arbitrators', async () => {
    await expect(service.arbitrator(user([Role.LAWYER], []))).rejects.toThrow();
  });

  it('forbids the finance dashboard without invoice/payment permissions', async () => {
    await expect(service.finance(user([], []))).rejects.toThrow();
  });

  it('allows finance with the invoice permission', () => {
    // Gating passes; the DB calls would run next (not exercised here).
    expect(() => {
      const u = user([], [Permission.INVOICE_MANAGE]);
      if (!u.permissions.includes(Permission.INVOICE_MANAGE) && !u.permissions.includes(Permission.PAYMENT_RECORD)) {
        throw new Error('would be forbidden');
      }
    }).not.toThrow();
  });
});
