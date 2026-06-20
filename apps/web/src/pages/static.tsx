import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ENFORCEMENT_WORDING,
  LEGAL_ADVICE_DISCLAIMER,
  MODEL_ARBITRATION_CLAUSE,
  ADMINISTRATION_VS_DECISION,
} from '@gaap/shared';
import { PageHeader } from '../components/PageHeader';

function Prose({ children }: { children: React.ReactNode }) {
  return <div className="section"><div className="container narrow prose">{children}</div></div>;
}

export function About() {
  return (
    <>
      <PageHeader eyebrow="About" title="About the Panel" lede="An institution dedicated to the secure, efficient administration of international ad hoc arbitration." />
      <Prose>
        <p>{ADMINISTRATION_VS_DECISION}</p>
        <h2>Our role</h2>
        <p>The operating company provides technology infrastructure, administrative case-management services, access to a panel of prominent arbitrators, secure document storage, online hearings, payment and fee administration, notifications and procedural calendars, and legal news.</p>
        <h2>Our limits</h2>
        <p>We do not interfere with the independence of arbitrators or the merits of any dispute, and we do not decide jurisdiction. Those matters rest entirely with the tribunal.</p>
      </Prose>
    </>
  );
}

export function HowItWorks() {
  return (
    <>
      <PageHeader eyebrow="Process" title="How Arbitration Works" lede="From the Notice of Arbitration to the final award — administered end to end." />
      <Prose>
        <ol>
          <li><strong>Agreement to arbitrate.</strong> Parties agree to arbitration by clause or by a post-dispute submission agreement.</li>
          <li><strong>Filing.</strong> The claimant files a Notice of Arbitration through the portal.</li>
          <li><strong>Administrative review and service.</strong> The registrar reviews and registers the case and serves the respondent.</li>
          <li><strong>Constitution of the tribunal.</strong> Arbitrators are nominated, conflicts are checked, and appointments are accepted.</li>
          <li><strong>Proceedings.</strong> Parties exchange pleadings and evidence and attend hearings under a procedural timetable.</li>
          <li><strong>Award.</strong> The tribunal deliberates independently and issues a reasoned award.</li>
        </ol>
      </Prose>
    </>
  );
}

export function Rules() {
  return (
    <>
      <PageHeader eyebrow="Procedure" title="Arbitration Rules" lede="A modern framework for online ad hoc arbitration that preserves party autonomy." />
      <Prose>
        <p>These illustrative rules are configurable per case. Parties may adopt them in whole or in part, or agree their own procedure.</p>
        <h2>Key principles</h2>
        <ul>
          <li>Party autonomy over seat, language, governing law, and tribunal composition.</li>
          <li>Equal treatment of the parties and a full opportunity to be heard.</li>
          <li>Independence and impartiality of arbitrators, with mandatory conflict disclosure.</li>
          <li>Confidentiality of submissions, deliberations, and awards.</li>
        </ul>
        <p>
          <a className="btn btn--primary" href="/rules/full">Read the full versioned rules (English &amp; Arabic)</a>
        </p>
      </Prose>
    </>
  );
}

export function ModelClause() {
  return (
    <>
      <PageHeader eyebrow="Resources" title="Model Arbitration Clause" lede="Suggested wording for inclusion in your contract." />
      <div className="section"><div className="container narrow">
        <blockquote className="model-clause">{MODEL_ARBITRATION_CLAUSE}</blockquote>
        <div className="alert alert--legal"><strong>{ENFORCEMENT_WORDING}</strong></div>
        <div className="alert alert--danger" style={{ marginTop: 'var(--sp-4)' }}>{LEGAL_ADVICE_DISCLAIMER}</div>
      </div></div>
    </>
  );
}

