import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// i18n: return the key so assertions don't depend on a loaded resource bundle.
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

const get = vi.fn();
vi.mock('../lib/api', () => ({ api: { get: (...a: unknown[]) => get(...a) } }));

let authUser: { id: string; email: string; roles: string[]; permissions: string[] } | null = null;
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ user: authUser, logout: vi.fn() }) }));

import { Dashboard } from '../pages/app/Dashboard';

function renderDash() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/app']}><Dashboard /></MemoryRouter>
    </QueryClientProvider>,
  );
}

function asUser(roles: string[], permissions: string[] = []) {
  authUser = { id: 'u1', email: 'u@x.test', roles, permissions };
}

beforeEach(() => {
  get.mockReset();
  // No cases; empty sub-widgets so conditional sections render without error.
  get.mockImplementation((url: string) => {
    if (url.includes('/calendar/mine')) return Promise.resolve({ data: { deadlines: [], hearings: [] } });
    if (url.includes('/registry/queue')) return Promise.resolve({ data: { cases: [], statistics: [] } });
    if (url.includes('/appointments/mine')) return Promise.resolve({ data: [] });
    if (url.includes('/lawyers/me/dashboard')) return Promise.resolve({ data: { clients: [], activeCases: [], closedCases: [] } });
    return Promise.resolve({ data: [] }); // /cases
  });
});

const fileLinks = (c: HTMLElement) => c.querySelectorAll('a[href="/file-a-case"]');

describe('Dashboard — case-filing entry point by role', () => {
  it('does NOT show a File a case link to an Arbitrator account', async () => {
    asUser(['ARBITRATOR']);
    const { container } = renderDash();
    await screen.findByText('Your cases');
    expect(fileLinks(container)).toHaveLength(0);
  });

  it('does NOT show a File a case link to a Registrar account', async () => {
    asUser(['REGISTRAR'], ['case:view_queue']);
    const { container } = renderDash();
    await screen.findByText('Your cases');
    expect(fileLinks(container)).toHaveLength(0);
  });

  it('does NOT show a File a case link to a Council member account', async () => {
    asUser(['COUNCIL_MEMBER'], ['conflict:review']);
    const { container } = renderDash();
    await screen.findByText('Your cases');
    expect(fileLinks(container)).toHaveLength(0);
  });

  it('does NOT show a File a case link to a Super Admin account', async () => {
    asUser(['SUPER_ADMIN'], ['user:manage', 'role:manage']);
    const { container } = renderDash();
    await screen.findByText('Your cases');
    expect(fileLinks(container)).toHaveLength(0);
  });

  it('DOES show a File a case link to an Individual claimant', async () => {
    asUser(['INDIVIDUAL']);
    const { container } = renderDash();
    await screen.findByText('Your cases');
    expect(fileLinks(container).length).toBeGreaterThan(0);
  });

  it('DOES show a File a case link to a Company party', async () => {
    asUser(['COMPANY_CLIENT']);
    const { container } = renderDash();
    await screen.findByText('Your cases');
    expect(fileLinks(container).length).toBeGreaterThan(0);
  });

  it('DOES show a File a case link to an authorized representative (Lawyer)', async () => {
    asUser(['LAWYER']);
    const { container } = renderDash();
    await screen.findByText('Your cases');
    expect(fileLinks(container).length).toBeGreaterThan(0);
  });

  it('shows a conflict notice when an account is both Arbitrator and party', async () => {
    asUser(['ARBITRATOR', 'INDIVIDUAL']);
    const { container } = renderDash();
    await screen.findByText('Your cases');
    expect(fileLinks(container).length).toBeGreaterThan(0); // party capacity → may file
    expect(screen.getByText(/Conflict notice/i)).toBeInTheDocument();
  });
});
