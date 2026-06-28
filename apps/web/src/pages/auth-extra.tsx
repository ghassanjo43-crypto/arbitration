import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Role } from '@gaap/shared';
import { PageHeader } from '../components/PageHeader';
import { api } from '../lib/api';

const registerSchema = z.object({
  firstName: z.string().min(1, 'Required'),
  lastName: z.string().min(1, 'Required'),
  email: z.string().email('Enter a valid email.'),
  password: z.string().min(12, 'Use at least 12 characters.'),
  role: z.nativeEnum(Role),
  acceptTerms: z.literal(true, { errorMap: () => ({ message: 'You must accept the Terms.' }) }),
  acceptPrivacy: z.literal(true, { errorMap: () => ({ message: 'You must accept the Privacy Policy.' }) }),
});
type RegisterValues = z.infer<typeof registerSchema>;

export function Register() {
  const [done, setDone] = useState(false);
  const [emailSent, setEmailSent] = useState(true);
  const [serverError, setServerError] = useState<string | null>(null);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { role: Role.INDIVIDUAL },
  });

  const onSubmit = async (v: RegisterValues) => {
    setServerError(null);
    try {
      const res = await api.post('/auth/register', v);
      // Registration succeeded even if the verification email could not be sent.
      setEmailSent(res.data?.emailSent !== false);
      setDone(true);
    } catch {
      // Only reached for genuine failures (validation, or a blocked active duplicate).
      setServerError('Unable to register with the provided details.');
    }
  };

  return (
    <>
      <PageHeader eyebrow="Get started" title="Create an account" lede="Register as an individual, company, or lawyer. Staff and arbitrator accounts are provisioned by the registry." />
      <div className="section"><div className="container auth-narrow">
        {done ? (
          emailSent ? (
            <div className="alert" role="status">
              Registration successful. Please check your email to verify your account.
            </div>
          ) : (
            <div className="alert alert--legal" role="status">
              Registration successful, but we could not send the verification email. Please use
              “Resend verification email” on the <Link to="/sign-in">sign-in page</Link>.
            </div>
          )
        ) : (
          <form className="card" onSubmit={handleSubmit(onSubmit)} noValidate>
            {serverError && <div className="alert alert--danger" role="alert">{serverError}</div>}
            <div className="grid grid-2">
              <div className="field">
                <label htmlFor="fn">First name</label>
                <input id="fn" className="input" {...register('firstName')} />
                {errors.firstName && <p className="field__error">{errors.firstName.message}</p>}
              </div>
              <div className="field">
                <label htmlFor="ln">Last name</label>
                <input id="ln" className="input" {...register('lastName')} />
                {errors.lastName && <p className="field__error">{errors.lastName.message}</p>}
              </div>
            </div>
            <div className="field">
              <label htmlFor="re">Email</label>
              <input id="re" type="email" className="input" {...register('email')} />
              {errors.email && <p className="field__error">{errors.email.message}</p>}
            </div>
            <div className="field">
              <label htmlFor="rp">Password</label>
              <input id="rp" type="password" className="input" {...register('password')} />
              {errors.password && <p className="field__error">{errors.password.message}</p>}
            </div>
            <div className="field">
              <label htmlFor="rr">Account type</label>
              <select id="rr" className="select" {...register('role')}>
                <option value={Role.INDIVIDUAL}>Private individual</option>
                <option value={Role.COMPANY_CLIENT}>Company client</option>
                <option value={Role.LAWYER}>Lawyer</option>
              </select>
            </div>
            <label className="check-row"><input type="checkbox" {...register('acceptTerms')} /> I accept the Terms & Conditions.</label>
            {errors.acceptTerms && <p className="field__error">{errors.acceptTerms.message}</p>}
            <label className="check-row"><input type="checkbox" {...register('acceptPrivacy')} /> I accept the Privacy Policy.</label>
            {errors.acceptPrivacy && <p className="field__error">{errors.acceptPrivacy.message}</p>}
            <button className="btn btn--primary btn--block btn--lg" type="submit" disabled={isSubmitting} style={{ marginTop: 'var(--sp-4)' }}>
              Create account
            </button>
          </form>
        )}
      </div></div>
    </>
  );
}

