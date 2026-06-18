import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate, Link } from 'react-router-dom';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext';

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
  const [serverError, setServerError] = useState<string | null>(null);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema),
  });

  const onSubmit = async (values: FormValues) => {
    setServerError(null);
    try {
      await login(values.email, values.password, values.mfaCode);
      navigate('/app');
    } catch {
      setServerError('Invalid credentials, or your account requires verification.');
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
            <input id="password" type="password" className="input" autoComplete="current-password" {...register('password')} aria-invalid={!!errors.password} />
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
        </form>
      </div>
    </div>
  );
}
