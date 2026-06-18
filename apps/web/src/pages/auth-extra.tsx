import { useState } from 'react';
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
  const [serverError, setServerError] = useState<string | null>(null);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { role: Role.INDIVIDUAL },
  });

  const onSubmit = async (v: RegisterValues) => {
    setServerError(null);
    try {
      await api.post('/auth/register', v);
      setDone(true);
    } catch {
      setServerError('Unable to register with the provided details.');
    }
  };

  return (
    <>
      <PageHeader eyebrow="Get started" title="Create an account" lede="Register as an individual, company, or lawyer. Staff and arbitrator accounts are provisioned by the registry." />
      <div className="section"><div className="container auth-narrow">
        {done ? (
          <div className="alert">Registration received. Please check your email to verify your account before signing in.</div>
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
