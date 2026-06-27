import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '../i18n';

const get = vi.fn();
vi.mock('../lib/api', () => ({ api: { get: (...a: unknown[]) => get(...a), post: vi.fn() } }));

let perms: string[] = [];
let roles: string[] = [];
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ user: { email: 'u@x.com', permissions: perms, roles }, logout: vi.fn() }) }));

import { RolesResponsibilities } from '../pages/app/RolesResponsibilities';
import { Dashboard } from '../pages/app/Dashboard';

const ROLE_HEADINGS = [
  /^Super Admin$/,
  /^Registrar$/,
  /^Council Member \/ Appointing Authority$/,
  /^Arbitrator \/ Tribunal$/,
  /^Lawyer \/ Representative$/,
  /^Party \/ Client$/,
  /^Finance \/ Admin$/,
];

beforeEach(() => {
  perms = []; roles = [];
  get.mockReset();
  get.mockImplementation((url: string) => {
    if (url.includes('/calendar/mine')) return Promise.resolve({ data: { deadlines: [], hearings: [] } });
    return Promise.resolve({ data: [] });
  });
});

describe('RolesResponsibilities page', () => {
  it('renders for an authenticated user with the title and guiding principle', () => {
    render(<RolesResponsibilities />);
    expect(screen.getByRole('heading', { level: 1, name: /User Roles & Responsibilities/i })).toBeInTheDocument();
    expect(screen.getByText(/Platform administration is separate from dispute decision-making/i)).toBeInTheDocument();
  });

  it('includes every major role as a section', () => {
    render(<RolesResponsibilities />);
    for (const name of ROLE_HEADINGS) {
      expect(screen.getByRole('heading', { level: 2, name })).toBeInTheDocument();
    }
  });

  it('shows the at-a-glance comparison table headers', () => {
    render(<RolesResponsibilities />);
    expect(screen.getByText('Main function')).toBeInTheDocument();
    expect(screen.getByText('Can edit?')).toBeInTheDocument();
    expect(screen.getByText('Cannot do')).toBeInTheDocument();
  });

  it('is purely informational — it makes no API calls and exposes no case data', () => {
    render(<RolesResponsibilities />);
    expect(get).not.toHaveBeenCalled();
  });
});

describe('Dashboard — User Roles link', () => {
  it('links to /app/roles for any authenticated user', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/app']}>
          <Routes><Route path="/app" element={<Dashboard />} /></Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const link = screen.getByRole('link', { name: 'User Roles' });
    expect(link).toHaveAttribute('href', '/app/roles');
  });
});
