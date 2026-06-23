import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../lib/api';

// ---- Types mirroring GET /cases/:id/appointments/overview ----
interface Member {
  id: string; arbitratorUserId: string; displayName: string; role: string; status: string;
  nominatedBy: string | null; acceptedAt: string | null; vacatedAt: string | null; vacancyReason: string | null;
}
interface Invitation {
  id: string; arbitratorId: string; arbitratorName: string; proposedRole: string; nominatedBy: string | null;
  appointmentMethod: string; status: string; reminderCount: number; lastReminderAt: string | null;
  declineReason: string | null; fillsVacancyUserId: string | null; disclosureFiled: boolean;
  responseDeadline: { dueAt: string | null; status: string | null; source: 'RULE' | 'FALLBACK' };
}
interface Challenge {
  id: string; challengedArbitratorUserId: string; challengedName: string; status: string;
  grounds: string; decidedAt: string | null; decisionNote: string | null;
}
interface Overview {
  composition: string | null; constituted: boolean; pendingChallenge: boolean;
  complianceHold: { active: boolean; reason: string | null };
  members: Member[]; invitations: Invitation[]; challenges: Challenge[];
  viewer: { canManage: boolean; canDecideChallenge: boolean };
}
interface ArbitratorOption { id: string; fullName: string }

const ROLES = ['SOLE', 'CO_ARBITRATOR', 'CHAIR'];
const SIDES = ['CLAIMANT', 'RESPONDENT'];
const VACANCY_REASONS = ['RESIGNATION', 'REMOVAL', 'INCAPACITY', 'DEATH'];

