import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const get = vi.fn();
const post = vi.fn();
const patch = vi.fn();
const put = vi.fn();
const del = vi.fn();
vi.mock('../lib/api', () => ({
  api: {
    get: (...a: unknown[]) => get(...a),
    post: (...a: unknown[]) => post(...a),
    patch: (...a: unknown[]) => patch(...a),
    put: (...a: unknown[]) => put(...a),
    delete: (...a: unknown[]) => del(...a),
  },
}));

let perms: string[] = ['user:manage', 'role:manage'];
let roles: string[] = ['SUPER_ADMIN'];
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ user: { id: 'me', permissions: perms, roles } }) }));

import { AdminUsers } from '../pages/app/AdminUsers';

// One user per lifecycle case. `deletedAt` is deliberately decoupled from `status`
// to lock in the fix: lifecycle is driven by status, not deletedAt/verification.
const users = [
  { id: 'u1', email: 'active@x.test', displayName: 'Active User', firstName: 'A', lastName: 'U', status: 'ACTIVE', emailVerified: true, roles: ['INDIVIDUAL'], deletedAt: null },
  { id: 'u2', email: 'unverified@x.test', displayName: 'Unverified User', firstName: 'U', lastName: 'V', status: 'ACTIVE', emailVerified: false, roles: ['LAWYER'], deletedAt: null },
  { id: 'u3', email: 'suspended@x.test', displayName: 'Suspended User', firstName: 'S', lastName: 'P', status: 'SUSPENDED', emailVerified: true, roles: ['INDIVIDUAL'], deletedAt: null },
  { id: 'u4', email: 'deactivated@x.test', displayName: 'Deactivated User', firstName: 'D', lastName: 'A', status: 'DEACTIVATED', emailVerified: true, roles: ['INDIVIDUAL'], deletedAt: null },
  // Regression: ACTIVE status but a stray deletedAt — must NOT show Reactivate.
  { id: 'u5', email: 'active-stray@x.test', displayName: 'Stray Deleted', firstName: 'X', lastName: 'Y', status: 'ACTIVE', emailVerified: true, roles: ['INDIVIDUAL'], deletedAt: '2026-01-01T00:00:00Z' },
  // Genuinely soft-deleted: status DEACTIVATED + deletedAt — shows Reactivate.
  { id: 'u6', email: 'softdeleted@x.test', displayName: 'Soft Deleted', firstName: 'S', lastName: 'D', status: 'DEACTIVATED', emailVerified: true, roles: ['INDIVIDUAL'], deletedAt: '2026-01-01T00:00:00Z' },
];

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><AdminUsers /></QueryClientProvider>);
}

async function rowFor(email: string): Promise<HTMLElement> {
  const cell = await screen.findByText(email);
  const row = cell.closest('tr');
  if (!row) throw new Error(`no row for ${email}`);
  return row as HTMLElement;
}

beforeEach(() => {
  perms = ['user:manage', 'role:manage'];
  roles = ['SUPER_ADMIN'];
  get.mockReset(); post.mockReset(); patch.mockReset(); put.mockReset(); del.mockReset();
  get.mockResolvedValue({ data: { data: users, total: users.length } });
});

describe('AdminUsers — action state by lifecycle status', () => {
  it('blocks users without user-management permission', async () => {
    perms = [];
    renderPage();
    expect(await screen.findByText(/do not have user-management permission/i)).toBeInTheDocument();
  });

  it('an ACTIVE user shows Remove + status control and NOT Reactivate', async () => {
    renderPage();
    const row = await rowFor('active@x.test');
    expect(within(row).queryByText('Reactivate')).not.toBeInTheDocument();
    expect(within(row).getByText('Remove')).toBeInTheDocument();
    expect(within(row).getByLabelText(/set status for active@x.test/i)).toBeInTheDocument();
  });

  it('an ACTIVE but UNVERIFIED user shows the unverified badge but NOT Reactivate', async () => {
    renderPage();
    const row = await rowFor('unverified@x.test');
    // Exact match targets the badge span (text "unverified"), not the email substring.
    expect(within(row).getByText('unverified')).toBeInTheDocument();
    expect(within(row).queryByText('Reactivate')).not.toBeInTheDocument();
    expect(within(row).getByText('Remove')).toBeInTheDocument();
  });

  it('a SUSPENDED user shows Reactivate and NOT Remove / status select', async () => {
    renderPage();
    const row = await rowFor('suspended@x.test');
    expect(within(row).getByText('Reactivate')).toBeInTheDocument();
    expect(within(row).queryByText('Remove')).not.toBeInTheDocument();
    expect(within(row).queryByLabelText(/set status for/i)).not.toBeInTheDocument();
  });

  it('a DEACTIVATED user shows Reactivate', async () => {
    renderPage();
    const row = await rowFor('deactivated@x.test');
    expect(within(row).getByText('Reactivate')).toBeInTheDocument();
  });

  it('regression: ACTIVE status with a stray deletedAt does NOT show Reactivate', async () => {
    renderPage();
    const row = await rowFor('active-stray@x.test');
    expect(within(row).queryByText('Reactivate')).not.toBeInTheDocument();
    expect(within(row).getByText('Remove')).toBeInTheDocument();
  });

  it('a soft-deleted (DEACTIVATED + deletedAt) user shows Reactivate', async () => {
    renderPage();
    const row = await rowFor('softdeleted@x.test');
    expect(within(row).getByText('Reactivate')).toBeInTheDocument();
    expect(within(row).queryByText('Remove')).not.toBeInTheDocument();
  });

  it('renders role and status labels correctly', async () => {
    renderPage();
    const active = await rowFor('active@x.test');
    expect(within(active).getByText('Private Individual')).toBeInTheDocument();
    // Status badge lives in the 4th cell; the select options (5th cell) also
    // contain "ACTIVE", so assert against the status cell specifically.
    const statusCell = active.querySelectorAll('td')[3] as HTMLElement;
    expect(statusCell).toHaveTextContent('ACTIVE');
    const lawyer = await rowFor('unverified@x.test');
    expect(within(lawyer).getByText('Lawyer')).toBeInTheDocument();
    const suspended = await rowFor('suspended@x.test');
    // Inactive rows have no status select, so the badge is unambiguous.
    expect(within(suspended).getByText('SUSPENDED')).toBeInTheDocument();
  });
});
