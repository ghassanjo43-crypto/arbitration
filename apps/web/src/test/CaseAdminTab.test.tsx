import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const get = vi.fn();
const post = vi.fn();
const patch = vi.fn();
vi.mock('../lib/api', () => ({ api: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), patch: (...a: unknown[]) => patch(...a) } }));

import { CaseAdminTab } from '../pages/app/case/CaseAdminTab';

const caseData = {
  id: 'c1', stage: 'ADMINISTRATIVE_REVIEW', title: 'ACME v Beta', seat: 'Geneva',
  governingLaw: 'Swiss law', language: 'en', category: 'Commercial', industry: 'Energy',
  numberOfArbitrators: 1, appointmentMechanism: 'institutional',
};

function renderTab(goTab = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><CaseAdminTab caseData={caseData} goTab={goTab} /></QueryClientProvider>);
  return goTab;
}

beforeEach(() => {
  get.mockReset(); post.mockReset(); patch.mockReset();
  get.mockResolvedValue({ data: [] });
  post.mockResolvedValue({ data: { ok: true } });
  patch.mockResolvedValue({ data: {} });
});

describe('CaseAdminTab — registrar actionable controls', () => {
  it('shows actionable admin controls (not read-only) and the non-merits boundary note', async () => {
    renderTab();
    expect(await screen.findByText('Save administrative details')).toBeInTheDocument();
    expect(screen.getByText('Update stage')).toBeInTheDocument();
    expect(screen.getByText('Add note')).toBeInTheDocument();
    expect(screen.getByText(/cannot access tribunal deliberations, draft or issue awards, or decide the merits/i)).toBeInTheDocument();
    // The tab surfaces no award-drafting / deliberation / merits action controls.
    expect(screen.queryByRole('button', { name: /award|deliberat|decide/i })).not.toBeInTheDocument();
  });

  it('saves edited administrative information via PATCH /cases/:id/admin', async () => {
    renderTab();
    const seat = await screen.findByDisplayValue('Geneva');
    fireEvent.change(seat, { target: { value: 'London' } });
    fireEvent.click(screen.getByText('Save administrative details'));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/cases/c1/admin', expect.objectContaining({ seat: 'London' })));
  });

  it('records an administrative note via POST /cases/:id/admin-notes', async () => {
    renderTab();
    fireEvent.change(await screen.findByLabelText('New administrative note'), { target: { value: 'Spoke to claimant.' } });
    fireEvent.click(screen.getByText('Add note'));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/cases/c1/admin-notes', { note: 'Spoke to claimant.' }));
  });

  it('updates the case stage via the registry transition endpoint', async () => {
    renderTab();
    fireEvent.change(await screen.findByLabelText('New stage'), { target: { value: 'CASE_REGISTERED' } });
    fireEvent.click(screen.getByText('Update stage'));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/registry/cases/c1/transition', expect.objectContaining({ toStage: 'CASE_REGISTERED' })));
  });

  it('routes to other operational tabs via quick links', async () => {
    const goTab = renderTab();
    fireEvent.click(await screen.findByText('Tribunal appointment'));
    expect(goTab).toHaveBeenCalledWith('tribunal');
  });
});
