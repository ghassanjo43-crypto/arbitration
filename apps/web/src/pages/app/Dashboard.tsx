import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CaseSummary } from '@gaap/shared';
import { Permission, Role, canFileCase } from '@gaap/shared';
import { useAuth } from '../../auth/AuthContext';
import { api } from '../../lib/api';

export function Dashboard() {
  const { user, logout } = useAuth();
  const { t } = useTranslation();
  const { data: cases, isLoading } = useQuery<CaseSummary[]>({
    queryKey: ['my-cases'],
    queryFn: async () => (await api.get('/cases')).data,
  });

  const has = (p: Permission) => !!user?.permissions.includes(p);
  const is = (r: Role) => !!user?.roles.includes(r);
  // Filing a case is a PARTY act — only parties/representatives may start one.
  // Arbitrators, registrars, council and admins never file from their account.
  const canFile = !!user && canFileCase(user.roles);
  // Edge case: an account that is BOTH an arbitrator and a party may file, but
  // must be warned about the conflict of acting as a party while sitting (or
  // eligible to sit) as a tribunal member.
  const partyArbitratorConflict = canFile && is(Role.ARBITRATOR);

  return (
    <div className="section">
      <div className="container">
        <div className="dash-head">
          <div>
            <p className="eyebrow">Dashboard</p>
            <h1>Welcome back</h1>
            <p className="muted">{user?.email} · {user?.roles.join(', ')}</p>
          </div>
          <div style={{ display: 'flex', gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
            {has(Permission.CASE_VIEW_QUEUE) && <Link to="/app/desk/registrar" className="btn btn--ghost">{t('desk.registrar')}</Link>}
            {is(Role.ARBITRATOR) && <Link to="/app/desk/arbitrator" className="btn btn--ghost">{t('desk.arbitrator')}</Link>}
            {(has(Permission.INVOICE_MANAGE) || has(Permission.PAYMENT_RECORD)) && <Link to="/app/desk/finance" className="btn btn--ghost">{t('desk.finance')}</Link>}
            {has(Permission.USER_MANAGE) && <Link to="/app/admin/users" className="btn btn--ghost">{t('desk.manageUsers')}</Link>}
            {has(Permission.NEWS_MANAGE) && <Link to="/app/admin/content" className="btn btn--ghost">{t('desk.manageContent')}</Link>}
            {has(Permission.POLICY_MANAGE) && <Link to="/app/admin/rules" className="btn btn--ghost">{t('desk.rulesReview')}</Link>}
            {has(Permission.SETTINGS_MANAGE) && <Link to="/app/admin/retention" className="btn btn--ghost">{t('desk.retention')}</Link>}
            {(has(Permission.USER_MANAGE) || has(Permission.APPOINTMENT_MANAGE) || has(Permission.ARBITRATOR_APPROVE) || has(Permission.CONFLICT_REVIEW)) && <Link to="/app/admin/arbitrators" className="btn btn--ghost">Arbitrator Access</Link>}
            <Link to="/app/roles" className="btn btn--ghost">User Roles</Link>
            {canFile && <Link to="/file-a-case" className="btn btn--gold">{t('desk.fileCase')}</Link>}
            <button className="btn btn--ghost" onClick={() => void logout()}>{t('desk.signOut')}</button>
          </div>
        </div>

        {partyArbitratorConflict && (
          <div className="alert alert--legal" role="note" style={{ marginTop: 'var(--sp-4)' }}>
            <strong>Conflict notice:</strong> this account also holds an arbitrator role. Filing a case here makes you a
            party. You must not act as a party and sit as an arbitrator on the same matter — use a separate party account
            and disclose the relationship.
          </div>
        )}

        {has(Permission.CASE_VIEW_QUEUE) && <RegistrarQueue />}
        {is(Role.ARBITRATOR) && <ArbitratorInvitations />}
        {is(Role.LAWYER) && <LawyerClients />}

        <h2 style={{ marginTop: 'var(--sp-7)' }}>Your cases</h2>
        {isLoading && <p className="muted">Loading…</p>}
        {cases && cases.length === 0 && (
          <div className="empty-state">
            <p>You have no cases yet.</p>
            {canFile && <Link to="/file-a-case" className="btn btn--primary">Start a Notice of Arbitration</Link>}
          </div>
        )}
        {cases && cases.length > 0 && (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <table className="table">
              <thead><tr><th>Reference</th><th>Title</th><th>Stage</th><th>Your role</th><th>Next deadline</th></tr></thead>
              <tbody>
                {cases.map((c) => (
                  <tr key={c.id}>
                    <td><Link to={`/app/cases/${c.id}`}>{c.reference}</Link></td>
                    <td>{c.title}</td>
                    <td><span className="badge badge--info">{c.stage.replaceAll('_', ' ')}</span></td>
                    <td>{c.myCaseRoles.map((r) => r.replaceAll('_', ' ')).join(', ')}</td>
                    <td>{c.nextDeadlineAt ? new Date(c.nextDeadlineAt).toLocaleDateString() : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <PersonalCalendar />
      </div>
    </div>
  );
}

function RegistrarQueue() {
  const { data } = useQuery<{ cases: { id: string; reference: string; title: string; stage: string }[]; statistics: { stage: string; count: number }[] }>({
    queryKey: ['registry-queue'],
    queryFn: async () => (await api.get('/registry/queue')).data,
  });
  return (
    <section style={{ marginTop: 'var(--sp-6)' }}>
      <h2>Registry queue</h2>
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="table">
          <thead><tr><th>Reference</th><th>Title</th><th>Stage</th></tr></thead>
          <tbody>
            {data?.cases.length ? data.cases.map((c) => (
              <tr key={c.id}><td><Link to={`/app/cases/${c.id}`}>{c.reference}</Link></td><td>{c.title}</td><td><span className="badge badge--warning">{c.stage.replaceAll('_', ' ')}</span></td></tr>
            )) : <tr><td colSpan={3}><span className="muted">Queue is clear.</span></td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

interface Invitation {
  id: string;
  caseId: string;
  proposedRole: string;
  status: string;
  case: { reference: string; title: string };
}

const OPEN_STATUSES = ['INVITED', 'CONFLICT_CHECK'];

export function ArbitratorInvitations() {
  const qc = useQueryClient();
  const { data } = useQuery<Invitation[]>({ queryKey: ['my-invitations'], queryFn: async () => (await api.get('/appointments/mine')).data });

  const disclose = useMutation({
    mutationFn: async (id: string) => api.post(`/appointments/${id}/conflict-disclosure`, { hasConflict: false, independenceDeclared: true, impartialityDeclared: true }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['my-invitations'] }),
  });
  const accept = useMutation({
    mutationFn: async (id: string) => api.post(`/appointments/${id}/respond`, { accept: true, feeAccepted: true, availabilityConfirmed: true }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['my-invitations'] }); void qc.invalidateQueries({ queryKey: ['my-cases'] }); },
  });

  return (
    <section style={{ marginTop: 'var(--sp-6)' }}>
      <h2>Appointment invitations</h2>
      {data?.length ? (
        <div className="grid grid-2">
          {data.map((inv) => {
            const isOpen = OPEN_STATUSES.includes(inv.status);
            const isAccepted = inv.status === 'ACCEPTED';
            const isChair = inv.proposedRole === 'CHAIR';
            const caseLink = (tab: string) => `/app/cases/${inv.caseId}?tab=${tab}`;
            return (
              <article key={inv.id} className="card">
                {/* Informational status/role chips — NOT actions. */}
                <div className="arb-card__meta">
                  <span className="field__hint">Status:</span>
                  <span className="badge badge--info" aria-label={`Status ${inv.status}`}>{inv.status}</span>
                  <span className="field__hint" style={{ marginInlineStart: 'var(--sp-2)' }}>Role:</span>
                  <span className="badge badge--gold" aria-label={`Role ${inv.proposedRole}`}>{inv.proposedRole}</span>
                </div>
                <h4 style={{ margin: 'var(--sp-2) 0 4px' }}>{inv.case.title}</h4>
                <p className="field__hint">{inv.case.reference}</p>

                {isChair && isAccepted && (
                  <p className="field__hint"><strong>You are tribunal chair for this case.</strong></p>
                )}

                {/* Actions depend on the invitation state. */}
                <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
                  {isOpen && (
                    <>
                      <button className="btn btn--ghost btn--sm" disabled={disclose.isPending} onClick={() => disclose.mutate(inv.id)}>Declare no conflict</button>
                      <button className="btn btn--primary btn--sm" disabled={accept.isPending} onClick={() => accept.mutate(inv.id)}>Accept appointment</button>
                    </>
                  )}
                  {isAccepted && (
                    <>
                      <Link className="btn btn--primary btn--sm" to={caseLink('tribunal')}>Open case</Link>
                      <Link className="btn btn--ghost btn--sm" to={caseLink('deliberations')}>Open deliberations</Link>
                      <Link className="btn btn--ghost btn--sm" to={caseLink('awards')}>Open awards</Link>
                      {isChair && <Link className="btn btn--ghost btn--sm" to={caseLink('timeline')}>Manage procedural directions</Link>}
                    </>
                  )}
                  {!isOpen && !isAccepted && (
                    <span className="field__hint">No action required.</span>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      ) : <div className="empty-state">No pending invitations.</div>}
    </section>
  );
}

function LawyerClients() {
  const { data } = useQuery<{ clients: { legalName: string; cases: string[] }[]; activeCases: unknown[]; closedCases: unknown[] }>({
    queryKey: ['lawyer-dashboard'],
    queryFn: async () => (await api.get('/lawyers/me/dashboard')).data,
  });
  return (
    <section style={{ marginTop: 'var(--sp-6)' }}>
      <h2>Clients</h2>
      {data?.clients.length ? (
        <div className="grid grid-3">
          {data.clients.map((c) => (
            <article key={c.legalName} className="card"><h4 className="card__title">{c.legalName}</h4><p className="field__hint">{c.cases.join(', ')}</p></article>
          ))}
        </div>
      ) : <div className="empty-state">No clients linked yet.</div>}
    </section>
  );
}

function PersonalCalendar() {
  const { data } = useQuery<{ deadlines: { id: string; title: string; dueAt: string; case: { reference: string } }[]; hearings: { id: string; title: string; scheduledStart: string; case: { reference: string } }[] }>({
    queryKey: ['my-calendar'],
    queryFn: async () => (await api.get('/calendar/mine')).data,
  });
  if (!data || (data.deadlines.length === 0 && data.hearings.length === 0)) return null;
  return (
    <section style={{ marginTop: 'var(--sp-7)' }}>
      <h2>Upcoming</h2>
      <div className="grid grid-2">
        <div className="card">
          <h3 className="card__title">Deadlines</h3>
          <ul className="timeline">
            {data.deadlines.map((d) => (
              <li key={d.id} className="timeline__item"><span className="timeline__dot" aria-hidden="true" /><strong>{d.title}</strong> <span className="muted">— {d.case.reference} · {new Date(d.dueAt).toLocaleDateString()}</span></li>
            ))}
          </ul>
        </div>
        <div className="card">
          <h3 className="card__title">Hearings</h3>
          <ul className="timeline">
            {data.hearings.map((h) => (
              <li key={h.id} className="timeline__item"><span className="timeline__dot" aria-hidden="true" /><strong>{h.title}</strong> <span className="muted">— {h.case.reference} · {new Date(h.scheduledStart).toLocaleString()}</span></li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
