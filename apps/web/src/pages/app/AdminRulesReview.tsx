import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Permission } from '@gaap/shared';
import { useAuth } from '../../auth/AuthContext';
import { api } from '../../lib/api';

interface ChapterSummary {
  chapterCount: number; reviewed: number; unreviewed: number;
  NO_ISSUE: number; COMMENT: number; CHANGE_REQUESTED: number; BLOCKER: number; APPROVED: number;
  hasBlockers: boolean; hasChangeRequests: boolean; clearForSignOff: boolean; signedOff: boolean; activatable: boolean;
}
interface VersionRow {
  id: string; ruleSetCode: string; version: string; status: string; reviewState: string;
  signedOffAt: string | null; chapterCount: number; ruleCount: number; review: ChapterSummary;
}
interface ChapterRow {
  id: string; number: number; title: string;
  review: { status: string | null; jurisdiction: string | null; reviewedAt: string | null };
  rules: { id: string; number: string; title: string }[];
}
interface CommentRow { id: string; chapterId: string | null; authorId: string; body: string; status: string | null; createdAt: string }
interface VersionDetail {
  id: string; version: string; status: string; reviewState: string; signedOffAt: string | null;
  ruleSet: { code: string; title: string }; review: ChapterSummary; chapters: ChapterRow[]; comments: CommentRow[];
}
interface DiffEntry { number: string; status: string; title: string; changedFields?: string[] }

const CHAPTER_STATUSES = ['NO_ISSUE', 'COMMENT', 'CHANGE_REQUESTED', 'BLOCKER', 'APPROVED'];

