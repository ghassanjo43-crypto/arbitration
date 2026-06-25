import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const get = vi.fn();
const post = vi.fn();
vi.mock('../lib/api', () => ({ api: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a) } }));

let perms: string[] = ['settings:manage'];
let roles: string[] = ['SUPER_ADMIN'];
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ user: { permissions: perms, roles } }) }));

import { AdminRetention } from '../pages/app/AdminRetention';

const policy = {
  CASE_RECORD: { days: 3650, behavior: 'SOFT_DELETE', description: 'Closed case file.' },
  AWARD: { days: 0, behavior: 'RETAIN_FOREVER', description: 'Awards retained indefinitely.' },
};
const holds = [{ id: 'h1', caseId: 'case-123', reason: 'enforcement pending', status: 'ACTIVE', placedAt: '2026-06-01', releasedAt: null }];
const dryRun = { runId: 'run-abcdef12', generatedAt: '2026-06-20T10:00:00Z', reports: [
  { category: 'CASE_RECORD', behavior: 'SOFT_DELETE', retentionDays: 3650, eligible: 2, blockedByLegalHold: 1, note: 'Closed cases past period.' },
  { category: 'AWARD', behavior: 'RETAIN_FOREVER', retentionDays: 0, eligible: 0, blockedByLegalHold: 0, note: 'Retained indefinitely.' },
] };
// A draft awaiting review — used by the council-review tests.
let draftState: unknown = null;

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><AdminRetention /></QueryClientProvider>);
}

beforeEach(() => {
  perms = ['settings:manage']; roles = ['SUPER_ADMIN']; draftState = null;
  get.mockReset(); post.mockReset();
  get.mockImplementation((url: string) => {
    if (url.includes('/policy/draft')) return Promise.resolve({ data: { draft: draftState } });
    if (url.includes('/policy')) return Promise.resolve({ data: policy });
    if (url.includes('/legal-holds')) return Promise.resolve({ data: holds });
    return Promise.resolve({ data: {} });
  });
  post.mockImplementation((url: string) => {
    if (url.includes('/dry-run')) return Promise.resolve({ data: dryRun });
    if (url.includes('/execute')) return Promise.resolve({ data: { summary: [{ category: 'CASE_RECORD', softDeleted: 2 }] } });
    return Promise.resolve({ data: {} });
  });
});

describe('AdminRetention — governance & role control', () => {
  it('blocks users without any retention permission', async () => {
    perms = []; roles = [];
    renderPage();
    expect(await screen.findByText(/do not have permission to view retention settings/i)).toBeInTheDocument();
  });

  it('shows the required explanation box and safe-by-design disclaimer', async () => {
    renderPage();
    expect(await screen.findByText(/Only Super Admin users may edit retention settings/i)).toBeInTheDocument();
    expect(screen.getByText(/Legal holds override deletion rules/i)).toBeInTheDocument();
    expect(screen.getByText(/safe by design/i)).toBeInTheDocument();
    expect(await screen.findByText(/Retain Forever/i)).toBeInTheDocument();
  });

  it('shows the Edit-policy control to a Super Admin', async () => {
    renderPage();
    expect(await screen.findByText('Edit policy')).toBeInTheDocument();
  });

  it('hides the Edit-policy control from a Council reviewer (read/approve only)', async () => {
    perms = ['policy:manage']; roles = ['COUNCIL_MEMBER'];
    renderPage();
    // Council can view the policy but not edit it.
    expect(await screen.findByText(/Retention policy/i)).toBeInTheDocument();
    expect(screen.queryByText('Edit policy')).not.toBeInTheDocument();
    // No sweep controls for a non-super-admin either.
    expect(screen.queryByText('Run dry run')).not.toBeInTheDocument();
  });

  it('lets a Council reviewer approve a pending draft', async () => {
    perms = ['policy:manage']; roles = ['COUNCIL_MEMBER'];
    draftState = { overrides: { CASE_RECORD: { days: 100 } }, status: 'PENDING_REVIEW', proposedByEmail: 'sa@x.com', proposedAt: '2026-06-20T10:00:00Z' };
    renderPage();
    const approve = await screen.findByText('Approve');
    fireEvent.click(approve);
    await waitFor(() => expect(post).toHaveBeenCalledWith('/admin/retention/policy/review', expect.objectContaining({ decision: 'APPROVE' })));
  });

  it('lets a Super Admin activate an approved draft', async () => {
    draftState = { overrides: { CASE_RECORD: { days: 100 } }, status: 'APPROVED', proposedByEmail: 'sa@x.com', proposedAt: '2026-06-20T10:00:00Z', reviewedByEmail: 'council@x.com', reviewDecision: 'APPROVE' };
    renderPage();
    fireEvent.click(await screen.findByText('Activate policy'));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/admin/retention/policy/activate', {}));
  });

  it('runs a dry run that reports eligible + legal-hold-blocked counts without deleting', async () => {
    renderPage();
    fireEvent.click(await screen.findByText('Run dry run'));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/admin/retention/sweep/dry-run', {}));
    expect(await screen.findByText(/nothing was deleted/i)).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument(); // CASE_RECORD eligible
    expect(screen.getByText('1')).toBeInTheDocument(); // blocked by legal hold
  });

  it('requires explicit confirmation to execute a sweep', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPage();
    fireEvent.click(await screen.findByText('Run dry run'));
    await screen.findByText(/nothing was deleted/i);
    fireEvent.click(screen.getByText(/Execute sweep/i));
    expect(confirmSpy).toHaveBeenCalled();
    await waitFor(() => expect(post).toHaveBeenCalledWith('/admin/retention/sweep/execute', { confirm: true, categories: ['CASE_RECORD'] }));
    confirmSpy.mockRestore();
  });

  it('does not execute the sweep when confirmation is declined', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderPage();
    fireEvent.click(await screen.findByText('Run dry run'));
    await screen.findByText(/nothing was deleted/i);
    fireEvent.click(screen.getByText(/Execute sweep/i));
    expect(confirmSpy).toHaveBeenCalled();
    expect(post).not.toHaveBeenCalledWith('/admin/retention/sweep/execute', expect.anything());
    confirmSpy.mockRestore();
  });

  it('places a legal hold via the API', async () => {
    renderPage();
    fireEvent.change(await screen.findByLabelText('Case id'), { target: { value: 'case-999' } });
    fireEvent.change(screen.getByLabelText('Hold reason'), { target: { value: 'appeal pending' } });
    fireEvent.click(screen.getByText('Place hold'));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/admin/retention/legal-holds', { caseId: 'case-999', reason: 'appeal pending' }));
  });

  it('hides Execute from a non-super-admin', async () => {
    roles = ['ADMIN'];
    renderPage();
    fireEvent.click(await screen.findByText('Run dry run'));
    await screen.findByText(/nothing was deleted/i);
    expect(screen.queryByText(/Execute sweep/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Only a super administrator may execute/i)).toBeInTheDocument();
  });
});
