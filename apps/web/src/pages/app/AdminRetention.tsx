import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Permission, Role } from '@gaap/shared';
import { useAuth } from '../../auth/AuthContext';
import { api } from '../../lib/api';

interface CategoryPolicy { days: number; behavior: string; description: string; note?: string }
interface LegalHold { id: string; caseId: string; reason: string; status: string; placedAt: string; releasedAt: string | null }
interface CategoryReport { category: string; behavior: string; retentionDays: number; eligible: number; blockedByLegalHold: number; note: string }
interface DryRun { runId: string; generatedAt: string; reports: CategoryReport[] }
interface PolicyDraft {
  overrides: Record<string, { days?: number; behavior?: string; note?: string }>;
  status: 'DRAFT' | 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED';
  proposedByEmail: string;
  proposedAt: string;
  reviewedByEmail?: string;
  reviewedAt?: string;
  reviewDecision?: 'APPROVE' | 'REJECT';
  reviewNote?: string;
}

const BEHAVIORS = ['SOFT_DELETE', 'RETAIN_FOREVER', 'REVIEW', 'ARCHIVE', 'LEGAL_HOLD_REQUIRED'];
const SAFEGUARDED = ['AWARD', 'AUDIT_LOG', 'NOTICE_CERTIFICATE'];