function fmt(d: string | null): string {
  return d ? new Date(d).toLocaleString() : '—';
}
function humanize(s: string | null): string {
  return s ? s.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : '—';
}
function apiError(e: unknown): string {
  const msg = (e as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message;
  if (Array.isArray(msg)) return msg.join('; ');
  return msg ?? 'Something went wrong. Please try again.';
}

type Dialog =
  | { type: 'default' }
  | { type: 'nominateChair' }
  | { type: 'replace'; member: Member }
  | { type: 'vacancy'; member: Member }
  | { type: 'challenge'; challenge: Challenge };

export function TribunalTab({ caseId }: { caseId: string }) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);

  const overview = useQuery<Overview>({
    queryKey: ['appointments-overview', caseId],
    queryFn: async () => (await api.get(`/cases/${caseId}/appointments/overview`)).data,
  });
  const canManage = !!overview.data?.viewer.canManage;
  const canDecide = !!overview.data?.viewer.canDecideChallenge;

  const arbitrators = useQuery<ArbitratorOption[]>({
    queryKey: ['arbitrators-select'],
    queryFn: async () => ((await api.get('/arbitrators?pageSize=50')).data.data as ArbitratorOption[]),
    enabled: canManage,
  });

  const after = (msg: string) => {
    setNotice(msg); setError(null); setDialog(null);
    void qc.invalidateQueries({ queryKey: ['appointments-overview', caseId] });
  };
  const run = useMutation({
    mutationFn: async (fn: () => Promise<unknown>) => fn(),
    onError: (e) => { setError(apiError(e)); setNotice(null); },
  });
  const call = (fn: () => Promise<unknown>, ok: string) =>
    run.mutate(fn as never, { onSuccess: () => after(ok) });

  if (overview.isLoading) return <p className="muted">Loading tribunal…</p>;
  if (overview.isError || !overview.data) return <div className="alert alert--danger">Unable to load the tribunal overview.</div>;
  const data = overview.data;

  return (
    <div className="grid" style={{ gap: 'var(--sp-5)' }}>
      {data.pendingChallenge && (
        <div className="alert alert--warning" role="status">
          An arbitrator challenge is pending — <strong>constitution is suspended</strong> until it is decided.
        </div>
      )}
      {data.complianceHold.active && (
        <div className="alert alert--danger" role="status">
          An active <strong>compliance hold</strong> is blocking this case — constitution cannot proceed until it is reviewed and released.
          {data.complianceHold.reason && <span className="field__hint"> ({data.complianceHold.reason})</span>}
        </div>
      )}
      {notice && <div className="alert alert--success" role="status">{notice}</div>}
      {error && <div className="alert alert--danger" role="alert">{error}</div>}

      {/* ---- Composition ---- */}
      <section className="card">
        <div className="arb-card__meta" style={{ justifyContent: 'space-between' }}>
          <h3 className="card__title">Tribunal composition</h3>
          <div>
            <span className="badge badge--info">{data.composition ? humanize(data.composition) : 'Not formed'}</span>
            <span className={`badge ${data.constituted ? 'badge--success' : 'badge--warning'}`} style={{ marginInlineStart: 8 }}>
              {data.constituted ? 'Constituted' : 'Not constituted'}
            </span>
          </div>
        </div>
        {data.members.length ? (
          <table className="table" style={{ marginTop: 'var(--sp-3)' }}>
            <thead><tr><th>Arbitrator</th><th>Role</th><th>Nominated by</th><th>Status</th><th>Accepted</th>{canManage && <th>Actions</th>}</tr></thead>
            <tbody>
              {data.members.map((m) => (
                <tr key={m.id}>
                  <td>{m.displayName}</td>
                  <td>{humanize(m.role)}</td>
                  <td>{humanize(m.nominatedBy)}</td>
                  <td>
                    <span className={`badge ${m.status === 'ACTIVE' ? 'badge--success' : 'badge--danger'}`}>{humanize(m.status)}</span>
                    {m.vacancyReason && <span className="field__hint"> ({humanize(m.vacancyReason)})</span>}
                  </td>
                  <td>{fmt(m.acceptedAt)}</td>
                  {canManage && (
                    <td>
                      {m.status === 'ACTIVE' ? (
                        <button className="btn btn--ghost btn--sm" onClick={() => setDialog({ type: 'vacancy', member: m })}>Record vacancy</button>
                      ) : (
                        <button className="btn btn--ghost btn--sm" onClick={() => setDialog({ type: 'replace', member: m })}>Replace</button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="muted" style={{ marginTop: 'var(--sp-3)' }}>No tribunal members yet.</p>}

        {canManage && (
          <div style={{ display: 'flex', gap: 'var(--sp-2)', marginTop: 'var(--sp-3)', flexWrap: 'wrap' }}>
            <button className="btn btn--primary btn--sm" onClick={() => setDialog({ type: 'default' })}>Default appointment</button>
            <button className="btn btn--ghost btn--sm" onClick={() => setDialog({ type: 'nominateChair' })}>Nominate chair</button>
            <button className="btn btn--ghost btn--sm"
              disabled={run.isPending || data.constituted || data.pendingChallenge || data.complianceHold.active}
              title={data.pendingChallenge ? 'Blocked: a challenge is pending'
                : data.complianceHold.active ? 'Blocked: an active compliance hold'
                : data.constituted ? 'Already constituted' : 'Constitute the tribunal'}
              onClick={() => call(() => api.post(`/cases/${caseId}/tribunal/constitute`, {}), 'Tribunal constituted.')}>Constitute tribunal</button>
            <button className="btn btn--ghost btn--sm" disabled={run.isPending}
              onClick={() => call(() => api.post('/appointments/expire-sweep', {}), 'Expiry sweep completed.')}>Run expiry sweep</button>
          </div>
        )}
      </section>

      {/* ---- Invitations & response deadlines ---- */}
      <section className="card">
        <h3 className="card__title">Appointment invitations</h3>
        {data.invitations.length ? (
          <table className="table" style={{ marginTop: 'var(--sp-3)' }}>
            <thead><tr><th>Arbitrator</th><th>Role</th><th>Method</th><th>Status</th><th>Disclosure</th><th>Response deadline</th>{canManage && <th>Actions</th>}</tr></thead>
            <tbody>
              {data.invitations.map((inv) => (
                <tr key={inv.id}>
                  <td>{inv.arbitratorName}</td>
                  <td>{humanize(inv.proposedRole)}{inv.nominatedBy ? ` · ${humanize(inv.nominatedBy)}` : ''}</td>
                  <td>{humanize(inv.appointmentMethod)}</td>
                  <td><span className={`badge ${inv.status === 'ACCEPTED' ? 'badge--success' : inv.status === 'DECLINED' || inv.status === 'EXPIRED' || inv.status === 'WITHDRAWN' ? 'badge--danger' : 'badge--info'}`}>{humanize(inv.status)}</span></td>
                  <td>{inv.disclosureFiled ? <span className="badge badge--success">Filed</span> : <span className="badge badge--warning">Pending</span>}</td>
                  <td>
                    <span title={`source: ${inv.responseDeadline.source}`}>{fmt(inv.responseDeadline.dueAt)}</span>
                    <span className={`badge ${inv.responseDeadline.source === 'RULE' ? 'badge--gold' : ''}`} style={{ marginInlineStart: 6 }}
                      title={inv.responseDeadline.source === 'RULE' ? 'Computed from the case rule set' : 'No rule deadline — safe fixed fallback'}>
                      {inv.responseDeadline.source === 'RULE' ? 'Rule' : 'Fallback'}
                    </span>
                    {/* Distinct labelling for extension / suspension of the response window
                        (expiry is already shown in the invitation status column). */}
                    {inv.responseDeadline.status === 'EXTENDED' && <span className="badge badge--info" style={{ marginInlineStart: 6 }}>Extended</span>}
                    {inv.responseDeadline.status === 'SUSPENDED' && <span className="badge badge--warning" style={{ marginInlineStart: 6 }}>Suspended</span>}
                    {inv.responseDeadline.status === 'WAIVED' && <span className="badge" style={{ marginInlineStart: 6 }}>Waived</span>}
                    {inv.reminderCount > 0 && <span className="field__hint"> · {inv.reminderCount} reminder(s){inv.lastReminderAt ? `, last ${fmt(inv.lastReminderAt)}` : ''}</span>}
                    {inv.declineReason && <div className="field__hint">Decline reason: {inv.declineReason}</div>}
                  </td>
                  {canManage && (
                    <td>
                      {(inv.status === 'INVITED' || inv.status === 'CONFLICT_CHECK') && (
                        <button className="btn btn--ghost btn--sm" disabled={run.isPending}
                          onClick={() => call(() => api.post(`/appointments/${inv.id}/remind`, {}), 'Reminder sent.')}>Send reminder</button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="muted" style={{ marginTop: 'var(--sp-3)' }}>No invitations yet.</p>}
      </section>

      {/* ---- Challenges ---- */}
      <section className="card">
        <h3 className="card__title">Arbitrator challenges</h3>
        {data.challenges.length ? (
          <table className="table" style={{ marginTop: 'var(--sp-3)' }}>
            <thead><tr><th>Arbitrator</th><th>Grounds</th><th>Status</th><th>Decided</th>{canDecide && <th>Actions</th>}</tr></thead>
            <tbody>
              {data.challenges.map((c) => (
                <tr key={c.id}>
                  <td>{c.challengedName}</td>
                  <td>{c.grounds}</td>
                  <td><span className={`badge ${c.status === 'UPHELD' ? 'badge--danger' : c.status === 'DISMISSED' ? 'badge--success' : 'badge--warning'}`}>{humanize(c.status)}</span></td>
                  <td>{fmt(c.decidedAt)}</td>
                  {canDecide && (
                    <td>
                      {!c.decidedAt && (
                        <button className="btn btn--ghost btn--sm" onClick={() => setDialog({ type: 'challenge', challenge: c })}>Decide</button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="muted" style={{ marginTop: 'var(--sp-3)' }}>No challenges raised.</p>}
      </section>

      {dialog && (
        <ActionDialog
          dialog={dialog}
          caseId={caseId}
          arbitrators={arbitrators.data ?? []}
          busy={run.isPending}
          onCancel={() => setDialog(null)}
          onSubmit={(fn, ok) => call(fn, ok)}
        />
      )}
    </div>
  );
}

// ---- Confirmation / form dialog for serious actions ----
function Modal({ title, children, onCancel }: { title: string; children: ReactNode; onCancel: () => void }) {
  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label={title}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', display: 'grid', placeItems: 'center', zIndex: 50 }}>
      <div className="card" style={{ maxWidth: 520, width: '90%' }}>
        <h3 className="card__title">{title}</h3>
        {children}
        <button className="btn btn--ghost btn--sm" style={{ marginTop: 'var(--sp-3)' }} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function ActionDialog({ dialog, caseId, arbitrators, busy, onCancel, onSubmit }: {
  dialog: Dialog; caseId: string; arbitrators: ArbitratorOption[]; busy: boolean;
  onCancel: () => void; onSubmit: (fn: () => Promise<unknown>, ok: string) => void;
}) {
  const [arbitratorId, setArbitratorId] = useState('');
  const [role, setRole] = useState('CO_ARBITRATOR');
  const [side, setSide] = useState('');
  const [reason, setReason] = useState('');
  const [vacancyReason, setVacancyReason] = useState('RESIGNATION');
  const [decision, setDecision] = useState('DISMISSED');
  const arbSelect = (
    <label className="field">
      <span className="field__label">Arbitrator</span>
      <select className="select" value={arbitratorId} onChange={(e) => setArbitratorId(e.target.value)} aria-label="Arbitrator">
        <option value="">Select an arbitrator…</option>
        {arbitrators.map((a) => <option key={a.id} value={a.id}>{a.fullName}</option>)}
      </select>
    </label>
  );
  const roleSelect = (
    <label className="field"><span className="field__label">Role</span>
      <select className="select" value={role} onChange={(e) => setRole(e.target.value)} aria-label="Role">
        {ROLES.map((r) => <option key={r} value={r}>{humanize(r)}</option>)}
      </select>
    </label>
  );
  const sideSelect = (
    <label className="field"><span className="field__label">Nominated by (optional)</span>
      <select className="select" value={side} onChange={(e) => setSide(e.target.value)} aria-label="Nominated by">
        <option value="">—</option>{SIDES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
      </select>
    </label>
  );

  if (dialog.type === 'default') {
    return (
      <Modal title="Default (institution) appointment" onCancel={onCancel}>
        <p className="field__hint">Use when a party is silent/refuses to nominate, or co-arbitrators fail to agree a chair.</p>
        {arbSelect}{roleSelect}{sideSelect}
        <label className="field"><span className="field__label">Reason (recorded)</span>
          <textarea className="input" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason" />
        </label>
        <button className="btn btn--primary" disabled={busy || !arbitratorId}
          onClick={() => onSubmit(() => api.post(`/cases/${caseId}/appointments/default`, { arbitratorId, proposedRole: role, nominatedBy: side || undefined, reason }), 'Default appointment made.')}>
          Confirm default appointment
        </button>
      </Modal>
    );
  }
  if (dialog.type === 'nominateChair') {
    return (
      <Modal title="Nominate presiding arbitrator (chair)" onCancel={onCancel}>
        <p className="field__hint">The two co-arbitrators (or the appointing authority) nominate the chair.</p>
        {arbSelect}
        <button className="btn btn--primary" disabled={busy || !arbitratorId}
          onClick={() => onSubmit(() => api.post(`/cases/${caseId}/tribunal/nominate-chair`, { arbitratorId }), 'Chair nominated.')}>
          Nominate chair
        </button>
      </Modal>
    );
  }
  if (dialog.type === 'vacancy') {
    return (
      <Modal title={`Record vacancy — ${dialog.member.displayName}`} onCancel={onCancel}>
        <p className="field__hint">This removes the arbitrator's access and de-constitutes the tribunal.</p>
        <label className="field"><span className="field__label">Reason</span>
          <select className="select" value={vacancyReason} onChange={(e) => setVacancyReason(e.target.value)} aria-label="Vacancy reason">
            {VACANCY_REASONS.map((r) => <option key={r} value={r}>{humanize(r)}</option>)}
          </select>
        </label>
        <label className="field"><span className="field__label">Note (optional)</span>
          <textarea className="input" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Note" />
        </label>
        <button className="btn btn--danger" disabled={busy}
          onClick={() => onSubmit(() => api.post(`/tribunal/members/${dialog.member.id}/vacancy`, { reason: vacancyReason, note: reason || undefined }), 'Vacancy recorded.')}>
          Confirm vacancy
        </button>
      </Modal>
    );
  }
  if (dialog.type === 'replace') {
    return (
      <Modal title={`Replace ${dialog.member.displayName}`} onCancel={onCancel}>
        <p className="field__hint">Invite a replacement arbitrator to fill the vacated seat.</p>
        {arbSelect}{roleSelect}{sideSelect}
        <label className="field"><span className="field__label">Reason (recorded)</span>
          <textarea className="input" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Replacement reason" />
        </label>
        <button className="btn btn--primary" disabled={busy || !arbitratorId}
          onClick={() => onSubmit(() => api.post(`/cases/${caseId}/tribunal/replace`, { vacatedUserId: dialog.member.arbitratorUserId, arbitratorId, proposedRole: role, nominatedBy: side || undefined, reason: reason || undefined }), 'Replacement invited.')}>
          Confirm replacement
        </button>
      </Modal>
    );
  }
  // challenge
  return (
    <Modal title={`Decide challenge — ${dialog.challenge.challengedName}`} onCancel={onCancel}>
      <p className="field__hint">Grounds: {dialog.challenge.grounds}</p>
      <label className="field"><span className="field__label">Decision</span>
        <select className="select" value={decision} onChange={(e) => setDecision(e.target.value)} aria-label="Decision">
          <option value="DISMISSED">Dismiss</option>
          <option value="UPHELD">Uphold (vacates the seat)</option>
        </select>
      </label>
      <label className="field"><span className="field__label">Decision note</span>
        <textarea className="input" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Decision note" />
      </label>
      <button className={`btn ${decision === 'UPHELD' ? 'btn--danger' : 'btn--primary'}`} disabled={busy}
        onClick={() => onSubmit(() => api.post(`/challenges/${dialog.challenge.id}/decide`, { status: decision, decisionNote: reason || undefined }), 'Challenge decided.')}>
        Confirm decision
      </button>
    </Modal>
  );
}
