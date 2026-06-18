import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Permission } from '@gaap/shared';
import { useAuth } from '../../auth/AuthContext';
import { api } from '../../lib/api';

interface NewsItem { id: string; title: string; excerpt?: string; category?: string; status: string; }

export function AdminContent() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const canManage = !!user?.permissions.includes(Permission.NEWS_MANAGE);

  const { data, isLoading } = useQuery<NewsItem[]>({
    queryKey: ['admin-news'],
    queryFn: async () => (await api.get('/admin/content/news')).data,
    enabled: canManage,
  });

  const [title, setTitle] = useState('');
  const [excerpt, setExcerpt] = useState('');
  const [category, setCategory] = useState('');
  const [body, setBody] = useState('');

  const create = useMutation({
    mutationFn: async () => api.post('/admin/content/news', { title, excerpt, category, body }),
    onSuccess: () => { setTitle(''); setExcerpt(''); setCategory(''); setBody(''); void qc.invalidateQueries({ queryKey: ['admin-news'] }); },
  });
  const publish = useMutation({
    mutationFn: async (id: string) => api.post(`/admin/content/news/${id}/publish`, {}),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin-news'] }),
  });
  const archive = useMutation({
    mutationFn: async (id: string) => api.post(`/admin/content/news/${id}/archive`, {}),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin-news'] }),
  });

  if (!canManage) {
    return <div className="section"><div className="container"><div className="alert alert--danger">You do not have content-management permission.</div></div></div>;
  }

  return (
    <div className="section">
      <div className="container">
        <p className="eyebrow">Administration</p>
        <h1>Content management — Legal News</h1>

        <form className="card" onSubmit={(e) => { e.preventDefault(); if (title && body) create.mutate(); }}>
          <h3 className="card__title">New article</h3>
          <div className="grid grid-2">
            <div className="field"><label htmlFor="t">Title</label><input id="t" className="input" value={title} onChange={(e) => setTitle(e.target.value)} required /></div>
            <div className="field"><label htmlFor="c">Category</label><input id="c" className="input" value={category} onChange={(e) => setCategory(e.target.value)} /></div>
          </div>
          <div className="field"><label htmlFor="e">Excerpt</label><input id="e" className="input" value={excerpt} onChange={(e) => setExcerpt(e.target.value)} /></div>
          <div className="field"><label htmlFor="b">Body</label><textarea id="b" className="textarea" rows={4} value={body} onChange={(e) => setBody(e.target.value)} required /></div>
          <button className="btn btn--primary" disabled={create.isPending}>{create.isPending ? 'Saving…' : 'Create draft'}</button>
        </form>

        <h2 style={{ marginTop: 'var(--sp-6)' }}>All articles</h2>
        {isLoading ? <p className="muted">Loading…</p> : (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <table className="table">
              <thead><tr><th>Title</th><th>Category</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {data?.length ? data.map((n) => (
                  <tr key={n.id}>
                    <td>{n.title}</td>
                    <td>{n.category ?? '—'}</td>
                    <td><span className={`badge ${n.status === 'PUBLISHED' ? 'badge--success' : n.status === 'ARCHIVED' ? 'badge--warning' : 'badge--info'}`}>{n.status}</span></td>
                    <td style={{ display: 'flex', gap: 'var(--sp-2)' }}>
                      {n.status !== 'PUBLISHED' && <button className="btn btn--ghost" onClick={() => publish.mutate(n.id)}>Publish</button>}
                      {n.status === 'PUBLISHED' && <button className="btn btn--ghost" onClick={() => archive.mutate(n.id)}>Archive</button>}
                    </td>
                  </tr>
                )) : <tr><td colSpan={4}><span className="muted">No articles yet.</span></td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
