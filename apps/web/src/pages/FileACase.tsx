import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { FILING_CAPACITIES, canFileCase } from '@gaap/shared';
import { useAuth } from '../auth/AuthContext';
import { PageHeader } from '../components/PageHeader';
import { api } from '../lib/api';

const STEPS = [
  'Filing capacity', 'Claimant information', 'Respondent information', 'Arbitration agreement',
  'Dispute information', 'Arbitrator selection', 'Documents', 'Fees', 'Declaration & submission',
];

const CAPACITY_LABELS: Record<string, string> = {
  INDIVIDUAL_PERSONAL: 'Individual filing personally',
  COMPANY_DIRECT: 'Company filing directly',
  LAWYER_FOR_INDIVIDUAL: 'Lawyer filing for an individual',
  LAWYER_FOR_COMPANY: 'Lawyer filing for a company',
  MULTIPLE_CLAIMANTS: 'Multiple claimants',
  OTHER_AUTHORISED_REPRESENTATIVE: 'Other authorised representative',
};

interface DraftForm {
  filingCapacity: string;
  title: string;
  claimantName: string;
  respondentName: string;
  category: string;
  seat: string;
  language: string;
}

export function FileACase() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [active, setActive] = useState(0);
  const { register, handleSubmit, formState: { errors } } = useForm<DraftForm>({
    defaultValues: { filingCapacity: 'INDIVIDUAL_PERSONAL', language: 'en' },
  });

  const mutation = useMutation({
    mutationFn: async (form: DraftForm) => {
      const res = await api.post('/cases/draft', {
        title: form.title,
        filingCapacity: form.filingCapacity,
        category: form.category || undefined,
        seat: form.seat || undefined,
        language: form.language,
        claimants: form.claimantName ? [{ legalName: form.claimantName }] : [],
        respondents: form.respondentName ? [{ legalName: form.respondentName }] : [],
      });
      return res.data as { id: string };
    },
    onSuccess: (data) => navigate(`/app/cases/${data.id}`),
  });

  if (!user) {
    return (
      <>
        <PageHeader eyebrow="File a Case" title="Notice of Arbitration" lede="Sign in or create an account to begin a filing. Your progress is saved as a draft." />
        <div className="section"><div className="container narrow">
          <div className="alert alert--legal">
            To protect the confidentiality of filings, a verified account is required. Please{' '}
            <a href="/sign-in">sign in</a> or <a href="/register">create an account</a> to continue.
          </div>
        </div></div>
      </>
    );
  }

  // Role separation: only parties/representatives may file. An arbitrator,
  // registrar, council or admin account must not initiate a case. This mirrors
  // the API guard so a directly-navigated URL is also blocked (the API rejects
  // it regardless), and the dashboard hides the entry point.
  if (!canFileCase(user.roles)) {
    return (
      <>
        <PageHeader eyebrow="File a Case" title="Notice of Arbitration" lede="Filing is reserved for parties and their authorized representatives." />
        <div className="section"><div className="container narrow">
          <div className="alert alert--legal" role="alert">
            Only claimants, company parties, or authorized representatives may file a case. Your account does not hold a
            party or representative role, so it cannot initiate an arbitration. If you also act as a party, please use a
            separate party account to avoid any conflict with a tribunal or institutional role.
          </div>
          <Link to="/app" className="btn btn--ghost" style={{ marginTop: 'var(--sp-4)' }}>← Back to dashboard</Link>
        </div></div>
      </>
    );
  }

  return (
    <>
      <PageHeader eyebrow="File a Case" title="Notice of Arbitration" lede="A guided, multi-step filing. You can save a draft and return at any time." />
      <div className="section"><div className="container">
        {/* Appears only once the user has started filling in the filing. */}
        {active >= 1 && (
          <p style={{ marginBottom: 'var(--sp-5)' }}>
            <Link to="/fee-calculator" className="btn btn--ghost">Estimate fees with the fee calculator →</Link>
          </p>
        )}
        <div className="filing-layout">
          <ol className="filing-steps" aria-label="Filing steps">
            {STEPS.map((s, i) => (
              <li key={s} className={`filing-steps__item ${i === active ? 'is-active' : ''} ${i < active ? 'is-done' : ''}`}>
                <button type="button" onClick={() => setActive(i)}><span>{i + 1}</span>{s}</button>
              </li>
            ))}
          </ol>

          <form className="card filing-form" onSubmit={handleSubmit((f) => mutation.mutate(f))}>
            <h2>{STEPS[active]}</h2>

            {active === 0 && (
              <div className="field">
                <label htmlFor="cap">In what capacity are you filing?</label>
                <select id="cap" className="select" {...register('filingCapacity')}>
                  {FILING_CAPACITIES.map((c) => <option key={c} value={c}>{CAPACITY_LABELS[c]}</option>)}
                </select>
                <p className="field__hint">This determines the information requested in later steps.</p>
              </div>
            )}

            {active === 1 && (
              <>
                <div className="field">
                  <label htmlFor="title">Dispute title</label>
                  <input id="title" className="input" {...register('title', { required: 'A title is required.' })} />
                  {errors.title && <p className="field__error">{errors.title.message}</p>}
                </div>
                <div className="field">
                  <label htmlFor="claimant">Claimant legal name</label>
                  <input id="claimant" className="input" {...register('claimantName')} />
                </div>
              </>
            )}

            {active === 2 && (
              <div className="field">
                <label htmlFor="respondent">Respondent legal name</label>
                <input id="respondent" className="input" {...register('respondentName')} />
                <p className="field__hint">Additional respondents can be added after the draft is created.</p>
              </div>
            )}

            {active === 3 && (
              <div className="field">
                <label htmlFor="seat">Proposed seat of arbitration</label>
                <input id="seat" className="input" placeholder="e.g. London, United Kingdom" {...register('seat')} />
              </div>
            )}

            {active >= 4 && (
              <div className="alert alert--legal">
                Steps 5–9 (dispute particulars, arbitrator selection, documents, fees, and declarations) become
                available in the case workspace once your draft is created. Create the draft to continue.
              </div>
            )}

            <div className="field">
              <label htmlFor="cat">Category / industry (optional)</label>
              <input id="cat" className="input" {...register('category')} />
            </div>

            <div className="filing-nav">
              <button type="button" className="btn btn--ghost" disabled={active === 0} onClick={() => setActive((a) => a - 1)}>Back</button>
              {active < STEPS.length - 1 ? (
                <button type="button" className="btn btn--primary" onClick={() => setActive((a) => a + 1)}>Continue</button>
              ) : (
                <button type="submit" className="btn btn--gold" disabled={mutation.isPending}>
                  {mutation.isPending ? 'Saving…' : 'Create draft'}
                </button>
              )}
            </div>
            {mutation.isError && <div className="alert alert--danger">Could not create the draft. Please check the form.</div>}
          </form>
        </div>
      </div></div>
    </>
  );
}
