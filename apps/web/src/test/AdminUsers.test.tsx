import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
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
  // Legacy individual with no case → "pending case-role assignment" (not "Private Individual").
  { id: 'u1', email: 'active@x.test', displayName: 'Active User', firstName: 'A', lastName: 'U', status: 'ACTIVE', emailVerified: true, roles: ['INDIVIDUAL'], identityType: 'INDIVIDUAL', caseRoles: [], deletedAt: null },
  { id: 'u2', email: 'unverified@x.test', displayName: 'Unverified User', firstName: 'U', lastName: 'V', status: 'ACTIVE', emailVerified: false, roles: ['LAWYER'], identityType: 'LAW_FIRM', caseRoles: [], deletedAt: null },
  // Case-linked individual → "Individual Claimant".
  { id: 'u3', email: 'suspended@x.test', displayName: 'Suspended User', firstName: 'S', lastName: 'P', status: 'SUSPENDED', emailVerified: true, roles: ['INDIVIDUAL'], identityType: 'INDIVIDUAL', caseRoles: ['CLAIMANT'], deletedAt: null },
  // Company linked as respondent → "Company Respondent".
  { id: 'u4', email: 'deactivated@x.test', displayName: 'Deactivated User', firstName: 'D', lastName: 'A', status: 'DEACTIVATED', emailVerified: true, roles: ['COMPANY_CLIENT'], identityType: 'COMPANY', caseRoles: ['RESPONDENT'], deletedAt: null },
  // Regression: ACTIVE status but a stray deletedAt — must NOT show Reactivate.
  { id: 'u5', email: 'active-stray@x.test', displayName: 'Stray Deleted', firstName: 'X', lastName: 'Y', status: 'ACTIVE', emailVerified: true, roles: ['INDIVIDUAL'], identityType: 'INDIVIDUAL', caseRoles: [], deletedAt: '2026-01-01T00:00:00Z' },
  // Genuinely soft-deleted: status DEACTIVATED + deletedAt — shows Reactivate.
  { id: 'u6', email: 'softdeleted@x.test', displayName: 'Soft Deleted', firstName: 'S', lastName: 'D', status: 'DEACTIVATED', emailVerified: true, roles: ['INDIVIDUAL'], identityType: 'INDIVIDUAL', caseRoles: [], deletedAt: '2026-01-01T00:00:00Z' },
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

  it('renders identity and status labels correctly (no "Private Individual")', async () => {
    renderPage();
    const active = await rowFor('active@x.test');
    // Identity cell (index 2); "Individual" also appears as a <select> option, so
    // assert against the cell's text rather than a unique element.
    expect(active.querySelectorAll('td')[2]).toHaveTextContent('Individual');
    // Status badge is now in the 5th cell (Email, Name, Identity, Case role(s), Status).
    const statusCell = active.querySelectorAll('td')[4] as HTMLElement;
    expect(statusCell).toHaveTextContent('ACTIVE');
    const lawyer = await rowFor('unverified@x.test');
    expect(lawyer.querySelectorAll('td')[2]).toHaveTextContent('Law firm / Representative');
    const suspended = await rowFor('suspended@x.test');
    expect(within(suspended).getByText('SUSPENDED')).toBeInTheDocument();
  });
});

describe('AdminUsers — arbitration classification (no generic Private Individual)', () => {
  it('never shows "Private Individual" anywhere in the list', async () => {
    renderPage();
    await screen.findByText('active@x.test');
    expect(screen.queryByText('Private Individual')).not.toBeInTheDocument();
  });

  it('shows a legacy individual with no case as a pending party account', async () => {
    renderPage();
    const row = await rowFor('active@x.test');
    expect(within(row).getByText('Party account — pending case-role assignment')).toBeInTheDocument();
  });

  it('shows a case-linked individual as "Individual Claimant"', async () => {
    renderPage();
    const row = await rowFor('suspended@x.test');
    expect(within(row).getByText('Individual Claimant')).toBeInTheDocument();
  });

  it('shows a company respondent as "Company Respondent"', async () => {
    renderPage();
    const row = await rowFor('deactivated@x.test');
    expect(within(row).getByText('Company Respondent')).toBeInTheDocument();
  });

  it('lets a Super Admin change a user identity type via PATCH /identity', async () => {
    patch.mockResolvedValue({ data: {} });
    renderPage();
    const row = await rowFor('active@x.test');
    fireEvent.change(within(row).getByLabelText('Identity for active@x.test'), { target: { value: 'COMPANY' } });
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/admin/users/u1/identity', { identityType: 'COMPANY' }));
  });

  it('does not offer the identity editor to a non-role-manager', async () => {
    perms = ['user:manage']; // can view/manage users but not roles/identity
    renderPage();
    await screen.findByText('active@x.test');
    expect(screen.queryByLabelText('Identity for active@x.test')).not.toBeInTheDocument();
  });
});

