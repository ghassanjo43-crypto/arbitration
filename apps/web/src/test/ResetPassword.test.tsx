import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const post = vi.fn();
vi.mock('../lib/api', () => ({ api: { post: (...a: unknown[]) => post(...a) } }));

import { ResetPassword } from '../pages/auth-extra';

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/sign-in" element={<div>SIGN IN PAGE</div>} />
        <Route path="/forgot-password" element={<div>FORGOT PAGE</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => { post.mockReset(); });

describe('ResetPassword (/reset-password?token=…)', () => {
  it('renders the reset form when a token is present', () => {
    renderAt('/reset-password?token=abc');
    expect(screen.getByLabelText('New password')).toBeInTheDocument();
    expect(screen.getByLabelText('Confirm new password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reset password' })).toBeInTheDocument();
  });

  it('submits the token and new password to the API reset endpoint', async () => {
    post.mockResolvedValue({ data: { success: true } });
    renderAt('/reset-password?token=abc123');
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'aVerySecret123' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'aVerySecret123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reset password' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/auth/password-reset/confirm', { token: 'abc123', newPassword: 'aVerySecret123' }));
    expect(await screen.findByText(/Your password has been reset/i)).toBeInTheDocument();
  });

  it('shows a clear error for an invalid/expired token', async () => {
    post.mockRejectedValue({ response: { data: { message: 'Invalid or expired reset link.' } } });
    renderAt('/reset-password?token=bad');
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'aVerySecret123' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'aVerySecret123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reset password' }));
    expect(await screen.findByText(/Invalid or expired reset link/i)).toBeInTheDocument();
  });

  it('rejects mismatched passwords without calling the API', async () => {
    renderAt('/reset-password?token=abc');
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'aVerySecret123' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'different12345' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reset password' }));
    expect(await screen.findByText(/Passwords do not match/i)).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  it('shows a missing-link message when there is no token', () => {
    renderAt('/reset-password');
    expect(screen.getByText(/invalid or incomplete/i)).toBeInTheDocument();
    expect(screen.queryByLabelText('New password')).not.toBeInTheDocument();
  });
});
