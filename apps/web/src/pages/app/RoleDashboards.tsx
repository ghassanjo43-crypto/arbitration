import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';

// ---------------------------------------------------------------------------
// Shared building blocks
// ---------------------------------------------------------------------------

function StatCard({ label, value, tone = 'info' }: { label: string; value: number | string; tone?: string }) {
  return (
    <article className="card" style={{ textAlign: 'center' }}>
      <div className={`badge badge--${tone}`} style={{ fontSize: '1.5rem', padding: '8px 14px' }}>{value}</div>
      <p className="field__hint" style={{ marginTop: 'var(--sp-2)' }}>{label}</p>
    </article>
  );
}

function CaseTable({ rows, emptyText, adminLinks }: { rows: { id: string; reference: string; title: string; stage: string }[]; emptyText: string; adminLinks?: boolean }) {
  const { t } = useTranslation();
  if (!rows.length) return <p className="muted">{emptyText}</p>;
  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <table className="table">
        <thead><tr><th>{t('dashboards.reference')}</th><th>Title</th><th>Stage</th>{adminLinks && <th></th>}</tr></thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id}>
              <td><Link to={`/app/cases/${c.id}`}>{c.reference}</Link></td>
              <td>{c.title}</td>
              <td><span className="badge badge--info">{c.stage.replaceAll('_', ' ')}</span></td>
              {adminLinks && <td><Link className="btn btn--ghost btn--sm" to={`/app/cases/${c.id}?tab=admin`}>Administer</Link></td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ marginTop: 'var(--sp-6)' }}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Registrar
// ---------------------------------------------------------------------------

interface RegistrarData {
  newFilings: { id: string; reference: string; title: string; stage: string }[];
  deficiencies: { id: string; reference: string; title: string; stage: string }[];
  serviceFailures: { id: string; subject: string; status: string; case: { reference: string } }[];
  deadlines: { overdue: number; dueSoon: number };
  pendingAppointments: number;
  conflictDisclosures: number;
  paymentDefaults: { id: string; amountOutstanding: string; currency: string }[];
  upcomingHearings: { id: string; title: string; scheduledStart: string; case: { reference: string } }[];
  awardsPendingDelivery: { id: string; type: string; signatureStatus: string; case: { reference: string } }[];
}

export function RegistrarDashboard() {
  const { t } = useTranslation();
  const { data, isLoading, error } = useQuery<RegistrarData>({
    queryKey: ['dash-registrar'],
    queryFn: async () => (await api.get('/dashboards/registrar')).data,
  });

  if (isLoading) return <DashShell title={t('dashboards.registrarTitle')}><p className="muted">…</p></DashShell>;
  if (error || !data) return <DashShell title={t('dashboards.registrarTitle')}><p className="muted">{t('dashboards.empty')}</p></DashShell>;

  return (
    <DashShell title={t('dashboards.registrarTitle')}>
      <div className="grid grid-4">
        <StatCard label={t('dashboards.overdue')} value={data.deadlines.overdue} tone={data.deadlines.overdue ? 'danger' : 'info'} />
        <StatCard label={t('dashboards.dueSoon')} value={data.deadlines.dueSoon} />
        <StatCard label={t('dashboards.pendingAppointments')} value={data.pendingAppointments} />
        <StatCard label={t('dashboards.conflictDisclosures')} value={data.conflictDisclosures} />
      </div>

      <p className="field__hint" style={{ marginTop: 'var(--sp-4)' }}>
        Open any case and use its <strong>Administration</strong> tab to edit administrative details, update the stage,
        record notes, manage filings, notices/service, the procedural calendar and tribunal appointment.
      </p>
      <Section title={t('dashboards.newFilings')}><CaseTable rows={data.newFilings} emptyText={t('dashboards.empty')} adminLinks /></Section>
      <Section title={t('dashboards.deficiencies')}><CaseTable rows={data.deficiencies} emptyText={t('dashboards.empty')} adminLinks /></Section>

      <Section title={t('dashboards.serviceFailures')}>
        {data.serviceFailures.length ? (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <table className="table">
              <thead><tr><th>{t('dashboards.reference')}</th><th>{t('dashboards.subject')}</th><th>{t('dashboards.status')}</th></tr></thead>
              <tbody>{data.serviceFailures.map((n) => (
                <tr key={n.id}><td>{n.case.reference}</td><td>{n.subject}</td><td><span className="badge badge--danger">{n.status.replaceAll('_', ' ')}</span></td></tr>
              ))}</tbody>
            </table>
          </div>
        ) : <p className="muted">{t('dashboards.empty')}</p>}
      </Section>

      <Section title={t('dashboards.paymentDefaults')}>
        {data.paymentDefaults.length ? (
          <ul className="timeline">{data.paymentDefaults.map((p) => (
            <li key={p.id} className="timeline__item"><span className="timeline__dot" aria-hidden="true" /><strong>{p.currency} {p.amountOutstanding}</strong> <span className="muted">— {t('dashboards.open')}</span></li>
          ))}</ul>
        ) : <p className="muted">{t('dashboards.empty')}</p>}
      </Section>

      <Section title={t('dashboards.upcomingHearings')}>
        {data.upcomingHearings.length ? (
          <ul className="timeline">{data.upcomingHearings.map((h) => (
            <li key={h.id} className="timeline__item"><span className="timeline__dot" aria-hidden="true" /><strong>{h.title}</strong> <span className="muted">— {h.case.reference} · {new Date(h.scheduledStart).toLocaleString()}</span></li>
          ))}</ul>
        ) : <p className="muted">{t('dashboards.empty')}</p>}
      </Section>

      <Section title={t('dashboards.awardsPendingDelivery')}>
        {data.awardsPendingDelivery.length ? (
          <ul className="timeline">{data.awardsPendingDelivery.map((a) => (
            <li key={a.id} className="timeline__item"><span className="timeline__dot" aria-hidden="true" /><strong>{a.case.reference}</strong> <span className="muted">— {a.type.replaceAll('_', ' ')} · {a.signatureStatus}</span></li>
          ))}</ul>
        ) : <p className="muted">{t('dashboards.empty')}</p>}
      </Section>
    </DashShell>
  );
}

