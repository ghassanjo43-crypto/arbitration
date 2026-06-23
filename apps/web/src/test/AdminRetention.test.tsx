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

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><AdminRetention /></QueryClientProvider>);
}

beforeEach(() => {
  perms = ['settings:manage']; roles = ['SUPER_ADMIN'];
  get.mockReset(); post.mockReset();
  get.mockImplementation((url: string) => {
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

describe('AdminRetention', () => {
  it('blocks users without settings-management permission', async () => {
    perms = [];
    renderPage();
    expect(await screen.findByText(/do not have settings-management permission/i)).toBeInTheDocument();
  });

  it('shows the safe-by-design disclaimer, policy and legal holds', async () => {
    renderPage();
    expect(await screen.findByText(/safe by design/i)).toBeInTheDocument();
    expect(await screen.findByText(/Retain Forever/i)).toBeInTheDocument();
    expect(await screen.findByText('enforcement pending')).toBeInTheDocument();
  });

  it('runs a dry run and reports eligible + legal-hold-blocked counts without deleting', async () => {
    renderPage();
    fireEvent.click(await screen.findByText('Run dry run'));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/admin/retention/sweep/dry-run', {}));
    expect(await screen.findByText(/nothing was deleted/i)).toBeInTheDocument();
    // CASE_RECORD eligible=2, blocked=1.
    expect(screen.getByText('2')).toBeInTheDocument();
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
