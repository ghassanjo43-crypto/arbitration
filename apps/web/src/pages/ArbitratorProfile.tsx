import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ARBITRATION_FIELD_LABELS, ArbitrationField } from '@gaap/shared';
import { api } from '../lib/api';

interface ArbitratorFull {
  id: string;
  fullName: string;
  professionalTitle?: string;
  nationality?: string;
  countryOfResidence?: string;
  biography?: string;
  qualifications?: string;
  yearsExperience?: number;
  casesAsSole: number;
  casesAsChair: number;
  casesAsCoArbitrator: number;
  familiarRules: string[];
  jurisdictions: string[];
  feeBand: string;
  availability: string;
  memberships?: string[];
  publications?: string[];
  verificationStatus: string;
  legalFields: string[];
  industries: string[];
  languages: string[];
}

function label(f: string) {
  return ARBITRATION_FIELD_LABELS[f as ArbitrationField] ?? f.replaceAll('_', ' ');
}

export function ArbitratorProfile() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const { data, isLoading, isError } = useQuery<ArbitratorFull>({
    queryKey: ['arbitrator', id],
    queryFn: async () => (await api.get(`/arbitrators/${id}`)).data,
    enabled: !!id,
  });

  if (isLoading) return <div className="section"><div className="container"><p className="muted">{t('common.loading')}</p></div></div>;
  if (isError || !data) return <div className="section"><div className="container"><div className="empty-state">{t('common.noResults')}</div></div></div>;

  return (
    <>
      <header className="page-banner">
        <div className="container">
          <Link to="/arbitrators" className="muted-light">← {t('directory.title')}</Link>
          <div className="profile-head">
            <div className="arb-avatar arb-avatar--lg" aria-hidden="true">
              {data.fullName.split(' ').map((n) => n[0]).slice(0, 2).join('')}
            </div>
            <div>
              <h1 style={{ marginBottom: 4 }}>{data.fullName}</h1>
              <p className="lede" style={{ margin: 0 }}>{data.professionalTitle}</p>
              <div className="arb-card__meta" style={{ marginTop: 'var(--sp-3)' }}>
                {data.verificationStatus === 'VERIFIED' && <span className="badge badge--success">Verified</span>}
                <span className="badge badge--gold">{data.feeBand}</span>
                <span className={`badge ${data.availability === 'AVAILABLE' ? 'badge--success' : 'badge--warning'}`}>{data.availability}</span>
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="section"><div className="container">
        <div className="directory-layout">
          <aside className="card" style={{ position: 'sticky', top: 96 }}>
            <dl className="kv">
              <div><dt>Nationality</dt><dd>{data.nationality ?? '—'}</dd></div>
              <div><dt>Residence</dt><dd>{data.countryOfResidence ?? '—'}</dd></div>
              <div><dt>Experience</dt><dd>{data.yearsExperience ?? '—'} yrs</dd></div>
              <div><dt>As chair</dt><dd>{data.casesAsChair}</dd></div>
              <div><dt>As sole</dt><dd>{data.casesAsSole}</dd></div>
              <div><dt>As co-arbitrator</dt><dd>{data.casesAsCoArbitrator}</dd></div>
            </dl>
            <hr className="rule" />
            <h4 className="site-footer__heading" style={{ color: 'var(--accent)' }}>Languages</h4>
            <div className="arb-card__fields">{data.languages.map((l) => <span key={l} className="badge">{l}</span>)}</div>
          </aside>

          <div>
            {data.biography && <><h2>Biography</h2><p className="muted">{data.biography}</p></>}
            {data.qualifications && <><h3>Qualifications</h3><p className="muted">{data.qualifications}</p></>}

            <h3>Legal specialisations</h3>
            <div className="arb-card__fields">{data.legalFields.map((f) => <span key={f} className="badge badge--gold">{label(f)}</span>)}</div>

            {data.industries.length > 0 && <>
              <h3 style={{ marginTop: 'var(--sp-5)' }}>Industry specialisations</h3>
              <div className="arb-card__fields">{data.industries.map((f) => <span key={f} className="badge badge--info">{label(f)}</span>)}</div>
            </>}

            <div className="grid grid-2" style={{ marginTop: 'var(--sp-5)' }}>
              <div className="card">
                <h4 className="card__title">Familiar rules & jurisdictions</h4>
                <div className="arb-card__fields">
                  {data.familiarRules.map((r) => <span key={r} className="badge">{r}</span>)}
                  {data.jurisdictions.map((j) => <span key={j} className="badge">{j}</span>)}
                </div>
              </div>
              {(data.memberships?.length || data.publications?.length) ? (
                <div className="card">
                  <h4 className="card__title">Professional standing</h4>
                  <ul className="prose" style={{ paddingInlineStart: '1.2rem' }}>
                    {data.memberships?.map((m) => <li key={m}>{m}</li>)}
                    {data.publications?.map((p) => <li key={p}><em>{p}</em></li>)}
                  </ul>
                </div>
              ) : null}
            </div>

            <div className="alert alert--legal" style={{ marginTop: 'var(--sp-6)' }}>
              Listing on the panel reflects administrative verification only. Appointment,
              independence, and impartiality are matters for the parties and the tribunal in each case.
            </div>
          </div>
        </div>
      </div></div>
    </>
  );
}
