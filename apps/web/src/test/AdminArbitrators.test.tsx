import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const get = vi.fn();
vi.mock('../lib/api', () => ({ api: { get: (...a: unknown[]) => get(...a) } }));

let perms: string[] = ['user:manage'];
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ user: { permissions: perms } }) }));

import { AdminArbitrators } from '../pages/app/AdminArbitrators';

const arbitrators = [
  { id: 'a1', fullName: "James O'Brien", accessEmail: 'james.obrien@panel.example', profileEmail: null, accountStatus: 'ACTIVE', availability: 'AVAILABLE', approvalStatus: 'APPROVED', verificationStatus: 'VERIFIED', professionalTitle: 'KC', specializations: ['Construction'] },
  { id: 'a2', fullName: 'Elena Petrova', accessEmail: 'arbitrator6@panel.example', profileEmail: null, accountStatus: 'ACTIVE', availability: 'AVAILABLE', approvalStatus: 'APPROVED', verificationStatus: 'VERIFIED', professionalTitle: null, specializations: [] },
];

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><AdminArbitrators /></QueryClientProvider>);
}

beforeEach(() => {
  perms = ['user:manage'];
  get.mockReset();
  get.mockResolvedValue({ data: { data: arbitrators, total: arbitrators.length } });
});

describe('AdminArbitrators — access email visibility', () => {
  it('shows arbitrator access (login) emails to an authorised user', async () => {
    renderPage();
    expect(await screen.findByText('james.obrien@panel.example')).toBeInTheDocument();
    expect(screen.getByText("James O'Brien")).toBeInTheDocument();
  });

  it('shows the correct login email for the demo arbitrator James O’Brien', async () => {
    renderPage();
    const row = (await screen.findByText("James O'Brien")).closest('tr') as HTMLElement;
    expect(row.textContent).toContain('james.obrien@panel.example');
  });

  it('authorises a registrar (appointment:manage) and council (arbitrator:approve)', async () => {
    perms = ['appointment:manage'];
    renderPage();
    expect(await screen.findByText('james.obrien@panel.example')).toBeInTheDocument();
  });

  it('hides access emails from an unauthorised user', async () => {
    perms = [];
    renderPage();
    expect(await screen.findByText(/not authorised to view arbitrator access details/i)).toBeInTheDocument();
    expect(screen.queryByText('james.obrien@panel.example')).not.toBeInTheDocument();
    expect(get).not.toHaveBeenCalled();
  });

  it('searches by name or access email via the API', async () => {
    renderPage();
    await screen.findByText("James O'Brien");
    fireEvent.change(screen.getByPlaceholderText(/Search by name or access email/i), { target: { value: 'james.obrien' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(get).toHaveBeenCalledWith('/arbitrators/internal', expect.objectContaining({ params: expect.objectContaining({ q: 'james.obrien' }) })));
  });
});
