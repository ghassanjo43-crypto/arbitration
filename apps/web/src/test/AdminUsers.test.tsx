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
  // Unlinked active account → "Delete permanently" available.
  { id: 'u1', email: 'active@x.test', displayName: 'Active User', firstName: 'A', lastName: 'U', status: 'ACTIVE', emailVerified: true, roles: ['INDIVIDUAL'], identityType: 'INDIVIDUAL', caseRoles: [], linkedRecordCount: 0, deletedAt: null },
  // Linked active account → "Archive" (no permanent delete).
  { id: 'u2', email: 'unverified@x.test', displayName: 'Unverified User', firstName: 'U', lastName: 'V', status: 'ACTIVE', emailVerified: false, roles: ['LAWYER'], identityType: 'LAW_FIRM', caseRoles: [], linkedRecordCount: 4, deletedAt: null },
  // Case-linked individual → "Individual Claimant".
  { id: 'u3', email: 'suspended@x.test', displayName: 'Suspended User', firstName: 'S', lastName: 'P', status: 'SUSPENDED', emailVerified: true, roles: ['INDIVIDUAL'], identityType: 'INDIVIDUAL', caseRoles: ['CLAIMANT'], linkedRecordCount: 3, deletedAt: null },
  // Company linked as respondent → "Company Respondent".
  { id: 'u4', email: 'deactivated@x.test', displayName: 'Deactivated User', firstName: 'D', lastName: 'A', status: 'DEACTIVATED', emailVerified: true, roles: ['COMPANY_CLIENT'], identityType: 'COMPANY', caseRoles: ['RESPONDENT'], linkedRecordCount: 5, deletedAt: null },
  // Regression: ACTIVE status but a stray deletedAt — must NOT show Reactivate. Unlinked.
  { id: 'u5', email: 'active-stray@x.test', displayName: 'Stray Deleted', firstName: 'X', lastName: 'Y', status: 'ACTIVE', emailVerified: true, roles: ['INDIVIDUAL'], identityType: 'INDIVIDUAL', caseRoles: [], linkedRecordCount: 0, deletedAt: '2026-01-01T00:00:00Z' },
  // Genuinely soft-deleted, linked: status DEACTIVATED + deletedAt — shows Reactivate only.
  { id: 'u6', email: 'softdeleted@x.test', displayName: 'Soft Deleted', firstName: 'S', lastName: 'D', status: 'DEACTIVATED', emailVerified: true, roles: ['INDIVIDUAL'], identityType: 'INDIVIDUAL', caseRoles: [], linkedRecordCount: 2, deletedAt: '2026-01-01T00:00:00Z' },
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

  it('an ACTIVE unlinked user shows Delete permanently + status control and NOT Reactivate', async () => {
    renderPage();
    const row = await rowFor('active@x.test');
    expect(within(row).queryByText('Reactivate')).not.toBeInTheDocument();
    expect(within(row).getByText('Delete permanently')).toBeInTheDocument();
    expect(within(row).getByLabelText(/set status for active@x.test/i)).toBeInTheDocument();
  });

  it('an ACTIVE LINKED user shows Archive (never permanent delete)', async () => {
    renderPage();
    const row = await rowFor('unverified@x.test');
    expect(within(row).getByText('unverified')).toBeInTheDocument();
    expect(within(row).getByText('Archive')).toBeInTheDocument();
    expect(within(row).queryByText('Delete permanently')).not.toBeInTheDocument();
    expect(within(row).queryByText('Reactivate')).not.toBeInTheDocument();
  });

  it('a SUSPENDED linked user shows Reactivate and NOT delete/archive / status select', async () => {
    renderPage();
    const row = await rowFor('suspended@x.test');
    expect(within(row).getByText('Reactivate')).toBeInTheDocument();
    expect(within(row).queryByText('Delete permanently')).not.toBeInTheDocument();
    expect(within(row).queryByText('Archive')).not.toBeInTheDocument();
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
    expect(within(row).getByText('Delete permanently')).toBeInTheDocument(); // unlinked
  });

  it('a soft-deleted (DEACTIVATED + deletedAt) linked user shows Reactivate only', async () => {
    renderPage();
    const row = await rowFor('softdeleted@x.test');
    expect(within(row).getByText('Reactivate')).toBeInTheDocument();
    expect(within(row).queryByText('Delete permanently')).not.toBeInTheDocument();
  });

  it('renders identity and status labels correctly (no "Private Individual")', async () => {
    renderPage();
    const active = await rowFor('active@x.test');
    // Identity cell (index 2); "Individual" also appears as a <select> option, so
    // assert against the cell's text rather than a unique element.
    expect(active.querySelectorAll('td')[2]).toHaveTextContent('Individual');
    // Columns: Email, Name, Identity, Case role(s), Linked records, Status, Actions.
    const statusCell = active.querySelectorAll('td')[5] as HTMLElement;
    expect(statusCell).toHaveTextContent('ACTIVE');
    const lawyer = await rowFor('unverified@x.test');
    expect(lawyer.querySelectorAll('td')[2]).toHaveTextContent('Law firm / Representative');
    const suspended = await rowFor('suspended@x.test');
    expect(within(suspended).getByText('SUSPENDED')).toBeInTheDocument();
  });
});

