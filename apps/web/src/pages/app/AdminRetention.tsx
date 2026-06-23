import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Permission, Role } from '@gaap/shared';
import { useAuth } from '../../auth/AuthContext';
import { api } from '../../lib/api';

interface CategoryPolicy { days: number; behavior: string; description: string }
interface LegalHold { id: string; caseId: string; reason: string; status: string; placedAt: string; releasedAt: string | null }
interface CategoryReport { category: string; behavior: string; retentionDays: number; eligible: number; blockedByLegalHold: number; note: string }
interface DryRun { runId: string; generatedAt: string; reports: CategoryReport[] }

function apiError(e: unknown): string {
  const m = (e as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message;
  return Array.isArray(m) ? m.join('; ') : (m ?? 'Something went wrong.');
}
function behaviorBadge(b: string): string {
  return b === 'RETAIN_FOREVER' ? 'badge--success' : b === 'SOFT_DELETE' ? 'badge--warning' : 'badge--info';
}

export function AdminRetention() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const canManage = !!user?.permissions.includes(Permission.SETTINGS_MANAGE);
  const isSuperAdmin = !!user?.roles.includes(Role.SUPER_ADMIN);

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [holdCaseId, setHoldCaseId] = useState('');
  const [holdReason, setHoldReason] = useState('');

  const policy = useQuery<Record<string, CategoryPolicy>>({ queryKey: ['retention-policy'], queryFn: async () => (await api.get('/admin/retention/policy')).data, enabled: canManage });
  const holds = useQuery<LegalHold[]>({ queryKey: ['legal-holds'], queryFn: async () => (await api.get('/admin/retention/legal-holds')).data, enabled: canManage });
  const dryRun = useQuery<DryRun>({ queryKey: ['retention-dry-run'], queryFn: async () => (await api.post('/admin/retention/sweep/dry-run', {})).data, enabled: false });

  const onErr = (e: unknown) => { setError(apiError(e)); setNotice(null); };
  const refreshHolds = () => void qc.invalidateQueries({ queryKey: ['legal-holds'] });

  const placeHold = useMutation({
    mutationFn: async () => api.post('/admin/retention/legal-holds', { caseId: holdCaseId.trim(), reason: holdReason.trim() }),
    onSuccess: () => { setHoldCaseId(''); setHoldReason(''); setNotice('Legal hold placed.'); setError(null); refreshHolds(); }, onError: onErr,
  });
  const releaseHold = useMutation({
    mutationFn: async (id: string) => api.post(`/admin/retention/legal-holds/${id}/release`, {}),
    onSuccess: () => { setNotice('Legal hold released.'); setError(null); refreshHolds(); }, onError: onErr,
  });
  const execute = useMutation({
    mutationFn: async () => api.post('/admin/retention/sweep/execute', { confirm: true, categories: ['CASE_RECORD'] }),
    onSuccess: (r: { data: { summary: { category: string; softDeleted: number }[] } }) => {
      const n = r.data.summary.reduce((a, s) => a + (s.softDeleted ?? 0), 0);
      setNotice(`Sweep executed: ${n} case record(s) soft-deleted.`); setError(null); void dryRun.refetch();
    }, onError: onErr,
  });

  if (!canManage) {
    return <div className="section"><div className="container"><div className="alert alert--danger">You do not have settings-management permission.</div></div></div>;
  }

  return (
    <div className="section">
      <div className="container">
        <p className="eyebrow">Administration</p>
        <h1>Data retention &amp; legal hold</h1>
        <div className="alert alert--legal" role="note">
          This framework is <strong>safe by design</strong>: nothing is deleted by default. A sweep is <strong>dry-run first</strong>;
          execution requires a super administrator, explicit confirmation and an opt-in category list; deletions are <strong>soft
          (tombstoned)</strong>; and a <strong>legal hold blocks deletion</strong>. Awards, audit logs and service evidence are
          retained indefinitely. Retention periods are engineering defaults — qualified counsel must set them per seat.
        </div>

        {notice && <div className="alert alert--success" role="status">{notice}</div>}
        {error && <div className="alert alert--danger" role="alert">{error}</div>}

        {/* Policy */}
        <section className="card" style={{ marginTop: 'var(--sp-4)' }}>
          <h2 className="card__title">Retention policy</h2>
          {policy.isLoading ? <p className="muted">Loading…</p> : (
            <table className="table">
              <thead><tr><th>Category</th><th>Behaviour</th><th>Period</th><th>Rule</th></tr></thead>
              <tbody>
                {policy.data && Object.entries(policy.data).map(([cat, p]) => (
                  <tr key={cat}>
                    <td>{cat.replaceAll('_', ' ')}</td>
                    <td><span className={`badge ${behaviorBadge(p.behavior)}`}>{p.behavior.replaceAll('_', ' ')}</span></td>
                    <td>{p.days > 0 ? `${Math.round(p.days / 365)} yr` : '—'}</td>
                    <td className="field__hint">{p.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* Legal holds */}
        <section className="card" style={{ marginTop: 'var(--sp-4)' }}>
          <h2 className="card__title">Legal holds</h2>
          <form className="field-inline" onSubmit={(e) => { e.preventDefault(); if (holdCaseId.trim() && holdReason.trim()) placeHold.mutate(); }}>
            <input className="input" aria-label="Case id" placeholder="Case id" value={holdCaseId} onChange={(e) => setHoldCaseId(e.target.value)} />
            <input className="input" aria-label="Hold reason" placeholder="Reason (e.g. enforcement pending)" value={holdReason} onChange={(e) => setHoldReason(e.target.value)} />
            <button className="btn btn--primary" disabled={placeHold.isPending || !holdCaseId.trim() || !holdReason.trim()}>Place hold</button>
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
                  <td>{h.status === 'ACTIVE' && <button className="btn btn--ghost btn--sm" disabled={releaseHold.isPending} onClick={() => releaseHold.mutate(h.id)}>Release</button>}</td>
                </tr>
              )) : <tr><td colSpan={5} className="muted">No legal holds.</td></tr>}
            </tbody>
          </table>
        </section>

        {/* Sweep */}
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
      </div>
    </div>
  );
}
