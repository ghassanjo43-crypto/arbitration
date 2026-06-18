import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../lib/api';
import { useAuth } from '../../../auth/AuthContext';

interface Message {
  id: string;
  category: string;
  subject: string;
  body: string;
  restricted: boolean;
  createdAt: string;
  sender: { email: string; profile?: { displayName?: string } };
  recipients: { readAt: string | null }[];
}

// Party users only get the substantive/general categories; ADMIN_PRIVATE is registry-only.
const PARTY_CATEGORIES = ['PARTY_SUBMISSION', 'PROCEDURAL', 'GENERAL'];
const STAFF_CATEGORIES = ['REGISTRAR_NOTICE', 'TRIBUNAL_NOTICE', 'PROCEDURAL', 'GENERAL', 'ADMIN_PRIVATE'];

export function MessagesTab({ caseId }: { caseId: string }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const isStaff = (user?.permissions.length ?? 0) > 0;
  const categories = isStaff ? STAFF_CATEGORIES : PARTY_CATEGORIES;

  const [category, setCategory] = useState(categories[0]);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');

  const { data, isLoading } = useQuery<Message[]>({
    queryKey: ['messages', caseId],
    queryFn: async () => (await api.get(`/cases/${caseId}/messages`)).data,
  });

  const send = useMutation({
    mutationFn: async () => (await api.post(`/cases/${caseId}/messages`, { category, subject, body })).data,
    onSuccess: () => { setSubject(''); setBody(''); void qc.invalidateQueries({ queryKey: ['messages', caseId] }); },
  });

  return (
    <div className="grid" style={{ gap: 'var(--sp-5)' }}>
      <form className="card" onSubmit={(e) => { e.preventDefault(); if (subject && body) send.mutate(); }}>
        <h3 className="card__title">New message</h3>
        <div className="alert alert--legal" style={{ marginBottom: 'var(--sp-4)' }}>
          Substantive communications are shared with all authorised parties. Private contact with the tribunal is not permitted.
        </div>
        <div className="grid grid-2">
          <div className="field">
            <label htmlFor="m-cat">Category</label>
            <select id="m-cat" className="select" value={category} onChange={(e) => setCategory(e.target.value)}>
              {categories.map((c) => <option key={c} value={c}>{c.replaceAll('_', ' ')}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="m-sub">Subject</label>
            <input id="m-sub" className="input" value={subject} onChange={(e) => setSubject(e.target.value)} required />
          </div>
        </div>
        <div className="field">
          <label htmlFor="m-body">Message</label>
          <textarea id="m-body" className="textarea" rows={4} value={body} onChange={(e) => setBody(e.target.value)} required />
        </div>
        <button className="btn btn--primary" type="submit" disabled={send.isPending}>{send.isPending ? 'Sending…' : 'Send'}</button>
        {send.isError && <div className="alert alert--danger" style={{ marginTop: 'var(--sp-3)' }}>Could not send (not permitted for your role).</div>}
      </form>

      {isLoading ? <p className="muted">Loading…</p> : (
        <div className="grid" style={{ gap: 'var(--sp-3)' }}>
          {data?.length ? data.map((m) => (
            <article key={m.id} className="card">
              <div className="arb-card__meta" style={{ justifyContent: 'space-between' }}>
                <span className="badge badge--info">{m.category.replaceAll('_', ' ')}</span>
                <span className="field__hint">{new Date(m.createdAt).toLocaleString()}</span>
              </div>
              <h4 style={{ margin: 'var(--sp-2) 0 4px' }}>{m.subject}</h4>
              <p className="field__hint">From {m.sender.profile?.displayName ?? m.sender.email}{m.restricted ? ' · administrative' : ''}</p>
              <p className="muted" style={{ marginBottom: 0 }}>{m.body}</p>
            </article>
          )) : <div className="empty-state">No messages yet.</div>}
        </div>
      )}
    </div>
  );
}