export function ForgotPassword() {
  const [sent, setSent] = useState(false);
  const { register, handleSubmit } = useForm<{ email: string }>();
  const onSubmit = async (v: { email: string }) => {
    await api.post('/auth/password-reset/request', v).catch(() => undefined);
    setSent(true);
  };
  return (
    <>
      <PageHeader eyebrow="Account" title="Reset your password" />
      <div className="section"><div className="container auth-narrow">
        {sent ? (
          <div className="alert">If an account exists for that address, a reset link has been sent.</div>
        ) : (
          <form className="card" onSubmit={handleSubmit(onSubmit)}>
            <div className="field">
              <label htmlFor="fe">Email</label>
              <input id="fe" type="email" className="input" {...register('email', { required: true })} />
            </div>
            <button className="btn btn--primary btn--block" type="submit">Send reset link</button>
          </form>
        )}
      </div></div>
    </>
  );
}

const resetSchema = z
  .object({
    password: z.string().min(12, 'Use at least 12 characters.'),
    confirm: z.string(),
  })
  .refine((d) => d.password === d.confirm, { message: 'Passwords do not match.', path: ['confirm'] });
type ResetValues = z.infer<typeof resetSchema>;

function apiMessage(e: unknown): string {
  const m = (e as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message;
  return Array.isArray(m) ? m.join('; ') : (m ?? 'This reset link is invalid or has expired. Please request a new one.');
}

/** Password reset page reached from the emailed link: /reset-password?token=… */
export function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const navigate = useNavigate();
  const [done, setDone] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<ResetValues>({ resolver: zodResolver(resetSchema) });

  const onSubmit = async (v: ResetValues) => {
    setServerError(null);
    try {
      await api.post('/auth/password-reset/confirm', { token, newPassword: v.password });
      setDone(true);
      setTimeout(() => navigate('/sign-in'), 2500);
    } catch (e) {
      setServerError(apiMessage(e));
    }
  };

  if (!token) {
    return (
      <>
        <PageHeader eyebrow="Account" title="Set a new password" />
        <div className="section"><div className="container auth-narrow">
          <div className="alert alert--danger" role="alert">
            This password-reset link is invalid or incomplete. Please request a new one from{' '}
            <Link to="/forgot-password">Forgot password</Link>.
          </div>
        </div></div>
      </>
    );
  }

  return (
    <>
      <PageHeader eyebrow="Account" title="Set a new password" />
      <div className="section"><div className="container auth-narrow">
        {done ? (
          <div className="alert" role="status">
            Your password has been reset. Redirecting to sign in… <Link to="/sign-in">Sign in now</Link>.
          </div>
        ) : (
          <form className="card" onSubmit={handleSubmit(onSubmit)} noValidate>
            {serverError && <div className="alert alert--danger" role="alert">{serverError}</div>}
            <div className="field">
              <label htmlFor="np">New password</label>
              <input id="np" type="password" className="input" autoComplete="new-password" {...register('password')} />
              {errors.password && <p className="field__error">{errors.password.message}</p>}
            </div>
            <div className="field">
              <label htmlFor="cp">Confirm new password</label>
              <input id="cp" type="password" className="input" autoComplete="new-password" {...register('confirm')} />
              {errors.confirm && <p className="field__error">{errors.confirm.message}</p>}
            </div>
            <button className="btn btn--primary btn--block" type="submit" disabled={isSubmitting} style={{ marginTop: 'var(--sp-3)' }}>Reset password</button>
          </form>
        )}
      </div></div>
    </>
  );
}

export function LawyerRegistration() {
  return (
    <>
      <PageHeader eyebrow="For counsel" title="Lawyer Registration" lede="Register a professional profile to represent clients, file cases, and manage a legal team." />
      <div className="section"><div className="container narrow prose">
        <p>Create a lawyer account to build your professional profile, register and represent clients, file cases on their behalf, add members to your legal team, and receive notices, orders, and awards.</p>
        <p>After creating your account, complete your profile with your bar association, bar number, jurisdiction, practice areas, and professional licence documents. Verification is completed by the registry.</p>
        <a className="btn btn--gold btn--lg" href="/register">Create a lawyer account</a>
      </div></div>
    </>
  );
}
