import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { api } from '../lib/api';

type Status = 'verifying' | 'success' | 'error' | 'missing';

export function VerifyEmail() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const [status, setStatus] = useState<Status>(token ? 'verifying' : 'missing');
  // Guard against React 18 StrictMode double-invocation consuming the token twice.
  const ran = useRef(false);

  useEffect(() => {
    if (!token || ran.current) return;
    ran.current = true;
    api
      .post('/auth/verify-email', { token })
      .then(() => setStatus('success'))
      .catch(() => setStatus('error'));
  }, [token]);

  return (
    <>
      <PageHeader eyebrow="Account" title="Email verification" />
      <div className="section">
        <div className="container auth-narrow">
          {status === 'verifying' && (
            <div className="card center">
              <p className="muted">Verifying your email…</p>
            </div>
          )}

          {status === 'success' && (
            <div className="card center">
              <div className="alert" role="status">Your email has been verified. Your account is now active.</div>
              <Link to="/sign-in" className="btn btn--primary btn--lg" style={{ marginTop: 'var(--sp-4)' }}>
                Continue to sign in
              </Link>
            </div>
          )}

          {status === 'error' && (
            <div className="card center">
              <div className="alert alert--danger" role="alert">
                This verification link is invalid or has expired.
              </div>
              <p className="field__hint" style={{ marginTop: 'var(--sp-3)' }}>
                Try signing in to request a new verification email, or register again.
              </p>
              <div style={{ display: 'flex', gap: 'var(--sp-3)', justifyContent: 'center', marginTop: 'var(--sp-4)' }}>
                <Link to="/sign-in" className="btn btn--ghost">Sign in</Link>
                <Link to="/register" className="btn btn--primary">Register</Link>
              </div>
            </div>
          )}

          {status === 'missing' && (
            <div className="card center">
              <div className="alert alert--danger" role="alert">No verification token was provided.</div>
              <p className="field__hint" style={{ marginTop: 'var(--sp-3)' }}>
                Please use the link from your verification email.
              </p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