export function SubmissionAgreement() {
  const sections = [
    'Identity of the parties', 'Description of the dispute', 'Scope of the arbitration', 'Applicable rules',
    'Seat of arbitration', 'Governing law', 'Language of the proceedings', 'Number of arbitrators',
    'Appointment process', 'Consent to online hearings', 'Consent to electronic service',
    'Confidentiality undertakings', 'Fees and their allocation', 'Final and binding award', 'Digital signatures',
  ];
  return (
    <>
      <PageHeader eyebrow="Resources" title="Model Submission Agreement" lede="A structured post-dispute agreement to submit an existing dispute to arbitration." />
      <div className="section"><div className="container narrow">
        <ol className="prose">{sections.map((s) => <li key={s}>{s}</li>)}</ol>
        <div className="alert alert--legal"><strong>{ENFORCEMENT_WORDING}</strong></div>
        <div className="alert alert--danger" style={{ marginTop: 'var(--sp-4)' }}>{LEGAL_ADVICE_DISCLAIMER}</div>
      </div></div>
    </>
  );
}

export function Faq() {
  const items = [
    { q: 'Does the platform decide my dispute?', a: 'No. The platform administers the proceedings. The tribunal alone decides jurisdiction and the merits.' },
    { q: 'Are awards enforceable everywhere?', a: 'Awards are intended to be final and binding and may be recognised and enforced subject to applicable law, international conventions, public policy, due process, and the law of the enforcement jurisdiction. Enforcement is never guaranteed in every jurisdiction.' },
    { q: 'Is the process confidential?', a: 'Yes. Access is controlled per case and per document, and tribunal deliberations are isolated from parties and administrators.' },
    { q: 'Can I file without a lawyer?', a: 'Individuals and companies may file directly, or instruct a lawyer to file and represent them.' },
  ];
  return (
    <>
      <PageHeader eyebrow="Help" title="Frequently Asked Questions" />
      <div className="section"><div className="container narrow">
        {items.map((i) => (
          <details key={i.q} className="faq-item">
            <summary>{i.q}</summary>
            <p className="muted">{i.a}</p>
          </details>
        ))}
      </div></div>
    </>
  );
}

export function Contact() {
  const [sent, setSent] = useState(false);
  return (
    <>
      <PageHeader eyebrow="Contact" title="Contact the Registry" lede="For procedural and administrative enquiries. Do not send confidential case material through this form." />
      <div className="section"><div className="container narrow">
        {sent ? (
          <div className="alert">Thank you. The registry will respond to administrative enquiries in due course.</div>
        ) : (
          <form className="card" onSubmit={(e) => { e.preventDefault(); setSent(true); }}>
            <div className="field"><label htmlFor="cn">Name</label><input id="cn" className="input" required /></div>
            <div className="field"><label htmlFor="ce">Email</label><input id="ce" type="email" className="input" required /></div>
            <div className="field"><label htmlFor="cm">Message</label><textarea id="cm" className="textarea" rows={5} required /></div>
            <button className="btn btn--primary" type="submit">Send enquiry</button>
          </form>
        )}
      </div></div>
    </>
  );
}

export function Privacy() {
  return (
    <>
      <PageHeader eyebrow="Trust" title="Privacy & Security" lede="How we protect your data and the confidentiality of proceedings." />
      <Prose>
        <h2>Security measures</h2>
        <ul>
          <li>Role-based and case-based access control.</li>
          <li>Encryption in transit and an encryption-at-rest abstraction for stored files.</li>
          <li>Signed, time-limited URLs for document access; confidential files are never served publicly.</li>
          <li>An immutable audit trail of every sensitive action.</li>
          <li>Argon2id password hashing, refresh-token rotation, account lockout, and login-history monitoring.</li>
        </ul>
        <h2>Confidentiality</h2>
        <p>Tribunal deliberations are accessible only to appointed tribunal members of the relevant case — never to parties, lawyers, registrars, administrators, or senior management.</p>
      </Prose>
    </>
  );
}

export function Terms() {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader eyebrow="Legal" title="Terms & Conditions" />
      <Prose>
        <p>{t('legal.adminVsDecision')}</p>
        <p>{t('legal.noGuarantee')}</p>
        <p>Use of the portal constitutes acceptance of electronic service where consented, and acknowledgement that the filing fee may be non-refundable where applicable.</p>
      </Prose>
    </>
  );
}

export function NotFound() {
  return (
    <div className="section"><div className="container center">
      <h1>404</h1>
      <p className="lede mx-auto">The page you requested could not be found.</p>
    </div></div>
  );
}