describe('AdminUsers — delete-eligibility clarity', () => {
  it('shows a "Delete eligible" badge for an unlinked user and "Linked — archive only (N)" for a linked one', async () => {
    renderPage();
    const eligible = await rowFor('active@x.test');
    expect(within(eligible).getByText('Delete eligible')).toBeInTheDocument();
    const linked = await rowFor('unverified@x.test');
    expect(within(linked).getByText(/Linked — archive only \(4\)/)).toBeInTheDocument();
  });

  it('shows the helper text about permanent delete vs archive', async () => {
    renderPage();
    expect(await screen.findByText(/Permanent delete is available only for unused accounts/i)).toBeInTheDocument();
  });

  it('filters to delete-eligible users only', async () => {
    renderPage();
    await screen.findByText('active@x.test');
    fireEvent.change(screen.getByLabelText('Filter users'), { target: { value: 'eligible' } });
    // u1 + u5 are unlinked & not archived; u5 has a stray deletedAt so excluded by archived check? No: eligible = count 0 AND !deletedAt → u5 has deletedAt → excluded. Only u1.
    expect(screen.getByText('active@x.test')).toBeInTheDocument();
    expect(screen.queryByText('unverified@x.test')).not.toBeInTheDocument(); // linked
    expect(screen.queryByText('suspended@x.test')).not.toBeInTheDocument(); // linked
  });

  it('filters to linked users only', async () => {
    renderPage();
    await screen.findByText('active@x.test');
    fireEvent.change(screen.getByLabelText('Filter users'), { target: { value: 'linked' } });
    expect(screen.getByText('unverified@x.test')).toBeInTheDocument();
    expect(screen.queryByText('active@x.test')).not.toBeInTheDocument(); // unlinked
  });

  it('shows the blocker breakdown on demand via delete-check', async () => {
    get.mockImplementation((url: string) => {
      if (url.includes('/delete-check')) return Promise.resolve({ data: { id: 'u2', blockers: { 'Cases filed': 2, 'Audit logs': 15 } } });
      return Promise.resolve({ data: { data: users, total: users.length } });
    });
    renderPage();
    const linked = await rowFor('unverified@x.test');
    fireEvent.click(within(linked).getByRole('button', { name: 'Why?' }));
    await waitFor(() => expect(get).toHaveBeenCalledWith('/admin/users/u2/delete-check'));
    expect(await within(linked).findByText('Audit logs: 15')).toBeInTheDocument();
    expect(within(linked).getByText('Cases filed: 2')).toBeInTheDocument();
  });
});

