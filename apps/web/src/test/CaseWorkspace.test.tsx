import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '../i18n'; // initialise translations so tab labels resolve to real text

const get = vi.fn();
vi.mock('../lib/api', () => ({ api: { get: (...a: unknown[]) => get(...a), post: vi.fn(), patch: vi.fn() } }));

import { CaseWorkspace } from '../pages/app/CaseWorkspace';

function caseDetail(membership: Record<string, unknown>) {
  return {
    id: 'c1', reference: 'GAAP-2026-000010', title: 'ACME v Beta', stage: 'ADMINISTRATIVE_REVIEW',
    seat: 'Geneva', governingLaw: 'Swiss law', language: 'en',
    parties: [{ id: 'p1', side: 'CLAIMANT', legalName: 'ACME' }],
    statusHistory: [],
    _membership: { isTribunal: false, isParty: false, isRegistrar: false, canAdminister: false, caseRoles: [], ...membership },
  };
}

function renderWorkspace(membership: Record<string, unknown>, search = '') {
  get.mockImplementation((url: string) => {
    if (url.includes('/admin-notes')) return Promise.resolve({ data: [] });
    if (url.includes('/cases/c1')) return Promise.resolve({ data: caseDetail(membership) });
    return Promise.resolve({ data: {} });
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/app/cases/c1${search}`]}>
        <Routes><Route path="/app/cases/:id" element={<CaseWorkspace />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => { get.mockReset(); });

describe('CaseWorkspace — Registrar Administration visibility', () => {
  it('shows the Administration tab to a registrar with administrative authority (no case-team row needed)', async () => {
    renderWorkspace({ canAdminister: true });
    expect(await screen.findByRole('tab', { name: 'Administration' })).toBeInTheDocument();
    // Confidentiality preserved: a registrar never gets the Deliberations tab.
    expect(screen.queryByRole('tab', { name: 'Deliberations' })).not.toBeInTheDocument();
  });

  it('also shows it to a case-team registrar', async () => {
    renderWorkspace({ isRegistrar: true, caseRoles: ['CASE_REGISTRAR'] });
    expect(await screen.findByRole('tab', { name: 'Administration' })).toBeInTheDocument();
  });

  it('hides the Administration tab from a party', async () => {
    renderWorkspace({ isParty: true, caseRoles: ['CLAIMANT'] });
    // Wait for load via an always-present tab, then assert Administration is absent.
    expect(await screen.findByRole('tab', { name: 'Overview' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Administration' })).not.toBeInTheDocument();
  });

  it('opens the Administration area directly via ?tab=admin deep link', async () => {
    renderWorkspace({ canAdminister: true }, '?tab=admin');
    expect(await screen.findByText('Save administrative details')).toBeInTheDocument();
  });
});
