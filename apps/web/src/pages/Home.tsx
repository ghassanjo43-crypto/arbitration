import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ARBITRATION_FIELD_LABELS } from '@gaap/shared';

const BENEFITS = [
  { title: 'Neutral & international', body: 'A cross-border forum designed for parties from different jurisdictions, free from any single national court.' },
  { title: 'Party autonomy', body: 'You choose the rules, seat, language, and tribunal. The platform administers; it never decides the merits.' },
  { title: 'Confidential by design', body: 'Granular, case-level access controls keep submissions, deliberations, and awards strictly compartmentalised.' },
  { title: 'Fully online', body: 'File, exchange submissions, attend hearings, and receive awards through one secure portal.' },
];

const PROCESS = [
  { step: '01', title: 'File a Notice of Arbitration', body: 'Complete a guided submission. Save drafts and return at any time.' },
  { step: '02', title: 'Administrative review & service', body: 'The registrar reviews the filing, registers the case, and serves notice on the respondent.' },
  { step: '03', title: 'Constitute the tribunal', body: 'Parties nominate, conflicts are checked, and arbitrators accept their appointment.' },
  { step: '04', title: 'Conduct the proceedings', body: 'Exchange pleadings and evidence, hold online hearings, and follow the procedural timetable.' },
  { step: '05', title: 'Receive the award', body: 'The tribunal deliberates independently and issues a reasoned award through the portal.' },
];

const SECURITY = [
  'Role-based and case-based access control',
  'Tribunal deliberations isolated from parties and administrators',
  'Encrypted storage and signed, time-limited document access',
  'Immutable audit trail of every sensitive action',
];

export function Home() {
  const { t } = useTranslation();
  const featuredFields = Object.entries(ARBITRATION_FIELD_LABELS).slice(0, 12);

  return (
    <div className="home">
      {/* Hero */}
      <section className="hero">
        <div className="container hero__inner">
          <p className="eyebrow hero__eyebrow">{t('home.heroEyebrow')}</p>
          <h1 className="hero__title">{t('home.heroTitle')}</h1>
          <p className="hero__subtitle">{t('home.heroSubtitle')}</p>
          <div className="hero__actions">
            <Link to="/file-a-case" className="btn btn--gold btn--lg">{t('common.fileCaseCta')}</Link>
            <Link to="/arbitrators" className="btn btn--on-dark btn--lg">{t('common.viewArbitrators')}</Link>
          </div>
          <dl className="hero__stats">
            <div><dt>38</dt><dd>procedural stages administered end-to-end</dd></div>
            <div><dt>28</dt><dd>fields of arbitration expertise</dd></div>
            <div><dt>2</dt><dd>working languages, full RTL support</dd></div>
          </dl>
        </div>
      </section>

      {/* Explanation */}
      <section className="section">
        <div className="container grid grid-2 explain">
          <div>
            <p className="eyebrow">{t('home.explainTitle')}</p>
            <h2>{t('home.explainBody')}</h2>
          </div>
          <div className="alert alert--legal">{t('legal.adminVsDecision')}</div>
        </div>
      </section>

      {/* Benefits */}
      <section className="section section--tight bg-raised">
        <div className="container">
          <h2 className="center">{t('home.benefitsTitle')}</h2>
          <div className="grid grid-4" style={{ marginTop: 'var(--sp-6)' }}>
            {BENEFITS.map((b) => (
              <article key={b.title} className="card card--interactive">
                <h3 className="card__title">{b.title}</h3>
                <p className="muted">{b.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* Process */}
      <section className="section">
        <div className="container">
          <h2 className="center">{t('home.processTitle')}</h2>
          <ol className="process">
            {PROCESS.map((p) => (
              <li key={p.step} className="process__item">
                <span className="process__step">{p.step}</span>
                <div>
                  <h3 className="process__title">{p.title}</h3>
                  <p className="muted">{p.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Expertise */}
      <section className="section section--tight bg-raised">
        <div className="container">
          <h2 className="center">{t('home.expertiseTitle')}</h2>
          <div className="field-grid">
            {featuredFields.map(([key, label]) => (
              <Link key={key} to={`/arbitrators?legalField=${key}`} className="field-tag">{label}</Link>
            ))}
            <Link to="/arbitrators" className="field-tag field-tag--more">{t('common.learnMore')} →</Link>
          </div>
        </div>
      </section>

      {/* Security */}
      <section className="section">
        <div className="container grid grid-2 security">
          <div>
            <p className="eyebrow">{t('home.securityTitle')}</p>
            <h2>Confidentiality is enforced, not promised.</h2>
            <p className="muted">
              Access is decided per case and per document. Even system administrators cannot read tribunal
              deliberations unless they are appointed members of that tribunal.
            </p>
          </div>
          <ul className="checklist">
            {SECURITY.map((s) => (
              <li key={s}><span aria-hidden="true" className="checklist__mark">✓</span>{s}</li>
            ))}
          </ul>
        </div>
      </section>

      {/* Final CTA */}
      <section className="final-cta">
        <div className="container center">
          <h2 className="final-cta__title">{t('home.finalCtaTitle')}</h2>
          <p className="lede mx-auto">{t('home.finalCtaBody')}</p>
          <div className="hero__actions" style={{ justifyContent: 'center' }}>
            <Link to="/file-a-case" className="btn btn--gold btn--lg">{t('common.fileCaseCta')}</Link>
            <Link to="/how-it-works" className="btn btn--on-dark btn--lg">{t('nav.howItWorks')}</Link>
          </div>
        </div>
      </section>
    </div>
  );
}