function apiError(e: unknown): string {
  const m = (e as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message;
  return Array.isArray(m) ? m.join('; ') : (m ?? 'Something went wrong.');
}
function humanize(s: string | null): string {
  return s ? s.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : '—';
}
function chapterBadge(s: string | null): string {
  return s === 'APPROVED' || s === 'NO_ISSUE' ? 'badge--success'
    : s === 'BLOCKER' ? 'badge--danger'
    : s === 'CHANGE_REQUESTED' ? 'badge--warning'
    : s === 'COMMENT' ? 'badge--info' : '';
}
function stateBadge(s: string): string {
  return s === 'APPROVED' ? 'badge--success' : s === 'BLOCKED' ? 'badge--danger'
    : s === 'CHANGES_REQUESTED' ? 'badge--warning' : 'badge--info';
}

export function AdminRulesReview() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const canManage = !!user?.permissions.includes(Permission.POLICY_MANAGE);

  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [diffBase, setDiffBase] = useState('');
  const [versionComment, setVersionComment] = useState('');

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
  const reviewChapter = useMutation({
    mutationFn: async (v: { chapterId: string; status: string }) =>
      api.post(`/rules/admin/versions/${selected}/chapters/${v.chapterId}/review`, { status: v.status }),
    onSuccess: () => refresh(), onError: onErr,
  });
  const addComment = useMutation({
    mutationFn: async (body: string) => api.post(`/rules/admin/versions/${selected}/comments`, { body }),
    onSuccess: () => { setVersionComment(''); refresh('Comment added.'); }, onError: onErr,
  });
  const signOff = useMutation({
    mutationFn: async (id: string) => api.post(`/rules/admin/versions/${id}/sign-off`, {}),
    onSuccess: () => refresh('Version signed off — ready to activate.'), onError: onErr,
  });
  const activate = useMutation({
    mutationFn: async (id: string) => api.post(`/rules/admin/versions/${id}/activate`, {}),
    onSuccess: () => refresh('Version activated and prior version superseded.'), onError: onErr,
  });
  const archive = useMutation({
    mutationFn: async (id: string) => api.post(`/rules/admin/versions/${id}/archive`, {}),
    onSuccess: () => refresh('Version archived.'), onError: onErr,
  });

  if (!canManage) {
    return <div className="section"><div className="container"><div className="alert alert--danger">You do not have policy-management permission.</div></div></div>;
  }

  return (
    <div className="section">
      <div className="container">
        <p className="eyebrow">Administration</p>
        <h1>Rules — counsel review &amp; versioning</h1>

        {/* Prominent disclaimer (criterion 11). */}
        <div className="alert alert--legal" role="note">
          This is a <strong>workflow for counsel review</strong> — it records reviewers' chapter decisions, comments,
          blockers and sign-off, and gates activation. It is <strong>not a substitute for qualified legal advice</strong>:
          the actual legal sign-off must be performed by qualified arbitration counsel for each relevant seat.
        </div>

        {notice && <div className="alert alert--success" role="status">{notice}</div>}
        {error && <div className="alert alert--danger" role="alert">{error}</div>}

        <section className="card" style={{ marginTop: 'var(--sp-4)' }}>
          <h2 className="card__title">Rule versions</h2>
          {versions.isLoading ? <p className="muted">Loading…</p> : (
            <table className="table">
              <thead><tr><th>Rule set</th><th>Version</th><th>Lifecycle</th><th>Review state</th><th>Chapters</th><th>Actions</th></tr></thead>
              <tbody>
                {versions.data?.map((v) => (
                  <tr key={v.id}>
                    <td>{v.ruleSetCode}</td>
                    <td>{v.version}</td>
                    <td><span className="badge badge--info">{humanize(v.status)}</span></td>
                    <td>
                      <span className={`badge ${stateBadge(v.reviewState)}`}>{humanize(v.reviewState)}</span>
                      {v.signedOffAt && <span className="badge badge--success" style={{ marginInlineStart: 4 }}>Signed off</span>}
                    </td>
                    <td>
                      <span className={`badge ${v.review.clearForSignOff ? 'badge--success' : ''}`}>{v.review.APPROVED + v.review.NO_ISSUE}/{v.review.chapterCount} clear</span>
                      {v.review.BLOCKER > 0 && <span className="badge badge--danger" style={{ marginInlineStart: 4 }}>{v.review.BLOCKER} blocker</span>}
                      {v.review.CHANGE_REQUESTED > 0 && <span className="badge badge--warning" style={{ marginInlineStart: 4 }}>{v.review.CHANGE_REQUESTED} change</span>}
                      {v.review.unreviewed > 0 && <span className="badge" style={{ marginInlineStart: 4 }}>{v.review.unreviewed} unreviewed</span>}
                    </td>
                    <td>
                      <button className="btn btn--ghost btn--sm" onClick={() => setSelected(v.id)}>Review</button>
                      <button className="btn btn--ghost btn--sm" disabled={createDraft.isPending} onClick={() => createDraft.mutate(v.id)}>Clone to draft</button>
                      {v.status === 'DRAFT' && !v.signedOffAt && (
                        <button className="btn btn--ghost btn--sm" disabled={!v.review.clearForSignOff || signOff.isPending}
                          title={v.review.clearForSignOff ? 'Final sign-off' : 'Resolve all blockers/changes and review every chapter first'}
                          onClick={() => signOff.mutate(v.id)}>Sign off</button>
                      )}
                      {v.status === 'DRAFT' && (
                        <button className="btn btn--primary btn--sm" disabled={!v.review.activatable || activate.isPending}
                          title={v.review.activatable ? 'Activate this version' : 'Requires final sign-off first'}
                          onClick={() => activate.mutate(v.id)}>Activate</button>
                      )}
                      {v.status !== 'ACTIVE' && v.status !== 'ARCHIVED' && (
                        <button className="btn btn--ghost btn--sm" disabled={archive.isPending} onClick={() => archive.mutate(v.id)}>Archive</button>
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
              <span className={`badge ${stateBadge(detail.data.reviewState)}`}>{humanize(detail.data.reviewState)}</span>
            </div>

            {/* Diff against another version (criterion 6). */}
            <div className="field-inline" style={{ marginTop: 'var(--sp-3)' }}>
              <label className="field__label" htmlFor="diffbase">Compare against</label>
              <select id="diffbase" className="select" value={diffBase} onChange={(e) => setDiffBase(e.target.value)}>
                <option value="">— select a base version —</option>
                {versions.data?.filter((v) => v.id !== selected).map((v) => <option key={v.id} value={v.id}>{v.ruleSetCode} {v.version}</option>)}
              </select>
            </div>
            {diffBase && diff.data && (
              <p className="field__hint">Diff vs base: {diff.data.summary.added} added · {diff.data.summary.removed} removed · {diff.data.summary.changed} changed · {diff.data.summary.unchanged} unchanged</p>
            )}

            {/* Chapter-by-chapter review (criteria 3, 4). */}
            <h3 style={{ marginTop: 'var(--sp-4)' }}>Chapters</h3>
            <table className="table">
              <thead><tr><th>Ch.</th><th>Title</th><th>Rules</th><th>Review</th>{detail.data.status === 'DRAFT' && <th>Decision</th>}</tr></thead>
              <tbody>
                {detail.data.chapters.map((ch) => {
                  const changedRules = ch.rules.filter((r) => diff.data?.entries.some((e) => e.number === r.number && (e.status === 'CHANGED' || e.status === 'ADDED'))).length;
                  return (
                    <tr key={ch.id}>
                      <td>{ch.number}</td>
                      <td>{ch.title}{changedRules > 0 && <span className="badge badge--gold" style={{ marginInlineStart: 4 }}>{changedRules} changed</span>}</td>
                      <td>{ch.rules.length}</td>
                      <td><span className={`badge ${chapterBadge(ch.review.status)}`}>{ch.review.status ? humanize(ch.review.status) : 'Not reviewed'}</span></td>
                      {detail.data!.status === 'DRAFT' && (
                        <td>
                          <select className="select" aria-label={`Decision for chapter ${ch.number}`} value={ch.review.status ?? ''}
                            disabled={reviewChapter.isPending}
                            onChange={(e) => reviewChapter.mutate({ chapterId: ch.id, status: e.target.value })}>
                            <option value="" disabled>— decide —</option>
                            {CHAPTER_STATUSES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
                          </select>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Comment log (criterion 5). */}
            <h3 style={{ marginTop: 'var(--sp-4)' }}>Reviewer comments</h3>
            {detail.data.comments.length ? (
              <ul className="timeline">
                {detail.data.comments.map((c) => (
                  <li key={c.id} className="timeline__item">
                    <span className="timeline__dot" aria-hidden="true" />
                    {c.status && <span className={`badge ${chapterBadge(c.status)}`} style={{ marginInlineEnd: 6 }}>{humanize(c.status)}</span>}
                    {c.body}
                    <span className="field__hint"> — {new Date(c.createdAt).toLocaleString()}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="muted">No comments yet.</p>}
            {detail.data.status === 'DRAFT' && (
              <form className="field-inline" style={{ marginTop: 'var(--sp-3)' }} onSubmit={(e) => { e.preventDefault(); if (versionComment.trim()) addComment.mutate(versionComment.trim()); }}>
                <input className="input" aria-label="Add a comment" placeholder="Add a review comment…" value={versionComment} onChange={(e) => setVersionComment(e.target.value)} />
                <button className="btn btn--ghost" disabled={addComment.isPending || !versionComment.trim()}>Comment</button>
              </form>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
