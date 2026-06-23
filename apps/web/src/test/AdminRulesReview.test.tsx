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

// chapter summary helper
function summary(over: Partial<Record<string, number | boolean>> = {}) {
  return {
    chapterCount: 5, reviewed: 5, unreviewed: 0,
    NO_ISSUE: 1, COMMENT: 1, CHANGE_REQUESTED: 1, BLOCKER: 1, APPROVED: 1,
    hasBlockers: true, hasChangeRequests: true, clearForSignOff: false, signedOff: false, activatable: false,
    ...over,
  };
}

const activeVersion = { id: 'v1', ruleSetCode: 'GAAP', version: '2.0', status: 'ACTIVE', reviewState: 'APPROVED', signedOffAt: '2026-01-01', chapterCount: 5, ruleCount: 12, review: summary({ NO_ISSUE: 2, COMMENT: 0, CHANGE_REQUESTED: 0, BLOCKER: 0, APPROVED: 3, hasBlockers: false, hasChangeRequests: false, clearForSignOff: true }) };
// A draft mid-review with a blocker + a change request (mirrors the showcase v3).
const draftVersion = { id: 'v3', ruleSetCode: 'GAAP', version: '3.0-draft', status: 'DRAFT', reviewState: 'BLOCKED', signedOffAt: null, chapterCount: 5, ruleCount: 12, review: summary() };

function detail(over: Record<string, unknown> = {}) {
  return {
    id: 'v3', version: '3.0-draft', status: 'DRAFT', reviewState: 'BLOCKED', signedOffAt: null,
    ruleSet: { code: 'GAAP', title: 'Rules' }, review: summary(),
    comments: [{ id: 'c1', chapterId: 'ch1', authorId: 'u1', body: 'Seat law issue', status: 'BLOCKER', createdAt: '2026-06-20T10:00:00Z' }],
    chapters: [
      { id: 'ch1', number: 1, title: 'General Provisions', review: { status: 'APPROVED', jurisdiction: 'England & Wales', reviewedAt: '2026-06-20' }, rules: [{ id: 'r1', number: '1.1', title: 'Scope' }] },
      { id: 'ch4', number: 4, title: 'Notice of Arbitration', review: { status: 'BLOCKER', jurisdiction: null, reviewedAt: '2026-06-20' }, rules: [{ id: 'r4', number: '4.1', title: 'Contents' }] },
    ],
    ...over,
  };
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><AdminRulesReview /></QueryClientProvider>);
}

beforeEach(() => {
  perms = ['policy:manage'];
  get.mockReset(); post.mockReset();
  get.mockImplementation((url: string) => {
    if (url === '/rules/admin/versions') return Promise.resolve({ data: [activeVersion, draftVersion] });
    if (url.startsWith('/rules/admin/versions/')) return Promise.resolve({ data: detail() });
    return Promise.resolve({ data: {} });
  });
  post.mockResolvedValue({ data: {} });
});

describe('AdminRulesReview — gating & disclaimer', () => {
  it('blocks users without policy-management permission', async () => {
    perms = [];
    renderPage();
    expect(await screen.findByText(/do not have policy-management permission/i)).toBeInTheDocument();
  });

  it('shows the counsel-review disclaimer (not a substitute for legal advice)', async () => {
    renderPage();
    expect(await screen.findByText(/not a substitute for qualified legal advice/i)).toBeInTheDocument();
  });
});

describe('AdminRulesReview — review status display', () => {
  it('lists versions with lifecycle + review state and chapter counts', async () => {
    renderPage();
    expect(await screen.findByText('3.0-draft')).toBeInTheDocument();
    // Lifecycle + review-state badges.
    expect(screen.getByText('Blocked')).toBeInTheDocument();
    // Chapter counts for the draft: one blocker, one change.
    expect(screen.getByText('1 blocker')).toBeInTheDocument();
    expect(screen.getByText('1 change')).toBeInTheDocument();
  });

  it('shows per-chapter review status in the detail view', async () => {
    renderPage();
    fireEvent.click((await screen.findAllByText('Review'))[1]); // the DRAFT row
    expect(await screen.findByText('General Provisions')).toBeInTheDocument();
    expect(screen.getByText('Notice of Arbitration')).toBeInTheDocument();
    // A reviewer comment is shown in the log.
    expect(screen.getByText('Seat law issue')).toBeInTheDocument();
  });
});

describe('AdminRulesReview — blocker gate, sign-off & activation prevention', () => {
  it('disables Sign off and Activate while a blocker/change remains', async () => {
    renderPage();
    await screen.findByText('3.0-draft');
    expect(screen.getByText('Sign off')).toBeDisabled();
    expect(screen.getByText('Activate')).toBeDisabled();
  });

  it('enables Sign off once chapters are clear, and posts it', async () => {
    const clear = { ...draftVersion, review: summary({ NO_ISSUE: 2, COMMENT: 0, CHANGE_REQUESTED: 0, BLOCKER: 0, APPROVED: 3, hasBlockers: false, hasChangeRequests: false, clearForSignOff: true }), reviewState: 'UNDER_REVIEW' };
    get.mockImplementation((url: string) => url === '/rules/admin/versions' ? Promise.resolve({ data: [clear] }) : Promise.resolve({ data: detail() }));
    renderPage();
    const btn = (await screen.findByText('Sign off')) as HTMLButtonElement;
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    await waitFor(() => expect(post).toHaveBeenCalledWith('/rules/admin/versions/v3/sign-off', {}));
  });

  it('enables Activate only after sign-off (activatable), and posts it', async () => {
    const signed = { ...draftVersion, signedOffAt: '2026-06-21', reviewState: 'APPROVED', review: summary({ BLOCKER: 0, CHANGE_REQUESTED: 0, hasBlockers: false, hasChangeRequests: false, clearForSignOff: true, signedOff: true, activatable: true }) };
    get.mockImplementation((url: string) => url === '/rules/admin/versions' ? Promise.resolve({ data: [signed] }) : Promise.resolve({ data: detail() }));
    renderPage();
    const btn = (await screen.findByText('Activate')) as HTMLButtonElement;
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    await waitFor(() => expect(post).toHaveBeenCalledWith('/rules/admin/versions/v3/activate', {}));
  });

  it('records a chapter decision via the API', async () => {
    renderPage();
    fireEvent.click((await screen.findAllByText('Review'))[1]); // the DRAFT row
    // ch1 starts APPROVED; change it to a different decision so onChange fires.
    const select = await screen.findByLabelText('Decision for chapter 1');
    fireEvent.change(select, { target: { value: 'CHANGE_REQUESTED' } });
    await waitFor(() => expect(post).toHaveBeenCalledWith('/rules/admin/versions/v3/chapters/ch1/review', { status: 'CHANGE_REQUESTED' }));
  });
});