function apiError(e: unknown): string {
  const m = (e as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message;
  return Array.isArray(m) ? m.join('; ') : (m ?? 'Something went wrong.');
}
function behaviorBadge(b: string): string {
  if (b === 'RETAIN_FOREVER') return 'badge--success';
  if (b === 'SOFT_DELETE') return 'badge--warning';
  if (b === 'LEGAL_HOLD_REQUIRED') return 'badge--danger';
  return 'badge--info';
}
function statusBadge(s: string): string {
  if (s === 'APPROVED') return 'badge--success';
  if (s === 'PENDING_REVIEW') return 'badge--warning';
  if (s === 'REJECTED') return 'badge--danger';
  return 'badge--info';
}

export function AdminRetention() {
  const { user } = useAuth();
  const qc = useQueryClient();
  // Role-controlled access. Edit = Super Admin; Review = Council/legal; Holds = Registrar.
  const canManage = !!user?.permissions.includes(Permission.SETTINGS_MANAGE);
  const canReview = !!user?.permissions.includes(Permission.POLICY_MANAGE);
  const canViewHolds = canManage || !!user?.permissions.includes(Permission.CASE_MANAGE_SERVICE);
  const canView = canManage || canReview || canViewHolds;
  const isSuperAdmin = !!user?.roles.includes(Role.SUPER_ADMIN);

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [holdCaseId, setHoldCaseId] = useState('');
  const [holdReason, setHoldReason] = useState('');
  const [editing, setEditing] = useState(false);
  const [draftEntries, setDraftEntries] = useState<Record<string, { days: number; behavior: string; note: string }>>({});
  const [reviewNote, setReviewNote] = useState('');

  const policy = useQuery<Record<string, CategoryPolicy>>({ queryKey: ['retention-policy'], queryFn: async () => (await api.get('/admin/retention/policy')).data, enabled: canView });
  const draft = useQuery<{ draft: PolicyDraft | null }>({ queryKey: ['retention-draft'], queryFn: async () => (await api.get('/admin/retention/policy/draft')).data, enabled: canView });
  const holds = useQuery<LegalHold[]>({ queryKey: ['legal-holds'], queryFn: async () => (await api.get('/admin/retention/legal-holds')).data, enabled: canViewHolds });
  const dryRun = useQuery<DryRun>({ queryKey: ['retention-dry-run'], queryFn: async () => (await api.post('/admin/retention/sweep/dry-run', {})).data, enabled: false });

  const onErr = (e: unknown) => { setError(apiError(e)); setNotice(null); };
  const ok = (msg: string) => { setNotice(msg); setError(null); };
  const refreshHolds = () => void qc.invalidateQueries({ queryKey: ['legal-holds'] });
  const refreshPolicy = () => { void qc.invalidateQueries({ queryKey: ['retention-policy'] }); void qc.invalidateQueries({ queryKey: ['retention-draft'] }); };

  const startEditing = () => {
    const init: Record<string, { days: number; behavior: string; note: string }> = {};
    if (policy.data) for (const [cat, p] of Object.entries(policy.data)) init[cat] = { days: p.days, behavior: p.behavior, note: p.note ?? '' };
    setDraftEntries(init);
    setEditing(true);
  };
  const changedEntries = () => {
    if (!policy.data) return [];
    return Object.entries(draftEntries)
      .filter(([cat, d]) => {
        const p = policy.data![cat];
        return p && (d.days !== p.days || d.behavior !== p.behavior || (d.note ?? '') !== (p.note ?? ''));
      })
      .map(([category, d]) => ({ category, days: d.days, behavior: d.behavior, note: d.note || undefined }));
  };

  const saveDraft = useMutation({
    mutationFn: async (submitForReview: boolean) => api.post('/admin/retention/policy/draft', { entries: changedEntries(), submitForReview }),
    onSuccess: (_r, submitForReview) => { setEditing(false); ok(submitForReview ? 'Draft submitted for legal/council review.' : 'Draft saved.'); refreshPolicy(); }, onError: onErr,
  });
  const review = useMutation({
    mutationFn: async (decision: 'APPROVE' | 'REJECT') => api.post('/admin/retention/policy/review', { decision, note: reviewNote.trim() || undefined }),
    onSuccess: (_r, decision) => { setReviewNote(''); ok(decision === 'APPROVE' ? 'Draft approved — a Super Admin can now activate it.' : 'Draft rejected.'); refreshPolicy(); }, onError: onErr,
  });
  const activate = useMutation({
    mutationFn: async () => api.post('/admin/retention/policy/activate', {}),
    onSuccess: () => { ok('Policy activated. Changes are now in effect.'); refreshPolicy(); }, onError: onErr,
  });
  const placeHold = useMutation({
    mutationFn: async () => api.post('/admin/retention/legal-holds', { caseId: holdCaseId.trim(), reason: holdReason.trim() }),
    onSuccess: () => { setHoldCaseId(''); setHoldReason(''); ok('Legal hold placed.'); refreshHolds(); }, onError: onErr,
  });
  const releaseHold = useMutation({
    mutationFn: async (id: string) => api.post(`/admin/retention/legal-holds/${id}/release`, {}),
    onSuccess: () => { ok('Legal hold released.'); refreshHolds(); }, onError: onErr,
  });
  const execute = useMutation({
    mutationFn: async () => api.post('/admin/retention/sweep/execute', { confirm: true, categories: ['CASE_RECORD'] }),
    onSuccess: (r: { data: { summary: { category: string; softDeleted: number }[] } }) => {
      const n = r.data.summary.reduce((a, s) => a + (s.softDeleted ?? 0), 0);
      ok(`Sweep executed: ${n} case record(s) soft-deleted.`); void dryRun.refetch();
    }, onError: onErr,
  });

  if (!canView) {
    return <div className="section"><div className="container"><div className="alert alert--danger">You do not have permission to view retention settings.</div></div></div>;
  }

  const d = draft.data?.draft ?? null;

  return (
    <div className="section">
      <div className="container">
        <p className="eyebrow">Administration &amp; governance</p>
        <h1>Data retention &amp; legal hold</h1>

        {/* Required: who-can-edit explanation box */}
        <div className="alert alert--legal" role="note">
          <strong>Only Super Admin users may edit retention settings.</strong> Retention changes may require legal/counsel
          review before activation. Legal holds override deletion rules.
        </div>

        {/* Role legend — clarifies what each role may do here. */}
        <div className="card" style={{ marginTop: 'var(--sp-3)' }}>
          <h2 className="card__title">Who can do what</h2>
          <ul className="muted" style={{ margin: 0, paddingInlineStart: '1.1rem', lineHeight: 1.7 }}>
            <li><strong>Super Admin</strong> — edit retention periods &amp; behaviour, add/edit notes, apply/remove legal holds, run dry-runs and execute approved sweeps.</li>
            <li><strong>Council / legal reviewer</strong> — review and approve (or reject) proposed policy changes before activation.</li>
            <li><strong>Registrar</strong> — view legal holds and request a hold on a case.</li>
            <li><strong>Arbitrators, parties and lawyers</strong> — cannot edit retention policies.</li>
          </ul>
          <p className="field__hint" style={{ marginTop: 'var(--sp-2)' }}>
            Workflow: <strong>Draft change → Review/approval → Activate → Dry-run sweep → Confirm execution.</strong>{' '}
            Nothing is hard-deleted: sweeps are soft (tombstoned), and a legal hold blocks deletion even after the retention period expires.
          </p>
        </div>

        <div className="alert alert--legal" role="note" style={{ marginTop: 'var(--sp-3)' }}>
          This framework is <strong>safe by design</strong>: nothing is deleted by default. A sweep is <strong>dry-run first</strong>;
          execution requires a super administrator, explicit confirmation and an opt-in category list; deletions are <strong>soft
          (tombstoned)</strong>; and a <strong>legal hold blocks deletion</strong>. Awards, audit logs and service evidence are
          retained indefinitely (safeguarded). Retention periods are engineering defaults — qualified counsel must set them per seat.
        </div>

        {notice && <div className="alert alert--success" role="status" onClick={() => setNotice(null)}>{notice}</div>}
        {error && <div className="alert alert--danger" role="alert" onClick={() => setError(null)}>{error}</div>}

        {/* Pending policy change — review/approval workflow */}
        {d && (
          <section className="card" style={{ marginTop: 'var(--sp-4)' }}>
            <div className="arb-card__meta" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 className="card__title" style={{ margin: 0 }}>Proposed policy change</h2>
              <span className={`badge ${statusBadge(d.status)}`}>{d.status.replaceAll('_', ' ')}</span>
            </div>
            <p className="field__hint">Proposed by {d.proposedByEmail} · {new Date(d.proposedAt).toLocaleString()}</p>
            <table className="table">
              <thead><tr><th>Category</th><th>Proposed change</th></tr></thead>
              <tbody>
                {Object.entries(d.overrides).map(([cat, o]) => (
                  <tr key={cat}>
                    <td>{cat.replaceAll('_', ' ')}</td>
                    <td className="field__hint">
                      {o.days != null && <>period → {Math.round(o.days / 365)} yr ({o.days} d) </>}
                      {o.behavior && <span className={`badge ${behaviorBadge(o.behavior)}`}>{o.behavior.replaceAll('_', ' ')}</span>}
                      {o.note && <> · note: {o.note}</>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {d.reviewedByEmail && (
              <p className="field__hint">Reviewed by {d.reviewedByEmail} — <strong>{d.reviewDecision}</strong>{d.reviewNote ? ` · ${d.reviewNote}` : ''}</p>
            )}
            <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap', alignItems: 'center', marginTop: 'var(--sp-2)' }}>
              {/* Council/legal review of a pending draft */}
              {canReview && d.status === 'PENDING_REVIEW' && (
                <>
                  <input className="input" style={{ maxWidth: 280 }} placeholder="Review note (optional)" value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} />
                  <button className="btn btn--primary btn--sm" disabled={review.isPending} onClick={() => review.mutate('APPROVE')}>Approve</button>
                  <button className="btn btn--ghost btn--sm" disabled={review.isPending} onClick={() => review.mutate('REJECT')}>Reject</button>
                </>
              )}
              {/* Super Admin submits a DRAFT for review, or activates an APPROVED draft */}
              {canManage && d.status === 'APPROVED' && (
                <button className="btn btn--primary btn--sm" disabled={activate.isPending} onClick={() => activate.mutate()}>Activate policy</button>
              )}
              {!canReview && d.status === 'PENDING_REVIEW' && <p className="field__hint" style={{ margin: 0 }}>Awaiting legal/council review.</p>}
            </div>
          </section>
        )}

        {/* Policy */}
        <section className="card" style={{ marginTop: 'var(--sp-4)' }}>
          <div className="arb-card__meta" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 className="card__title" style={{ margin: 0 }}>Retention policy</h2>
            {canManage && !editing && (
              <button className="btn btn--secondary btn--sm" onClick={startEditing}>Edit policy</button>
            )}
          </div>
          {policy.isLoading ? <p className="muted">Loading…</p> : (
            <table className="table">
              <thead><tr><th>Category</th><th>Behaviour</th><th>Period</th><th>Rule / note</th></tr></thead>
              <tbody>
                {policy.data && Object.entries(policy.data).map(([cat, p]) => {
                  const e = draftEntries[cat];
                  const locked = SAFEGUARDED.includes(cat);
                  return (
                    <tr key={cat}>
                      <td>{cat.replaceAll('_', ' ')}</td>
                      <td>
                        {editing && e ? (
                          <select className="select" style={{ width: 'auto' }} value={e.behavior} disabled={locked}
                            onChange={(ev) => setDraftEntries((s) => ({ ...s, [cat]: { ...s[cat], behavior: ev.target.value } }))}>
                            {BEHAVIORS.map((b) => <option key={b} value={b}>{b.replaceAll('_', ' ')}</option>)}
                          </select>
                        ) : (
                          <span className={`badge ${behaviorBadge(p.behavior)}`}>{p.behavior.replaceAll('_', ' ')}</span>
                        )}
                      </td>
                      <td>
                        {editing && e ? (
                          <input className="input" type="number" min={0} style={{ width: 110 }} value={e.days} disabled={locked}
                            onChange={(ev) => setDraftEntries((s) => ({ ...s, [cat]: { ...s[cat], days: Number(ev.target.value) } }))} />
                        ) : (p.days > 0 ? `${Math.round(p.days / 365)} yr` : '—')}
                      </td>
                      <td className="field__hint">
                        {editing && e ? (
                          <input className="input" placeholder="Policy note (optional)" value={e.note} disabled={locked}
                            onChange={(ev) => setDraftEntries((s) => ({ ...s, [cat]: { ...s[cat], note: ev.target.value } }))} />
                        ) : (<>{p.description}{p.note && <> · <em>{p.note}</em></>}{locked && <span className="badge badge--success" style={{ marginInlineStart: 6 }}>safeguarded</span>}</>)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {editing && (
            <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap', marginTop: 'var(--sp-2)' }}>
              <button className="btn btn--ghost btn--sm" disabled={saveDraft.isPending} onClick={() => saveDraft.mutate(false)}>Save draft</button>
              <button className="btn btn--primary btn--sm" disabled={saveDraft.isPending} onClick={() => saveDraft.mutate(true)}>Submit for review</button>
              <button className="btn btn--ghost btn--sm" onClick={() => setEditing(false)}>Cancel</button>
              <p className="field__hint" style={{ margin: 0, alignSelf: 'center' }}>Safeguarded categories (awards, audit log, certificates) cannot be made deletable.</p>
            </div>
          )}
        </section>

        {/* Legal holds */}
        {canViewHolds && (
        <section className="card" style={{ marginTop: 'var(--sp-4)' }}>
          <h2 className="card__title">Legal holds <span className="field__hint">— a hold blocks deletion even after the retention period expires</span></h2>
          <form className="field-inline" onSubmit={(e) => { e.preventDefault(); if (holdCaseId.trim() && holdReason.trim()) placeHold.mutate(); }}>
            <input className="input" aria-label="Case id" placeholder="Case id" value={holdCaseId} onChange={(e) => setHoldCaseId(e.target.value)} />
            <input className="input" aria-label="Hold reason" placeholder="Reason (e.g. enforcement pending)" value={holdReason} onChange={(e) => setHoldReason(e.target.value)} />
            <button className="btn btn--primary" disabled={placeHold.isPending || !holdCaseId.trim() || !holdReason.trim()}>{canManage ? 'Place hold' : 'Request hold'}</button>
          </form>
          <table className="table" style={{ marginTop: 'var(--sp-3)' }}>
            <thead><tr><th>Case</th><th>Reason</th><th>Status</th><th>Placed</th><th>Actions</th></tr></thead>
            <tbody>
              {holds.data?.length ? holds.data.map((h) => (
                <tr key={h.id}>
                  <td><code style={{ fontSize: 12 }}>{h.caseId}</code></td>
                  <td>{h.reason}</td>
                  <td><span className={`badge ${h.status === 'ACTIVE' ? 'badge--danger' : ''}`}>{h.status}</span></td>
                  <td>{new Date(h.placedAt).toLocaleDateString()}</td>
                  <td>{h.status === 'ACTIVE' && canManage && <button className="btn btn--ghost btn--sm" disabled={releaseHold.isPending} onClick={() => releaseHold.mutate(h.id)}>Release</button>}</td>
                </tr>
              )) : <tr><td colSpan={5} className="muted">No legal holds.</td></tr>}
            </tbody>
          </table>
        </section>
        )}

        {/* Sweep */}
        {canManage && (
        <section className="card" style={{ marginTop: 'var(--sp-4)' }}>
          <div className="arb-card__meta" style={{ justifyContent: 'space-between' }}>
            <h2 className="card__title">Retention sweep</h2>
            <button className="btn btn--ghost btn--sm" disabled={dryRun.isFetching} onClick={() => void dryRun.refetch()}>Run dry run</button>
          </div>
          {dryRun.data && (
            <>
              <p className="field__hint">Dry run {dryRun.data.runId.slice(0, 8)} · {new Date(dryRun.data.generatedAt).toLocaleString()} · nothing was deleted.</p>
              <table className="table">
                <thead><tr><th>Category</th><th>Behaviour</th><th>Eligible</th><th>Blocked by hold</th><th>Note</th></tr></thead>
                <tbody>
                  {dryRun.data.reports.map((r) => (
                    <tr key={r.category}>
                      <td>{r.category.replaceAll('_', ' ')}</td>
                      <td><span className={`badge ${behaviorBadge(r.behavior)}`}>{r.behavior.replaceAll('_', ' ')}</span></td>
                      <td>{r.eligible > 0 ? <span className="badge badge--warning">{r.eligible}</span> : '0'}</td>
                      <td>{r.blockedByLegalHold > 0 ? <span className="badge badge--info">{r.blockedByLegalHold}</span> : '0'}</td>
                      <td className="field__hint">{r.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {isSuperAdmin ? (
                <button className="btn btn--danger" disabled={execute.isPending}
                  onClick={() => { if (window.confirm('Soft-delete (tombstone) all eligible CASE_RECORD entries not under legal hold? Awards, audit logs and service evidence are never deleted.')) execute.mutate(); }}>
                  Execute sweep (CASE_RECORD, soft-delete)
                </button>
              ) : (
                <p className="field__hint">Only a super administrator may execute a sweep.</p>
              )}
            </>
          )}
        </section>
        )}
      </div>
    </div>
  );
}