// ---------------------------------------------------------------------------
// Arbitrator
// ---------------------------------------------------------------------------

interface ArbitratorData {
  invitations: { id: string; proposedRole: string; status: string; case: { reference: string; title: string } }[];
  deadlines: { id: string; title: string; dueAt: string; status: string; case: { reference: string } }[];
  hearings: { id: string; title: string; scheduledStart: string; case: { reference: string } }[];
  draftAwards: { id: string; type: string; signatureStatus: string; case: { reference: string } }[];
}

export function ArbitratorDashboard() {
  const { t } = useTranslation();
  const { data, isLoading } = useQuery<ArbitratorData>({
    queryKey: ['dash-arbitrator'],
    queryFn: async () => (await api.get('/dashboards/arbitrator')).data,
  });
  if (isLoading || !data) return <DashShell title={t('dashboards.arbitratorTitle')}><p className="muted">…</p></DashShell>;

  return (
    <DashShell title={t('dashboards.arbitratorTitle')}>
      <Section title={t('dashboards.invitations')}>
        {data.invitations.length ? (
          <div className="grid grid-2">{data.invitations.map((inv) => (
            <article key={inv.id} className="card">
              <div className="arb-card__meta"><span className="badge badge--info">{inv.status}</span><span className="badge">{inv.proposedRole}</span></div>
              <h4 style={{ margin: 'var(--sp-2) 0 4px' }}>{inv.case.title}</h4>
              <p className="field__hint">{inv.case.reference}</p>
            </article>
          ))}</div>
        ) : <p className="muted">{t('dashboards.empty')}</p>}
      </Section>

      <Section title={t('dashboards.deadlines')}>
        {data.deadlines.length ? (
          <ul className="timeline">{data.deadlines.map((d) => (
            <li key={d.id} className="timeline__item"><span className="timeline__dot" aria-hidden="true" /><strong>{d.title}</strong> <span className="muted">— {d.case.reference} · {new Date(d.dueAt).toLocaleDateString()}</span> {d.status === 'OVERDUE' && <span className="badge badge--danger">{t('dashboards.overdue')}</span>}</li>
          ))}</ul>
        ) : <p className="muted">{t('dashboards.empty')}</p>}
      </Section>

      <Section title={t('dashboards.hearings')}>
        {data.hearings.length ? (
          <ul className="timeline">{data.hearings.map((h) => (
            <li key={h.id} className="timeline__item"><span className="timeline__dot" aria-hidden="true" /><strong>{h.title}</strong> <span className="muted">— {h.case.reference} · {new Date(h.scheduledStart).toLocaleString()}</span></li>
          ))}</ul>
        ) : <p className="muted">{t('dashboards.empty')}</p>}
      </Section>

      <Section title={t('dashboards.draftAwards')}>
        {data.draftAwards.length ? (
          <ul className="timeline">{data.draftAwards.map((a) => (
            <li key={a.id} className="timeline__item"><span className="timeline__dot" aria-hidden="true" /><strong>{a.case.reference}</strong> <span className="muted">— {a.type.replaceAll('_', ' ')} · {a.signatureStatus}</span></li>
          ))}</ul>
        ) : <p className="muted">{t('dashboards.empty')}</p>}
      </Section>
    </DashShell>
  );
}