describe('AdminUsers — account-notification emails', () => {
  it('resends the enrollment email and shows delivery status', async () => {
    get.mockImplementation((url: string) => {
      if (url.includes('/email-deliveries')) return Promise.resolve({ data: [{ id: 'd1', subject: 'You have been enrolled on the Arbitration Panel', templateKey: 'user.enrollment', status: 'SENT', failureKind: null, errorDetail: null, sentAt: null, createdAt: '2026-06-27T10:00:00Z' }] });
      return Promise.resolve({ data: { data: users, total: users.length } });
    });
    post.mockResolvedValue({ data: { sent: true } });
    renderPage();
    const row = await rowFor('active@x.test');
    fireEvent.click(within(row).getByRole('button', { name: 'Emails' }));
    // Delivery status appears.
    expect(await within(row).findByText('SENT')).toBeInTheDocument();
    // Resend enrollment.
    fireEvent.click(within(row).getByRole('button', { name: 'Send enrollment email' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/admin/users/u1/send-enrollment', {}));
  });

  it('lets Super Admin mark an unverified user email as verified', async () => {
    get.mockImplementation((url: string) => url.includes('/email-deliveries') ? Promise.resolve({ data: [] }) : Promise.resolve({ data: { data: users, total: users.length } }));
    patch.mockResolvedValue({ data: {} });
    renderPage();
    const row = await rowFor('unverified@x.test'); // u2 is emailVerified:false
    fireEvent.click(within(row).getByRole('button', { name: 'Emails' }));
    fireEvent.click(await within(row).findByRole('button', { name: 'Mark email verified' }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/admin/users/u2', { emailVerified: true }));
  });

  it('removes (dismisses) a user-account email delivery row with confirmation', async () => {
    const store = [{ id: 'd1', subject: 'You have been enrolled on the Arbitration Panel', templateKey: 'user.enrollment', status: 'SENT', failureKind: null, errorDetail: null, sentAt: null, createdAt: '2026-06-28T10:00:00Z' }];
    get.mockImplementation((url: string) => {
      if (url.includes('/email-deliveries')) return Promise.resolve({ data: store });
      return Promise.resolve({ data: { data: users, total: users.length } });
    });
    del.mockImplementation((url: string) => { const m = /email-deliveries\/(\w+)$/.exec(url); if (m) store.length = 0; return Promise.resolve({ data: { dismissed: true } }); });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPage();
    const row = await rowFor('active@x.test');
    fireEvent.click(within(row).getByRole('button', { name: 'Emails' }));
    fireEvent.click(await within(row).findByRole('button', { name: /Remove delivery record/i }));
    await waitFor(() => expect(del).toHaveBeenCalledWith('/admin/users/u1/email-deliveries/d1'));
    // After refresh the row is gone.
    expect(await within(row).findByText(/No emails recorded/i)).toBeInTheDocument();
    confirmSpy.mockRestore();
  });

  it('shows the evidence-protection error when a case-service delivery cannot be deleted', async () => {
    get.mockImplementation((url: string) => {
      if (url.includes('/email-deliveries')) return Promise.resolve({ data: [{ id: 'd9', subject: 'Notice of Arbitration', templateKey: null, status: 'DELIVERED', failureKind: null, errorDetail: null, sentAt: null, createdAt: '2026-06-28T10:00:00Z' }] });
      return Promise.resolve({ data: { data: users, total: users.length } });
    });
    del.mockRejectedValue({ response: { data: { message: 'This delivery record is part of case service evidence and cannot be deleted.' } } });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPage();
    const row = await rowFor('active@x.test');
    fireEvent.click(within(row).getByRole('button', { name: 'Emails' }));
    fireEvent.click(await within(row).findByRole('button', { name: /Remove delivery record/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/part of case service evidence and cannot be deleted/i);
    confirmSpy.mockRestore();
  });

  it('can send a password-setup email', async () => {
    get.mockImplementation((url: string) => {
      if (url.includes('/email-deliveries')) return Promise.resolve({ data: [] });
      return Promise.resolve({ data: { data: users, total: users.length } });
    });
    post.mockResolvedValue({ data: { sent: true } });
    renderPage();
    const row = await rowFor('active@x.test');
    fireEvent.click(within(row).getByRole('button', { name: 'Emails' }));
    fireEvent.click(await within(row).findByRole('button', { name: 'Send password setup email' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/admin/users/u1/send-password-setup', {}));
  });
});

describe('AdminUsers — deletion vs. archive', () => {
  it('permanently deletes an UNLINKED user via DELETE', async () => {
    del.mockResolvedValue({ data: { deleted: true } });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPage();
    const row = await rowFor('active@x.test');
    fireEvent.click(within(row).getByText('Delete permanently'));
    await waitFor(() => expect(del).toHaveBeenCalledWith('/admin/users/u1'));
    confirmSpy.mockRestore();
  });

  it('archives a LINKED user via POST /archive (no DELETE)', async () => {
    post.mockResolvedValue({ data: { archived: true } });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPage();
    const row = await rowFor('unverified@x.test');
    fireEvent.click(within(row).getByText('Archive'));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/admin/users/u2/archive', {}));
    expect(del).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('shows the server error (with blocking records) when a permanent delete is blocked', async () => {
    del.mockRejectedValue({ response: { data: { message: 'This user cannot be deleted because the account is linked to platform records (Audit logs: 15). You may deactivate/archive the user instead.' } } });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPage();
    const row = await rowFor('active@x.test');
    fireEvent.click(within(row).getByText('Delete permanently'));
    expect(await screen.findByRole('alert')).toHaveTextContent(/linked to platform records \(Audit logs: 15\)/i);
    confirmSpy.mockRestore();
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
  // A mutable store so a refetch after save reflects the saved values — and NO
  // window.confirm: the save must not depend on a native dialog (which a browser
  // can suppress, silently blocking the save and leaving the row stuck open).
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

  it('PATCHes the new email without requiring a native confirm dialog', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm');
    renderWithStore();
    const row = await rowFor('active@x.test');
    fireEvent.click(within(row).getByRole('button', { name: 'Edit' }));
    fireEvent.change(within(row).getByDisplayValue('active@x.test'), { target: { value: 'newmail@x.test' } });
    fireEvent.click(within(row).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/admin/users/u1', expect.objectContaining({ email: 'newmail@x.test' })));
    expect(confirmSpy).not.toHaveBeenCalled(); // no blocking dialog
    confirmSpy.mockRestore();
  });

  it('shows an inline login-address warning once the email is changed', async () => {
    renderPage();
    const row = await rowFor('active@x.test');
    fireEvent.click(within(row).getByRole('button', { name: 'Edit' }));
    expect(within(row).queryByText(/changes the user’s login address/i)).not.toBeInTheDocument();
    fireEvent.change(within(row).getByDisplayValue('active@x.test'), { target: { value: 'changed@x.test' } });
    expect(within(row).getByText(/changes the user’s login address/i)).toBeInTheDocument();
  });

  // Reproduces the exact live scenario from the bug report.
  it('regression: after a successful email save, no Save/Cancel remain and the new email shows', async () => {
    renderWithStore();
    const row = await rowFor('active@x.test');
    fireEvent.click(within(row).getByRole('button', { name: 'Edit' }));
    fireEvent.change(within(row).getByDisplayValue('active@x.test'), { target: { value: 'brand-new@x.test' } });
    fireEvent.click(within(row).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/admin/users/u1', expect.objectContaining({ email: 'brand-new@x.test' })));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
    expect(await screen.findByText('brand-new@x.test')).toBeInTheDocument();
    expect(screen.getByText('User updated')).toBeInTheDocument();
  });

  it('hard regression: Save fires the PATCH, shows Saving…, then closes with the new email + "User updated"', async () => {
    const store = users.map((u) => ({ ...u }));
    get.mockImplementation(() => Promise.resolve({ data: { data: store, total: store.length } }));
    let resolvePatch!: () => void;
    patch.mockImplementation((url: string, body: { email?: string }) => {
      const m = /\/admin\/users\/([^/]+)$/.exec(url);
      if (m && body?.email) { const r = store.find((x) => x.id === m[1]); if (r) r.email = body.email.toLowerCase(); }
      return new Promise((res) => { resolvePatch = () => res({ data: {} }); });
    });
    renderPage();
    const row = await rowFor('active@x.test');
    fireEvent.click(within(row).getByRole('button', { name: 'Edit' }));
    fireEvent.change(within(row).getByDisplayValue('active@x.test'), { target: { value: 'hard-new@x.test' } });
    fireEvent.click(within(row).getByRole('button', { name: 'Save' }));
    // PATCH fired with the NEW email, and the button immediately shows Saving… (disabled).
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/admin/users/u1', expect.objectContaining({ email: 'hard-new@x.test' })));
    expect(within(row).getByRole('button', { name: 'Saving…' })).toBeDisabled();
    resolvePatch();
    // After resolution: edit mode closed, new email shown, success message.
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Saving…' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
    expect(await screen.findByText('hard-new@x.test')).toBeInTheDocument();
    expect(screen.getByText('User updated')).toBeInTheDocument();
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
    // Error surfaced in the alert (scope to role: the temporary debug line also echoes it).
    expect(await screen.findByRole('alert')).toHaveTextContent(/already exists/i);
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

describe('AdminUsers — active-row highlight', () => {
  it('highlights the user row while the Emails panel is open and clears it on close', async () => {
    get.mockImplementation((url: string) =>
      url.includes('/email-deliveries')
        ? Promise.resolve({ data: [] })
        : Promise.resolve({ data: { data: users, total: users.length } }));
    renderPage();
    const row = await rowFor('active@x.test');
    expect(row).not.toHaveClass('is-active-row');
    fireEvent.click(within(row).getByRole('button', { name: 'Emails' }));
    expect(row).toHaveClass('is-active-row');
    expect(within(row).getByText('Working on this user')).toBeInTheDocument();
    fireEvent.click(within(row).getByRole('button', { name: 'Hide emails' }));
    expect(row).not.toHaveClass('is-active-row');
    expect(within(row).queryByText('Working on this user')).not.toBeInTheDocument();
  });

  it('highlights the user row while the System roles editor is open and clears it on Cancel', async () => {
    renderPage();
    const row = await rowFor('active@x.test');
    expect(row).not.toHaveClass('is-active-row');
    fireEvent.click(within(row).getByRole('button', { name: 'System roles' }));
    expect(row).toHaveClass('is-active-row');
    fireEvent.click(within(row).getByRole('button', { name: 'Cancel' }));
    expect(row).not.toHaveClass('is-active-row');
  });

  it('highlights the user row while Edit mode is open and clears it on Cancel', async () => {
    renderPage();
    const row = await rowFor('active@x.test');
    expect(row).not.toHaveClass('is-active-row');
    fireEvent.click(within(row).getByRole('button', { name: 'Edit' }));
    expect(row).toHaveClass('is-active-row');
    expect(within(row).getByText('Working on this user')).toBeInTheDocument();
    fireEvent.click(within(row).getByRole('button', { name: 'Cancel' }));
    expect(row).not.toHaveClass('is-active-row');
  });

  it('highlights only the user whose panel is open, not other rows', async () => {
    renderPage();
    const row1 = await rowFor('active@x.test');
    const row2 = await rowFor('suspended@x.test');
    fireEvent.click(within(row1).getByRole('button', { name: 'System roles' }));
    expect(row1).toHaveClass('is-active-row');
    expect(row2).not.toHaveClass('is-active-row');
  });
});

describe('AdminUsers — editing the user name', () => {
  // Mutable store whose PATCH mock recomputes displayName the way the API does,
  // so the post-save refetch reflects the new name (proving it does not revert).
  function renderWithStore() {
    const store = users.map((u) => ({ ...u }));
    get.mockImplementation((url: string) =>
      url.includes('/email-deliveries') ? Promise.resolve({ data: [] }) : Promise.resolve({ data: { data: store, total: store.length } }));
    patch.mockImplementation((url: string, body: { firstName?: string; lastName?: string }) => {
      const m = /\/admin\/users\/([^/]+)$/.exec(url);
      if (m) {
        const row = store.find((r) => r.id === m[1]);
        if (row) {
          if (body.firstName !== undefined) row.firstName = body.firstName;
          if (body.lastName !== undefined) row.lastName = body.lastName;
          row.displayName = `${row.firstName ?? ''} ${row.lastName ?? ''}`.trim() || row.displayName;
        }
      }
      return Promise.resolve({ data: {} });
    });
    return renderPage();
  }

  it('saves first/last name, sends the fields to the API, and shows the new name immediately', async () => {
    renderWithStore();
    const row = await rowFor('active@x.test');
    expect(within(row).getByText('Active User')).toBeInTheDocument();
    fireEvent.click(within(row).getByRole('button', { name: 'Edit' }));
    fireEvent.change(within(row).getByPlaceholderText('First'), { target: { value: 'Jane' } });
    fireEvent.change(within(row).getByPlaceholderText('Last'), { target: { value: 'Doe' } });
    fireEvent.click(within(row).getByRole('button', { name: 'Save' }));
    // API received the changed name fields.
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/admin/users/u1', expect.objectContaining({ firstName: 'Jane', lastName: 'Doe' })));
    // Edit mode closes; the updated name is shown; success message appears.
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument());
    expect(await within(row).findByText('Jane Doe')).toBeInTheDocument();
    expect(screen.getByText('User updated')).toBeInTheDocument();
  });

  it('keeps the new name after the post-save refetch (does not revert)', async () => {
    renderWithStore();
    const row = await rowFor('active@x.test');
    fireEvent.click(within(row).getByRole('button', { name: 'Edit' }));
    fireEvent.change(within(row).getByPlaceholderText('First'), { target: { value: 'Jane' } });
    fireEvent.change(within(row).getByPlaceholderText('Last'), { target: { value: 'Doe' } });
    fireEvent.click(within(row).getByRole('button', { name: 'Save' }));
    expect(await within(row).findByText('Jane Doe')).toBeInTheDocument();
    // The invalidation refetch (store now carries 'Jane Doe') must not undo it.
    await waitFor(() => expect(within(row).getByText('Jane Doe')).toBeInTheDocument());
    expect(within(row).queryByText('Active User')).not.toBeInTheDocument();
  });

  it('on a failed save keeps edit mode open, shows the error, and preserves typed names', async () => {
    patch.mockRejectedValue({ response: { data: { message: 'Name update failed.' } } });
    renderPage();
    const row = await rowFor('active@x.test');
    fireEvent.click(within(row).getByRole('button', { name: 'Edit' }));
    fireEvent.change(within(row).getByPlaceholderText('First'), { target: { value: 'Jane' } });
    fireEvent.change(within(row).getByPlaceholderText('Last'), { target: { value: 'Doe' } });
    fireEvent.click(within(row).getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Name update failed/i);
    expect(within(row).getByRole('button', { name: 'Save' })).toBeInTheDocument();
    expect(within(row).getByDisplayValue('Jane')).toBeInTheDocument();
    expect(within(row).getByDisplayValue('Doe')).toBeInTheDocument();
  });

  it('a user without user-management permission cannot edit names (no table, no Edit)', async () => {
    perms = [];
    renderPage();
    expect(await screen.findByText(/do not have user-management permission/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
  });
});
