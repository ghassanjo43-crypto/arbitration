import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock the api client before importing the component.
const get = vi.fn();
const post = vi.fn();
vi.mock('../lib/api', () => ({ api: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a) } }));

import { TribunalTab } from '../pages/app/case/TribunalTab';

function overview(over: Record<string, unknown> = {}) {
  return {
    composition: 'THREE_MEMBER', constituted: false, pendingChallenge: false,
    members: [
      { id: 'm1', arbitratorUserId: 'u1', displayName: 'Dr Chair', role: 'CHAIR', status: 'ACTIVE', nominatedBy: null, acceptedAt: '2026-06-01T00:00:00Z', vacatedAt: null, vacancyReason: null },
    ],
    invitations: [
      { id: 'inv1', arbitratorId: 'p1', arbitratorName: 'Ms Coarb', proposedRole: 'CO_ARBITRATOR', nominatedBy: 'CLAIMANT', appointmentMethod: 'PARTY_NOMINATION', status: 'CONFLICT_CHECK', reminderCount: 1, lastReminderAt: null, declineReason: null, fillsVacancyUserId: null, disclosureFiled: true, responseDeadline: { dueAt: '2026-07-01T23:59:59Z', status: 'OPEN', source: 'RULE' } },
      { id: 'inv2', arbitratorId: 'p2', arbitratorName: 'Mr Late', proposedRole: 'CO_ARBITRATOR', nominatedBy: 'RESPONDENT', appointmentMethod: 'PARTY_NOMINATION', status: 'INVITED', reminderCount: 0, lastReminderAt: null, declineReason: null, fillsVacancyUserId: null, disclosureFiled: false, responseDeadline: { dueAt: '2026-07-05T23:59:59Z', status: null, source: 'FALLBACK' } },
    ],
    challenges: [],
    viewer: { canManage: true, canDecideChallenge: true },
    ...over,
  };
}

function renderTab() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><TribunalTab caseId="c1" /></QueryClientProvider>);
}

beforeEach(() => {
  get.mockReset(); post.mockReset();
  get.mockImplementation((url: string) => {
    if (url.includes('/appointments/overview')) return Promise.resolve({ data: overview() });
    if (url.startsWith('/arbitrators')) return Promise.resolve({ data: { data: [{ id: 'p9', fullName: 'New Arb' }] } });
    return Promise.resolve({ data: {} });
  });
  post.mockResolvedValue({ data: {} });
});

describe('TribunalTab — display & rule-driven deadlines', () => {
  it('shows composition, members, and invitation deadline source (Rule vs Fallback)', async () => {
    renderTab();
    await screen.findByText('Tribunal composition');
    expect(screen.getByText('Three Member')).toBeInTheDocument();
    expect(screen.getByText('Dr Chair')).toBeInTheDocument();
    // Disclosure status surfaced per invitation.
    expect(screen.getByText('Filed')).toBeInTheDocument();
    expect(screen.getByText('Pending')).toBeInTheDocument();
    // Both deadline sources are labelled.
    expect(screen.getByText('Rule')).toBeInTheDocument();
    expect(screen.getByText('Fallback')).toBeInTheDocument();
    expect(screen.getByText(/1 reminder/)).toBeInTheDocument();
  });

  it('warns and signals suspended constitution when a challenge is pending', async () => {
    get.mockImplementation((url: string) =>
      url.includes('/appointments/overview')
        ? Promise.resolve({ data: overview({ pendingChallenge: true }) })
        : Promise.resolve({ data: { data: [] } }));
    renderTab();
    await waitFor(() => expect(screen.getByText(/constitution is suspended/i)).toBeInTheDocument());
  });
});

describe('TribunalTab — permission gating', () => {
  it('hides management actions from a non-manager (party) viewer', async () => {
    get.mockImplementation((url: string) =>
      url.includes('/appointments/overview')
        ? Promise.resolve({ data: overview({ viewer: { canManage: false, canDecideChallenge: false } }) })
        : Promise.resolve({ data: { data: [] } }));
    renderTab();
    await screen.findByText('Tribunal composition');
    expect(screen.queryByText('Default appointment')).not.toBeInTheDocument();
    expect(screen.queryByText('Send reminder')).not.toBeInTheDocument();
    expect(screen.queryByText('Record vacancy')).not.toBeInTheDocument();
  });

  it('shows management actions to an authorised manager', async () => {
    renderTab();
    await screen.findByText('Tribunal composition');
    expect(screen.getByText('Default appointment')).toBeInTheDocument();
    expect(screen.getByText('Nominate chair')).toBeInTheDocument();
    expect(screen.getByText('Record vacancy')).toBeInTheDocument();
    // Both outstanding invitations expose a reminder action.
    expect(screen.getAllByText('Send reminder')).toHaveLength(2);
  });
});

describe('TribunalTab — action flows', () => {
  it('sends a reminder via the API and shows a success state', async () => {
    renderTab();
    await screen.findByText('Tribunal composition');
    // The first reminder button corresponds to the first invitation (inv1).
    fireEvent.click(screen.getAllByText('Send reminder')[0]);
    await waitFor(() => expect(post).toHaveBeenCalledWith('/appointments/inv1/remind', {}));
    await screen.findByText('Reminder sent.');
  });

  it('confirms a vacancy through a dialog with a reason field', async () => {
    renderTab();
    await screen.findByText('Tribunal composition');
    fireEvent.click(screen.getByText('Record vacancy'));
    // Dialog opens with a reason selector and a confirm button.
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Vacancy reason')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByText('Confirm vacancy'));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/tribunal/members/m1/vacancy', expect.objectContaining({ reason: 'RESIGNATION' })));
    await screen.findByText('Vacancy recorded.');
  });

  it('surfaces an API error (e.g. constitution blocked) as an error state', async () => {
    post.mockRejectedValueOnce({ response: { data: { message: 'Constitution is suspended while an arbitrator challenge is pending.' } } });
    renderTab();
    await screen.findByText('Tribunal composition');
    fireEvent.click(screen.getByText('Constitute tribunal'));
    await screen.findByText(/Constitution is suspended/i);
  });
});