describe('AdminUsers — editing the login email', () => {
  it('lets a Super Admin change a user email (with confirmation) and PATCHes it', async () => {
    patch.mockResolvedValue({ data: {} });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPage();
    const row = await rowFor('active@x.test');
    fireEvent.click(within(row).getByRole('button', { name: 'Edit' }));
    fireEvent.change(within(row).getByDisplayValue('active@x.test'), { target: { value: 'newmail@x.test' } });
    fireEvent.click(within(row).getByRole('button', { name: 'Save' }));
    expect(confirmSpy).toHaveBeenCalled();
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/admin/users/u1', expect.objectContaining({ email: 'newmail@x.test' })));
    confirmSpy.mockRestore();
  });

  it('does not PATCH when the email-change confirmation is declined', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderPage();
    const row = await rowFor('active@x.test');
    fireEvent.click(within(row).getByRole('button', { name: 'Edit' }));
    fireEvent.change(within(row).getByDisplayValue('active@x.test'), { target: { value: 'declined@x.test' } });
    fireEvent.click(within(row).getByRole('button', { name: 'Save' }));
    expect(confirmSpy).toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });
});

describe('AdminUsers — edit/save UX', () => {
  // A mutable store so the post-save refetch reflects the saved values.
  function renderWithStore() {
    const store = users.map((u) => ({ ...u }));
    get.mockImplementation(() => Promise.resolve({ data: { data: store, total: store.length } }));
    patch.mockImplementation((url: string, body: { email?: string }) => {
      const m = /\/admin\/users\/([^/]+)$/.exec(url);
      if (m && body?.email) { const row = store.find((r) => r.id === m[1]); if (row) row.email = body.email.toLowerCase(); }
      return Promise.resolve({ data: {} });
    });
    return renderPage();
  }

  it('closes edit mode, shows the saved email, and surfaces a success message on save', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderWithStore();
    const row = await rowFor('active@x.test');
    fireEvent.click(within(row).getByRole('button', { name: 'Edit' }));
    fireEvent.change(within(row).getByDisplayValue('active@x.test'), { target: { value: 'updated@x.test' } });
    fireEvent.click(within(row).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/admin/users/u1', expect.objectContaining({ email: 'updated@x.test' })));
    // Edit mode closed → Save/Cancel gone, updated email + success message shown.
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
    expect(await screen.findByText('updated@x.test')).toBeInTheDocument();
    expect(screen.getByText('User updated')).toBeInTheDocument();
    confirmSpy.mockRestore();
  });

  it('keeps edit mode open, shows the error, and preserves input when save fails', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    patch.mockRejectedValue({ response: { data: { message: 'A user with that email already exists.' } } });
    renderPage();
    const row = await rowFor('active@x.test');
    fireEvent.click(within(row).getByRole('button', { name: 'Edit' }));
    fireEvent.change(within(row).getByDisplayValue('active@x.test'), { target: { value: 'dupe@x.test' } });
    fireEvent.click(within(row).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/already exists/i)).toBeInTheDocument();
    // Still editing: Save/Cancel remain and the unsaved input is preserved.
    expect(within(row).getByRole('button', { name: 'Save' })).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(within(row).getByDisplayValue('dupe@x.test')).toBeInTheDocument();
    confirmSpy.mockRestore();
  });

  it('Cancel exits edit mode and restores the original values', async () => {
    renderPage();
    const row = await rowFor('active@x.test');
    fireEvent.click(within(row).getByRole('button', { name: 'Edit' }));
    fireEvent.change(within(row).getByDisplayValue('active@x.test'), { target: { value: 'temp@x.test' } });
    fireEvent.click(within(row).getByRole('button', { name: 'Cancel' }));
    expect(within(row).queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    expect(within(row).getByText('active@x.test')).toBeInTheDocument();
    expect(patch).not.toHaveBeenCalled();
    // Reopening shows the original value, not the discarded edit.
    fireEvent.click(within(row).getByRole('button', { name: 'Edit' }));
    expect(within(row).getByDisplayValue('active@x.test')).toBeInTheDocument();
  });

  it('disables Save (showing "Saving…") while the request is pending', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    let resolvePatch!: (v: unknown) => void;
    patch.mockReturnValue(new Promise((r) => { resolvePatch = r; }));
    renderPage();
    const row = await rowFor('active@x.test');
    fireEvent.click(within(row).getByRole('button', { name: 'Edit' }));
    fireEvent.change(within(row).getByDisplayValue('active@x.test'), { target: { value: 'pending@x.test' } });
    fireEvent.click(within(row).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(within(row).getByRole('button', { name: 'Saving…' })).toBeDisabled());
    resolvePatch({ data: {} });
    confirmSpy.mockRestore();
  });
});
