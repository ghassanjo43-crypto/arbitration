import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Permission } from '@gaap/shared';
import { useAuth } from '../../auth/AuthContext';
import { api } from '../../lib/api';

interface ReviewSummary { ruleCount: number; OK: number; CHANGE_REQUIRED: number; BLOCKER: number; PENDING: number; clearToActivate: boolean }
interface VersionRow { id: string; ruleSetCode: string; version: string; status: string; ruleCount: number; review: ReviewSummary }
interface RuleRow { id: string; number: string; title: string; text: string; review: { status: string; jurisdiction: string | null; note: string | null } }
interface ChapterRow { id: string; number: number; title: string; rules: RuleRow[] }
interface VersionDetail { id: string; version: string; status: string; ruleSet: { code: string; title: string }; review: ReviewSummary; chapters: ChapterRow[] }
interface DiffEntry { number: string; status: string; title: string; changedFields?: string[] }

const STATUSES = ['OK', 'CHANGE_REQUIRED', 'BLOCKER', 'PENDING'];

function apiError(e: unknown): string {
  const m = (e as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message;
  return Array.isArray(m) ? m.join('; ') : (m ?? 'Something went wrong.');
}
function statusBadge(s: string): string {
  return s === 'OK' ? 'badge--success' : s === 'BLOCKER' ? 'badge--danger' : s === 'CHANGE_REQUIRED' ? 'badge--warning' : '';
}

export function AdminRulesReview() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const canManage = !!user?.permissions.includes(Permission.POLICY_MANAGE);

  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [diffBase, setDiffBase] = useState('');

  const versions = useQuery<VersionRow[]>({
    queryKey: ['admin-rule-versions'],
    queryFn: async () => (await api.get('/rules/admin/versions')).data,
    enabled: canManage,
  });
  const detail = useQuery<VersionDetail>({
    queryKey: ['admin-rule-version', selected],
    queryFn: async () => (await api.get(`/rules/admin/versions/${selected}`)).data,
    enabled: canManage && !!selected,
  });
  const diff = useQuery<{ summary: Record<string, number>; entries: DiffEntry[] }>({
    queryKey: ['admin-rule-diff', diffBase, selected],
    queryFn: async () => (await api.get(`/rules/admin/diff?base=${diffBase}&target=${selected}`)).data,
    enabled: canManage && !!selected && !!diffBase,
  });

  const refresh = (msg?: string) => {
    if (msg) { setNotice(msg); setError(null); }
    void qc.invalidateQueries({ queryKey: ['admin-rule-versions'] });
    void qc.invalidateQueries({ queryKey: ['admin-rule-version', selected] });
  };
  const onErr = (e: unknown) => { setError(apiError(e)); setNotice(null); };

  const createDraft = useMutation({
    mutationFn: async (fromVersionId: string) => {
      const label = window.prompt('New draft version label (e.g. 2.0-draft):');
      if (!label) throw new Error('cancelled');
      return (await api.post('/rules/admin/versions', { fromVersionId, version: label })).data;
    },
    onSuccess: (d: { id: string }) => { setSelected(d.id); refresh('Draft version created.'); },
    onError: (e) => { if ((e as Error).message !== 'cancelled') onErr(e); },
  });
  const review = useMutation({
    mutationFn: async (v: { ruleId: string; status: string }) =>
      api.post(`/rules/admin/versions/${selected}/rules/${v.ruleId}/review`, { status: v.status }),
    onSuccess: () => refresh(), onError: onErr,
  });
  const activate = useMutation({
    mutationFn: async (id: string) => api.post(`/rules/admin/versions/${id}/activate`, {}),
    onSuccess: () => refresh('Version activated and prior version superseded.'), onError: onErr,
  });

  if (!canManage) {
    return <div className="section"><div className="container"><div className="alert alert--danger">You do not have policy-management permission.</div></div></div>;
  }

  return (
    <div className="section">
      <div className="container">
        <p className="eyebrow">Administration</p>
        <h1>Rules — counsel review &amp; versioning</h1>
        <p className="muted">The platform records counsel's per-rule decisions and gates activation. It does not perform the legal review; qualified arbitration counsel must clear every rule before a version goes live.</p>

        {notice && <div className="alert alert--success" role="status">{notice}</div>}
        {error && <div className="alert alert--danger" role="alert">{error}</div>}

        <section className="card" style={{ marginTop: 'var(--sp-4)' }}>
          <h2 className="card__title">Versions</h2>
          {versions.isLoading ? <p className="muted">Loading…</p> : (
            <table className="table">
              <thead><tr><th>Rule set</th><th>Version</th><th>Status</th><th>Review</th><th>Actions</th></tr></thead>
              <tbody>
                {versions.data?.map((v) => (
                  <tr key={v.id}>
                    <td>{v.ruleSetCode}</td>
                    <td>{v.version}</td>
                    <td><span className="badge badge--info">{v.status}</span></td>
                    <td>
                      <span className={`badge ${v.review.clearToActivate ? 'badge--success' : ''}`}>{v.review.OK}/{v.review.ruleCount} OK</span>
                      {v.review.BLOCKER > 0 && <span className="badge badge--danger" style={{ marginInlineStart: 4 }}>{v.review.BLOCKER} blocker</span>}
                      {v.review.CHANGE_REQUIRED > 0 && <span className="badge badge--warning" style={{ marginInlineStart: 4 }}>{v.review.CHANGE_REQUIRED} change</span>}
                      {v.review.PENDING > 0 && <span className="badge" style={{ marginInlineStart: 4 }}>{v.review.PENDING} pending</span>}
                    </td>
                    <td>
                      <button className="btn btn--ghost btn--sm" onClick={() => setSelected(v.id)}>Review</button>
                      <button className="btn btn--ghost btn--sm" disabled={createDraft.isPending} onClick={() => createDraft.mutate(v.id)}>Clone to draft</button>
                      {v.status === 'DRAFT' && (
                        <button className="btn btn--primary btn--sm" disabled={!v.review.clearToActivate || activate.isPending}
                          title={v.review.clearToActivate ? 'Activate this version' : 'Every rule must be reviewed OK first'}
                          onClick={() => activate.mutate(v.id)}>Activate</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {selected && detail.data && (
          <section className="card" style={{ marginTop: 'var(--sp-4)' }}>
            <div className="arb-card__meta" style={{ justifyContent: 'space-between' }}>
              <h2 className="card__title">Review — {detail.data.ruleSet.code} {detail.data.version}</h2>
              <span className={`badge ${detail.data.review.clearToActivate ? 'badge--success' : 'badge--warning'}`}>
                {detail.data.review.clearToActivate ? 'Clear to activate' : 'Review incomplete'}
              </span>
            </div>

            {/* Diff against another version */}
            <div className="field-inline" style={{ marginTop: 'var(--sp-3)' }}>
              <label className="field__label" htmlFor="diffbase">Compare against</label>
              <select id="diffbase" className="select" value={diffBase} onChange={(e) => setDiffBase(e.target.value)}>
                <option value="">— select a base version —</option>
                {versions.data?.filter((v) => v.id !== selected).map((v) => <option key={v.id} value={v.id}>{v.ruleSetCode} {v.version}</option>)}
              </select>
            </div>
            {diffBase && diff.data && (
              <p className="field__hint">Diff: {diff.data.summary.added} added · {diff.data.summary.removed} removed · {diff.data.summary.changed} changed · {diff.data.summary.unchanged} unchanged</p>
            )}

            {detail.data.chapters.map((ch) => (
              <div key={ch.id} style={{ marginTop: 'var(--sp-3)' }}>
                <h3 style={{ marginBottom: 4 }}>Ch {ch.number}. {ch.title}</h3>
                <table className="table">
                  <thead><tr><th>Rule</th><th>Title</th><th>Review</th>{detail.data!.status === 'DRAFT' && <th>Decision</th>}</tr></thead>
                  <tbody>
                    {ch.rules.map((r) => {
                      const changed = diff.data?.entries.find((e) => e.number === r.number && (e.status === 'CHANGED' || e.status === 'ADDED'));
                      return (
                        <tr key={r.id}>
                          <td>{r.number}{changed && <span className="badge badge--gold" style={{ marginInlineStart: 4 }}>{changed.status === 'ADDED' ? 'New' : 'Changed'}</span>}</td>
                          <td>{r.title}</td>
                          <td><span className={`badge ${statusBadge(r.review.status)}`}>{r.review.status.replaceAll('_', ' ')}</span></td>
                          {detail.data!.status === 'DRAFT' && (
                            <td>
                              <select className="select" aria-label={`Decision for rule ${r.number}`} value={r.review.status}
                                disabled={review.isPending}
                                onChange={(e) => review.mutate({ ruleId: r.id, status: e.target.value })}>
                                {STATUSES.map((s) => <option key={s} value={s}>{s.replaceAll('_', ' ')}</option>)}
                              </select>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ))}
          </section>
        )}
      </div>
    </div>
  );
}
