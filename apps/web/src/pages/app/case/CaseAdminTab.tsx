import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ORDERED_STAGES } from '@gaap/shared';
import { api } from '../../../lib/api';

interface AdminCase {
  id: string;
  stage: string;
  title: string;
  seat?: string;
  governingLaw?: string;
  language: string;
  category?: string;
  industry?: string;
  numberOfArbitrators?: number;
  appointmentMechanism?: string;
}
interface AdminNote { id: string; note: string; author: string; at: string }
type TabKey = 'delivery' | 'calendar' | 'documents' | 'tribunal';

function apiError(e: unknown): string {
  const m = (e as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message;
  return Array.isArray(m) ? m.join('; ') : (m ?? 'Action not permitted.');
}

/**
 * Registrar case administration. Surfaces the actionable, NON-MERITS controls a
 * registrar needs: edit administrative case info, advance the case stage, and keep
 * an audited administrative note trail — plus quick links to the other operational
 * areas (service/notices, calendar/hearings, documents/filings, appointment).
 * It grants no access to deliberations or awards (those stay tribunal-only).
 */
export function CaseAdminTab({ caseData, goTab }: { caseData: AdminCase; goTab: (t: TabKey) => void }) {
  const qc = useQueryClient();
  const id = caseData.id;
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState({
    title: caseData.title ?? '',
    seat: caseData.seat ?? '',
    governingLaw: caseData.governingLaw ?? '',
    language: caseData.language ?? '',
    category: caseData.category ?? '',
    industry: caseData.industry ?? '',
    numberOfArbitrators: caseData.numberOfArbitrators ?? undefined as number | undefined,
    appointmentMechanism: caseData.appointmentMechanism ?? '',
  });
  const [toStage, setToStage] = useState('');
  const [stageNote, setStageNote] = useState('');
  const [newNote, setNewNote] = useState('');

  const notes = useQuery<AdminNote[]>({ queryKey: ['case-admin-notes', id], queryFn: async () => (await api.get(`/cases/${id}/admin-notes`)).data });

  const ok = (m: string) => { setNotice(m); setError(null); };
  const onErr = (e: unknown) => { setError(apiError(e)); setNotice(null); };
  const refreshCase = () => void qc.invalidateQueries({ queryKey: ['case', id] });

  const saveInfo = useMutation({
    mutationFn: async () => api.patch(`/cases/${id}/admin`, {
      title: form.title || undefined,
      seat: form.seat || undefined,
      governingLaw: form.governingLaw || undefined,
      language: form.language || undefined,
      category: form.category || undefined,
      industry: form.industry || undefined,
      numberOfArbitrators: form.numberOfArbitrators ? Number(form.numberOfArbitrators) : undefined,
      appointmentMechanism: form.appointmentMechanism || undefined,
    }),
    onSuccess: () => { ok('Administrative details updated.'); refreshCase(); }, onError: onErr,
  });
  const transition = useMutation({
    mutationFn: async () => api.post(`/registry/cases/${id}/transition`, { toStage, note: stageNote.trim() || undefined }),
    onSuccess: () => { ok(`Case stage updated to ${toStage.replaceAll('_', ' ')}.`); setStageNote(''); setToStage(''); refreshCase(); }, onError: onErr,
  });
  const addNote = useMutation({
    mutationFn: async () => api.post(`/cases/${id}/admin-notes`, { note: newNote.trim() }),
    onSuccess: () => { ok('Administrative note recorded.'); setNewNote(''); void qc.invalidateQueries({ queryKey: ['case-admin-notes', id] }); }, onError: onErr,
  });

  return (
    <div className="admin-users">
      {notice && <div className="alert alert--success" role="status" onClick={() => setNotice(null)}>{notice}</div>}
      {error && <div className="alert alert--danger" role="alert" onClick={() => setError(null)}>{error}</div>}

      <p className="field__hint" style={{ marginBottom: 'var(--sp-3)' }}>
        Registrar case administration. You administer the arbitration — you cannot access tribunal deliberations,
        draft or issue awards, or decide the merits. All changes here are audited.
      </p>

      {/* Edit administrative information */}
      <section className="card">
        <h2 className="card__title">Administrative details</h2>
        <div className="grid grid-2" style={{ gap: 'var(--sp-2)' }}>
          <label className="field"><span className="field__label">Title</span><input className="input" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} /></label>
          <label className="field"><span className="field__label">Seat</span><input className="input" value={form.seat} onChange={(e) => setForm((f) => ({ ...f, seat: e.target.value }))} /></label>
          <label className="field"><span className="field__label">Governing law</span><input className="input" value={form.governingLaw} onChange={(e) => setForm((f) => ({ ...f, governingLaw: e.target.value }))} /></label>
          <label className="field"><span className="field__label">Language</span><input className="input" value={form.language} onChange={(e) => setForm((f) => ({ ...f, language: e.target.value }))} /></label>
          <label className="field"><span className="field__label">Category</span><input className="input" value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} /></label>
          <label className="field"><span className="field__label">Industry</span><input className="input" value={form.industry} onChange={(e) => setForm((f) => ({ ...f, industry: e.target.value }))} /></label>
          <label className="field"><span className="field__label">No. of arbitrators</span><input className="input" type="number" min={1} value={form.numberOfArbitrators ?? ''} onChange={(e) => setForm((f) => ({ ...f, numberOfArbitrators: e.target.value ? Number(e.target.value) : undefined }))} /></label>
          <label className="field"><span className="field__label">Appointment mechanism</span><input className="input" value={form.appointmentMechanism} onChange={(e) => setForm((f) => ({ ...f, appointmentMechanism: e.target.value }))} /></label>
        </div>
        <button className="btn btn--primary btn--sm" style={{ marginTop: 'var(--sp-2)' }} disabled={saveInfo.isPending} onClick={() => saveInfo.mutate()}>Save administrative details</button>
      </section>

      {/* Update status / stage */}
      <section className="card" style={{ marginTop: 'var(--sp-4)' }}>
        <h2 className="card__title">Case status / stage</h2>
        <p className="field__hint">Current: <span className="badge badge--info">{caseData.stage.replaceAll('_', ' ')}</span> — only administratively permitted transitions are accepted.</p>
        <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap', alignItems: 'center' }}>
          <select className="select" style={{ width: 'auto' }} aria-label="New stage" value={toStage} onChange={(e) => setToStage(e.target.value)}>
            <option value="">Select new stage…</option>
            {ORDERED_STAGES.map((s) => <option key={s} value={s}>{s.replaceAll('_', ' ')}</option>)}
          </select>
          <input className="input" style={{ maxWidth: 280 }} placeholder="Note (optional)" value={stageNote} onChange={(e) => setStageNote(e.target.value)} />
          <button className="btn btn--primary btn--sm" disabled={!toStage || transition.isPending} onClick={() => transition.mutate()}>Update stage</button>
        </div>
      </section>

      {/* Administrative notes */}
      <section className="card" style={{ marginTop: 'var(--sp-4)' }}>
        <h2 className="card__title">Administrative notes</h2>
        <form className="field-inline" onSubmit={(e) => { e.preventDefault(); if (newNote.trim()) addNote.mutate(); }}>
          <input className="input" aria-label="New administrative note" placeholder="Record an administrative note…" value={newNote} onChange={(e) => setNewNote(e.target.value)} />
          <button className="btn btn--primary btn--sm" disabled={!newNote.trim() || addNote.isPending}>Add note</button>
        </form>
        <table className="table" style={{ marginTop: 'var(--sp-3)' }}>
          <thead><tr><th>Note</th><th>By</th><th>When</th></tr></thead>
          <tbody>
            {notes.data?.length ? notes.data.map((n) => (
              <tr key={n.id}><td>{n.note}</td><td className="field__hint">{n.author}</td><td className="field__hint">{new Date(n.at).toLocaleString()}</td></tr>
            )) : <tr><td colSpan={3} className="muted">No administrative notes yet.</td></tr>}
          </tbody>
        </table>
      </section>

      {/* Quick links to the other operational areas (controls live in those tabs) */}
      <section className="card" style={{ marginTop: 'var(--sp-4)' }}>
        <h2 className="card__title">Other administrative actions</h2>
        <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
          <button className="btn btn--ghost btn--sm" onClick={() => goTab('documents')}>Review filings &amp; documents</button>
          <button className="btn btn--ghost btn--sm" onClick={() => goTab('delivery')}>Notices &amp; service / delivery</button>
          <button className="btn btn--ghost btn--sm" onClick={() => goTab('calendar')}>Procedural calendar &amp; hearings</button>
          <button className="btn btn--ghost btn--sm" onClick={() => goTab('tribunal')}>Tribunal appointment</button>
        </div>
      </section>
    </div>
  );
}
