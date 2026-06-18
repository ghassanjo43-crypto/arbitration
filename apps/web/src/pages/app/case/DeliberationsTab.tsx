import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../lib/api';

interface Note { id: string; body: string; authorUserId: string; createdAt: string; }

/** Rendered only for appointed tribunal members. The API independently enforces this. */
export function DeliberationsTab({ caseId }: { caseId: string }) {
  const qc = useQueryClient();
  const [body, setBody] = useState('');

  const { data, isLoading } = useQuery<Note[]>({
    queryKey: ['deliberations', caseId],
    queryFn: async () => (await api.get(`/cases/${caseId}/deliberations`)).data,
  });

  const add = useMutation({
    mutationFn: async () => (await api.post(`/cases/${caseId}/deliberations`, { body })).data,
    onSuccess: () => { setBody(''); void qc.invalidateQueries({ queryKey: ['deliberations', caseId] }); },
  });

  return (
    <div className="grid" style={{ gap: 'var(--sp-5)' }}>
      <div className="alert alert--legal">
        <strong>Restricted area.</strong> Tribunal deliberations are visible only to appointed members of this tribunal —
        never to the parties, registry, administrators, or senior management.
      </div>

      <form className="card" onSubmit={(e) => { e.preventDefault(); if (body.trim()) add.mutate(); }}>
        <h3 className="card__title">Add a deliberation note</h3>
        <textarea className="textarea" rows={4} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Confidential note to the tribunal…" />
        <button className="btn btn--primary" type="submit" disabled={add.isPending} style={{ marginTop: 'var(--sp-3)' }}>
          {add.isPending ? 'Saving…' : 'Add note'}
        </button>
      </form>

      {isLoading ? <p className="muted">Loading…</p> : (
        <div className="grid" style={{ gap: 'var(--sp-3)' }}>
          {data?.length ? data.map((n) => (
            <article key={n.id} className="card" style={{ borderInlineStart: '3px solid var(--accent)' }}>
              <p className="field__hint">{new Date(n.createdAt).toLocaleString()}</p>
              <p className="muted" style={{ marginBottom: 0 }}>{n.body}</p>
            </article>
          )) : <div className="empty-state">No deliberation notes yet.</div>}
        </div>
      )}
    </div>
  );
}
