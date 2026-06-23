import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const get = vi.fn();
const post = vi.fn();
vi.mock('../lib/api', () => ({ api: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a) } }));

// Drive the auth permission via a mock.
let perms: string[] = ['policy:manage'];
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ user: { permissions: perms } }) }));

import { AdminRulesReview } from '../pages/app/AdminRulesReview';

const versions = [
  { id: 'v1', ruleSetCode: 'GAAP', version: '1.0', status: 'ACTIVE', ruleCount: 3, review: { ruleCount: 3, OK: 3, CHANGE_REQUIRED: 0, BLOCKER: 0, PENDING: 0, clearToActivate: true } },
  { id: 'v2', ruleSetCode: 'GAAP', version: '2.0-draft', status: 'DRAFT', ruleCount: 3, review: { ruleCount: 3, OK: 1, CHANGE_REQUIRED: 0, BLOCKER: 1, PENDING: 1, clearToActivate: false } },
];

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><AdminRulesReview /></QueryClientProvider>);
}

beforeEach(() => {
  perms = ['policy:manage'];
  get.mockReset(); post.mockReset();
  get.mockImplementation((url: string) => {
    if (url === '/rules/admin/versions') return Promise.resolve({ data: versions });
    if (url.startsWith('/rules/admin/versions/')) return Promise.resolve({ data: { id: 'v2', version: '2.0-draft', status: 'DRAFT', ruleSet: { code: 'GAAP', title: 'Rules' }, review: versions[1].review, chapters: [] } });
    return Promise.resolve({ data: {} });
  });
  post.mockResolvedValue({ data: {} });
});

describe('AdminRulesReview — gating & display', () => {
  it('blocks users without policy-management permission', async () => {
    perms = [];
    renderPage();
    expect(await screen.findByText(/do not have policy-management permission/i)).toBeInTheDocument();
  });

  it('lists versions with their review summary', async () => {
    renderPage();
    // Wait for the async versions query to render the table rows.
    expect(await screen.findByText('1.0')).toBeInTheDocument();
    expect(screen.getByText('2.0-draft')).toBeInTheDocument();
    // Draft shows its blocker + pending counts.
    expect(screen.getByText('1 blocker')).toBeInTheDocument();
    expect(screen.getByText('1 pending')).toBeInTheDocument();
  });

  it('disables Activate for a draft that is not clear', async () => {
    renderPage();
    const activateBtn = (await screen.findByText('Activate')) as HTMLButtonElement;
    expect(activateBtn).toBeDisabled();
  });

  it('activates a clear draft via the API', async () => {
    // Make the draft clear-to-activate.
    const clear = [...versions];
    clear[1] = { ...versions[1], status: 'DRAFT', review: { ruleCount: 3, OK: 3, CHANGE_REQUIRED: 0, BLOCKER: 0, PENDING: 0, clearToActivate: true } };
    get.mockImplementation((url: string) => url === '/rules/admin/versions' ? Promise.resolve({ data: clear }) : Promise.resolve({ data: {} }));
    renderPage();
    fireEvent.click(await screen.findByText('Activate'));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/rules/admin/versions/v2/activate', {}));
  });
});
