import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext';
import { api } from '../lib/api';

const schema = z.object({
  email: z.string().email('Enter a valid email address.'),
  password: z.string().min(1, 'Password is required.'),
  mfaCode: z.string().optional(),
});
type FormValues = z.infer<typeof schema>;

export function SignIn() {
  const { t } = useTranslation();
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  // Return the user to the page they were trying to reach (e.g. the directory).
  const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname ?? '/app';
  const [serverError, setServerError] = useState<string | null>(null);
  const [resendMsg, setResendMsg] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const { register, handleSubmit, getValues, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema),
  });

  const onSubmit = async (values: FormValues) => {
    setServerError(null);
    try {
      await login(values.email, values.password, values.mfaCode);
      navigate(from, { replace: true });
    } catch {
      setServerError('Invalid credentials, or your account requires verification.');
    }
  };

  const handleResendVerification = async () => {
    setResendMsg(null);
    const email = getValues('email')?.trim();
    if (!email) {
      setResendMsg('Enter your email address above first.');
      return;
    }
    setResending(true);
    try {
      await api.post('/auth/resend-verification', { email });
    } finally {
      setResending(false);
      // Generic message regardless of outcome (no account enumeration).
      setResendMsg('If your account is pending verification, a new verification email has been sent.');
    }
  };

  return (
    <div className="section">
      <div className="container auth-narrow">
        <h1 className="center">{t('nav.signIn')}</h1>
        <form className="card" onSubmit={handleSubmit(onSubmit)} noValidate>
          {serverError && <div className="alert alert--danger" role="alert">{serverError}</div>}
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" type="email" className="input" autoComplete="email" {...register('email')} aria-invalid={!!errors.email} />
            {errors.email && <p className="field__error">{errors.email.message}</p>}
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <div className="input-reveal">
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                className="input"
                autoComplete="current-password"
                {...register('password')}
                aria-invalid={!!errors.password}
              />
              <button
                type="button"
                className="input-reveal__btn"
                onClick={() => setShowPassword((s) => !s)}
                aria-pressed={showPassword}
                aria-label={showPassword ? t('auth.hidePassword') : t('auth.showPassword')}
              >
                {showPassword ? t('auth.hide') : t('auth.show')}
              </button>
            </div>
            {errors.password && <p className="field__error">{errors.password.message}</p>}
          </div>
          <div className="field">
            <label htmlFor="mfa">MFA code (if enabled)</label>
            <input id="mfa" className="input" inputMode="numeric" {...register('mfaCode')} />
          </div>
          <button className="btn btn--primary btn--block btn--lg" type="submit" disabled={isSubmitting}>
            {isSubmitting ? t('common.loading') : t('nav.signIn')}
          </button>
          <p className="center field__hint" style={{ marginTop: 'var(--sp-4)' }}>
            <Link to="/forgot-password">Forgot your password?</Link> · <Link to="/register">Create an account</Link>
          </p>
          <p className="center field__hint" style={{ marginTop: 'var(--sp-2)' }}>
            <button type="button" className="link-button" onClick={handleResendVerification} disabled={resending}>
              {resending ? t('common.loading') : 'Resend verification email'}
            </button>
          </p>
          {resendMsg && <div className="alert" role="status" style={{ marginTop: 'var(--sp-3)' }}>{resendMsg}</div>}
        </form>
      </div>
    </div>
  );
}
