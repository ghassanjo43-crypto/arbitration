import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const get = vi.fn();
const post = vi.fn();
vi.mock('../lib/api', () => ({ api: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a) } }));

import { ArbitratorInvitations } from '../pages/app/Dashboard';

const acceptedChair = { id: 'i1', caseId: 'c1', proposedRole: 'CHAIR', status: 'ACCEPTED', case: { reference: 'GAAP-2026-000010', title: 'ACME v Beta' } };
const invited = { id: 'i2', caseId: 'c2', proposedRole: 'CO_ARBITRATOR', status: 'INVITED', case: { reference: 'GAAP-2', title: 'Foo v Bar' } };

function renderInv(invitations: unknown[]) {
  get.mockImplementation((url: string) => {
    if (url.includes('/appointments/mine')) return Promise.resolve({ data: invitations });
    return Promise.resolve({ data: [] });
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/app']}>
        <Routes>
          <Route path="/app" element={<ArbitratorInvitations />} />
          <Route path="/app/cases/:id" element={<div>CASE WORKSPACE</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => { get.mockReset(); post.mockReset(); });

describe('ArbitratorInvitations', () => {
  it('shows Open case for an accepted appointment and hides the accept/declare buttons', async () => {
    renderInv([acceptedChair]);
    const card = (await screen.findByText('ACME v Beta')).closest('article') as HTMLElement;
    expect(within(card).getByRole('link', { name: 'Open case' })).toHaveAttribute('href', '/app/cases/c1?tab=tribunal');
    expect(within(card).getByRole('link', { name: 'Open awards' })).toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: 'Accept appointment' })).not.toBeInTheDocument();
  });

  it('navigates to the case workspace (tribunal tab) when Open case is clicked', async () => {
    renderInv([acceptedChair]);
    fireEvent.click(await screen.findByRole('link', { name: 'Open case' }));
    expect(screen.getByText('CASE WORKSPACE')).toBeInTheDocument();
  });

  it('renders ACCEPTED and CHAIR as non-interactive status chips, not buttons', async () => {
    renderInv([acceptedChair]);
    await screen.findByText('ACME v Beta');
    expect(screen.getByText('ACCEPTED')).toBeInTheDocument();
    expect(screen.getByText('CHAIR')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'ACCEPTED' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'CHAIR' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'ACCEPTED' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'CHAIR' })).not.toBeInTheDocument();
  });

  it('shows the chair explanation and procedural-directions action for an accepted chair', async () => {
    renderInv([acceptedChair]);
    expect(await screen.findByText(/You are tribunal chair for this case/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Manage procedural directions' })).toBeInTheDocument();
  });

  it('shows accept/declare (and no Open case) for an open invitation', async () => {
    renderInv([invited]);
    const card = (await screen.findByText('Foo v Bar')).closest('article') as HTMLElement;
    expect(within(card).getByRole('button', { name: 'Accept appointment' })).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Declare no conflict' })).toBeInTheDocument();
    expect(within(card).queryByRole('link', { name: 'Open case' })).not.toBeInTheDocument();
  });

  it('shows no case links for a non-appointed arbitrator (no invitations)', async () => {
    renderInv([]);
    expect(await screen.findByText('No pending invitations.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open case' })).not.toBeInTheDocument();
  });
});