// ---------------------------------------------------------------------------
// Finance
// ---------------------------------------------------------------------------

interface FinanceData {
  deposits: { status: string; count: number }[];
  invoices: { status: string; count: number }[];
  outstandingByCurrency: Record<string, number>;
  substitutePayments: { id: string; amount: string; currency: string; receiptNumber: string; createdAt: string }[];
  refunds: { id: string; amount: string; currency: string; status: string; createdAt: string }[];
  ledger: { id: string; kind: string; description: string; amount: string; currency: string; createdAt: string }[];
}

export function FinanceDashboard() {
  const { t } = useTranslation();
  const { data, isLoading } = useQuery<FinanceData>({
    queryKey: ['dash-finance'],
    queryFn: async () => (await api.get('/dashboards/finance')).data,
  });
  if (isLoading || !data) return <DashShell title={t('dashboards.financeTitle')}><p className="muted">…</p></DashShell>;

  return (
    <DashShell title={t('dashboards.financeTitle')}>
      <Section title={t('dashboards.outstanding')}>
        {Object.keys(data.outstandingByCurrency).length ? (
          <div className="grid grid-4">{Object.entries(data.outstandingByCurrency).map(([cur, amt]) => (
            <StatCard key={cur} label={cur} value={amt.toLocaleString()} tone="warning" />
          ))}</div>
        ) : <p className="muted">{t('dashboards.empty')}</p>}
      </Section>

      <div className="grid grid-2">
        <Section title={t('dashboards.deposits')}>
          {data.deposits.length ? <ul className="timeline">{data.deposits.map((d) => (
            <li key={d.status} className="timeline__item"><span className="timeline__dot" aria-hidden="true" /><strong>{d.count}</strong> <span className="muted">— {d.status.replaceAll('_', ' ')}</span></li>
          ))}</ul> : <p className="muted">{t('dashboards.empty')}</p>}
        </Section>
        <Section title={t('dashboards.invoices')}>
          {data.invoices.length ? <ul className="timeline">{data.invoices.map((i) => (
            <li key={i.status} className="timeline__item"><span className="timeline__dot" aria-hidden="true" /><strong>{i.count}</strong> <span className="muted">— {i.status.replaceAll('_', ' ')}</span></li>
          ))}</ul> : <p className="muted">{t('dashboards.empty')}</p>}
        </Section>
      </div>

      <Section title={t('dashboards.substitutePayments')}>
        {data.substitutePayments.length ? <ul className="timeline">{data.substitutePayments.map((p) => (
          <li key={p.id} className="timeline__item"><span className="timeline__dot" aria-hidden="true" /><strong>{p.currency} {p.amount}</strong> <span className="muted">— {p.receiptNumber} · {new Date(p.createdAt).toLocaleDateString()}</span></li>
        ))}</ul> : <p className="muted">{t('dashboards.empty')}</p>}
      </Section>

      <Section title={t('dashboards.refunds')}>
        {data.refunds.length ? <ul className="timeline">{data.refunds.map((r) => (
          <li key={r.id} className="timeline__item"><span className="timeline__dot" aria-hidden="true" /><strong>{r.currency} {r.amount}</strong> <span className="muted">— {r.status}</span></li>
        ))}</ul> : <p className="muted">{t('dashboards.empty')}</p>}
      </Section>

      <Section title={t('dashboards.ledger')}>
        {data.ledger.length ? (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <table className="table">
              <thead><tr><th>{t('dashboards.status')}</th><th>Description</th><th>{t('dashboards.amount')}</th></tr></thead>
              <tbody>{data.ledger.map((l) => (
                <tr key={l.id}><td><span className="badge">{l.kind.replaceAll('_', ' ')}</span></td><td>{l.description}</td><td>{l.currency} {l.amount}</td></tr>
              ))}</tbody>
            </table>
          </div>
        ) : <p className="muted">{t('dashboards.empty')}</p>}
      </Section>
    </DashShell>
  );
}

// ---------------------------------------------------------------------------

function DashShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="section">
      <div className="container">
        <div className="dash-head">
          <div>
            <p className="eyebrow">Dashboard</p>
            <h1>{title}</h1>
          </div>
          <Link to="/app" className="btn btn--ghost">← Dashboard</Link>
        </div>
        {children}
      </div>
    </div>
  );
}
