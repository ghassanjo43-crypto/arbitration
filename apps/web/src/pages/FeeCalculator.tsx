import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { PARTY_ROLES, Role } from '@gaap/shared';
import { useAuth } from '../auth/AuthContext';
import { api } from '../lib/api';

interface FormValues {
  amountInDispute: number;
  currency: string;
  numberOfArbitrators: number;
  expedited: boolean;
}

interface FeeResult {
  currency: string;
  lines: { category: string; label: string; amount: number }[];
  total: number;
  disclaimer: string;
}

export function FeeCalculator() {
  const { t } = useTranslation();
  const { user } = useAuth();
  // The fee calculator is reserved for clients preparing to register a case.
  const isClient = !!user && user.roles.some((r) => PARTY_ROLES.includes(r as Role));

  const { register, handleSubmit } = useForm<FormValues>({
    defaultValues: { amountInDispute: 500000, currency: 'USD', numberOfArbitrators: 1, expedited: false },
  });

  const mutation = useMutation<FeeResult, unknown, FormValues>({
    mutationFn: async (values) => {
      const res = await api.post('/fees/calculate', {
        amountInDispute: Number(values.amountInDispute),
        currency: values.currency,
        numberOfArbitrators: Number(values.numberOfArbitrators),
        expedited: values.expedited,
      });
      return res.data;
    },
  });

  const fmt = (n: number, currency: string) =>
    new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 0 }).format(n);

  // Gate: only clients (individuals, companies, lawyers) preparing a filing may use it.
  if (!isClient) {
    return (
      <div className="section">
        <div className="container narrow">
          <header className="page-head">
            <p className="eyebrow">{t('nav.platform')}</p>
            <h1>{t('fees.title')}</h1>
          </header>
          <div className="alert alert--legal">
            The fee calculator is available to clients preparing to register a case.
            {user
              ? ' Your current account type does not file cases, so the calculator is not enabled.'
              : ' Please sign in or create a client account to estimate the cost of your arbitration.'}
          </div>
          {!user && (
            <div style={{ display: 'flex', gap: 'var(--sp-3)', marginTop: 'var(--sp-4)' }}>
              <Link to="/sign-in" className="btn btn--ghost">{t('nav.signIn')}</Link>
              <Link to="/register" className="btn btn--gold">Create an account</Link>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="section">
      <div className="container narrow">
        <header className="page-head">
          <p className="eyebrow">{t('nav.platform')}</p>
          <h1>{t('fees.title')}</h1>
          <p className="lede">{t('fees.subtitle')}</p>
        </header>

        <form className="card" onSubmit={handleSubmit((v) => mutation.mutate(v))}>
          <div className="grid grid-2">
            <div className="field">
              <label htmlFor="amount">{t('fees.amount')}</label>
              <input id="amount" type="number" min={0} step={1000} className="input" {...register('amountInDispute')} />
            </div>
            <div className="field">
              <label htmlFor="currency">{t('fees.currency')}</label>
              <select id="currency" className="select" {...register('currency')}>
                <option>USD</option><option>EUR</option><option>GBP</option><option>AED</option><option>SAR</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="arbs">{t('fees.arbitrators')}</label>
              <select id="arbs" className="select" {...register('numberOfArbitrators')}>
                <option value={1}>1</option><option value={3}>3</option>
              </select>
            </div>
            <div className="field" style={{ display: 'flex', alignItems: 'flex-end' }}>
              <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <input type="checkbox" {...register('expedited')} /> {t('fees.expedited')}
              </label>
            </div>
          </div>
          <button className="btn btn--primary btn--lg" type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? t('common.loading') : t('fees.calculate')}
          </button>
        </form>

        {mutation.data && (
          <div className="card" style={{ marginTop: 'var(--sp-5)' }}>
            <table className="table">
              <tbody>
                {mutation.data.lines.map((l) => (
                  <tr key={l.category}>
                    <td>{l.label}</td>
                    <td style={{ textAlign: 'end', fontWeight: 600 }}>{fmt(l.amount, mutation.data!.currency)}</td>
                  </tr>
                ))}
                <tr>
                  <td style={{ fontWeight: 700 }}>{t('fees.total')}</td>
                  <td style={{ textAlign: 'end', fontWeight: 700, fontSize: '1.1rem' }}>
                    {fmt(mutation.data.total, mutation.data.currency)}
                  </td>
                </tr>
              </tbody>
            </table>
            <p className="field__hint" style={{ marginTop: 'var(--sp-4)' }}>{mutation.data.disclaimer}</p>
          </div>
        )}
      </div>
    </div>
  );
}
