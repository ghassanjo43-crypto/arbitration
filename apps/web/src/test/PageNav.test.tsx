import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route, Link } from 'react-router-dom';
import { PageNav } from '../components/layout/PageNav';

function Dashboard() {
  return (
    <>
      <div>DASHBOARD HOME</div>
      <Link to="/app/admin/users">go to users</Link>
    </>
  );
}

describe('PageNav', () => {
  it('renders Back and Dashboard controls', () => {
    render(
      <MemoryRouter initialEntries={['/app/admin/users']}>
        <Routes>
          <Route path="/app/admin/users" element={<PageNav />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByRole('button', { name: /back/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /dashboard/i })).toBeInTheDocument();
  });

  it('Dashboard button navigates to /app', () => {
    render(
      <MemoryRouter initialEntries={['/app/admin/users']}>
        <Routes>
          <Route path="/app" element={<div>DASHBOARD HOME</div>} />
          <Route path="/app/admin/users" element={<PageNav />} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: /dashboard/i }));
    expect(screen.getByText('DASHBOARD HOME')).toBeInTheDocument();
  });

  it('Back returns to the previous in-app page when history exists', () => {
    render(
      <MemoryRouter initialEntries={['/app']}>
        <Routes>
          <Route path="/app" element={<Dashboard />} />
          <Route path="/app/admin/users" element={<PageNav />} />
        </Routes>
      </MemoryRouter>,
    );
    // Navigate forward to build history, then go Back.
    fireEvent.click(screen.getByText('go to users'));
    expect(screen.getByRole('button', { name: /back/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /back/i }));
    expect(screen.getByText('DASHBOARD HOME')).toBeInTheDocument();
  });

  it('Back falls back to the dashboard when there is no in-app history', () => {
    render(
      <MemoryRouter initialEntries={['/app/admin/users']}>
        <Routes>
          <Route path="/app" element={<div>DASHBOARD HOME</div>} />
          <Route path="/app/admin/users" element={<PageNav />} />
        </Routes>
      </MemoryRouter>,
    );
    // Landed directly (location.key === 'default') → Back goes to /app, not a no-op.
    fireEvent.click(screen.getByRole('button', { name: /back/i }));
    expect(screen.getByText('DASHBOARD HOME')).toBeInTheDocument();
  });
});
