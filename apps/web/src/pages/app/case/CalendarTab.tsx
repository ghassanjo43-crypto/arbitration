import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Permission } from '@gaap/shared';
import { api } from '../../../lib/api';
import { useAuth } from '../../../auth/AuthContext';

interface Deadline { id: string; title: string; description?: string; dueAt: string; status: string; }
interface Room { kind: string; name: string; joinUrl?: string; }
interface Hearing { id: string; title: string; scheduledStart: string; status: string; rooms: Room[]; }

export function CalendarTab({ caseId, isTribunal }: { caseId: string; isTribunal: boolean }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const canManageDeadlines = isTribunal || !!user?.permissions.includes(Permission.CASE_MANAGE_DEADLINES);
  const canScheduleHearing = isTribunal || !!user?.permissions.includes(Permission.CASE_SCHEDULE_HEARING);

  const deadlines = useQuery<Deadline[]>({ queryKey: ['deadlines', caseId], queryFn: async () => (await api.get(`/cases/${caseId}/deadlines`)).data });
  const hearings = useQuery<Hearing[]>({ queryKey: ['hearings', caseId], queryFn: async () => (await api.get(`/cases/${caseId}/hearings`)).data });

  const [dTitle, setDTitle] = useState('');
  const [dDue, setDDue] = useState('');
  const addDeadline = useMutation({
    mutationFn: async () => (await api.post(`/cases/${caseId}/deadlines`, { title: dTitle, dueAt: new Date(dDue).toISOString() })).data,
    onSuccess: () => { setDTitle(''); setDDue(''); void qc.invalidateQueries({ queryKey: ['deadlines', caseId] }); },
  });

  const [hTitle, setHTitle] = useState('');
  const [hStart, setHStart] = useState('');
  const addHearing = useMutation({
    mutationFn: async () => (await api.post(`/cases/${caseId}/hearings`, { title: hTitle, scheduledStart: new Date(hStart).toISOString() })).data,
    onSuccess: () => { setHTitle(''); setHStart(''); void qc.invalidateQueries({ queryKey: ['hearings', caseId] }); },
  });

  return (
    <div className="grid grid-2" style={{ gap: 'var(--sp-5)', alignItems: 'start' }}>
      <div className="card">
        <h3 className="card__title">Deadlines</h3>
        {canManageDeadlines && (
          <form className="field-inline" onSubmit={(e) => { e.preventDefault(); if (dTitle && dDue) addDeadline.mutate(); }}>
            <input className="input" placeholder="Title" value={dTitle} onChange={(e) => setDTitle(e.target.value)} />
            <input className="input" type="datetime-local" value={dDue} onChange={(e) => setDDue(e.target.value)} />
            <button className="btn btn--primary" disabled={addDeadline.isPending}>Add</button>
          </form>
        )}
        <ul className="timeline" style={{ marginTop: 'var(--sp-4)' }}>
          {deadlines.data?.length ? deadlines.data.map((d) => (
            <li key={d.id} className="timeline__item">
              <span className="timeline__dot" aria-hidden="true" />
              <strong>{d.title}</strong> — <span className="muted">{new Date(d.dueAt).toLocaleString()}</span>
              <span className="badge" style={{ marginInlineStart: 8 }}>{d.status}</span>
            </li>
          )) : <p className="muted">No deadlines.</p>}
        </ul>
      </div>

      <div className="card">
        <h3 className="card__title">Hearings</h3>
        {canScheduleHearing && (
          <form className="field-inline" onSubmit={(e) => { e.preventDefault(); if (hTitle && hStart) addHearing.mutate(); }}>
            <input className="input" placeholder="Title" value={hTitle} onChange={(e) => setHTitle(e.target.value)} />
            <input className="input" type="datetime-local" value={hStart} onChange={(e) => setHStart(e.target.value)} />
            <button className="btn btn--primary" disabled={addHearing.isPending}>Schedule</button>
          </form>
        )}
        <div className="grid" style={{ gap: 'var(--sp-3)', marginTop: 'var(--sp-4)' }}>
          {hearings.data?.length ? hearings.data.map((h) => (
            <div key={h.id} className="card" style={{ background: 'var(--bg-raised)' }}>
              <strong>{h.title}</strong>
              <p className="field__hint">{new Date(h.scheduledStart).toLocaleString()} · <span className="badge">{h.status}</span></p>
              <div className="arb-card__fields">{h.rooms.map((r) => <span key={r.kind} className="badge badge--gold">{r.name}</span>)}</div>
            </div>
          )) : <p className="muted">No hearings scheduled.</p>}
        </div>
      </div>
    </div>
  );
}
