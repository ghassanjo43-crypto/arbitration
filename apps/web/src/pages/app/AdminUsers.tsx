import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Permission, Role, ROLE_LABELS } from '@gaap/shared';
import { useAuth } from '../../auth/AuthContext';
import { api } from '../../lib/api';

interface AdminUser {
  id: string;
  email: string;
  displayName: string;
  status: string;
  emailVerified: boolean;
  roles: string[];
  deletedAt: string | null;
}

const STATUS_OPTIONS = ['ACTIVE', 'SUSPENDED', 'DEACTIVATED'];
const ASSIGNABLE_ROLES = Object.values(Role);

export function AdminUsers() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const canManage = !!user?.permissions.includes(Permission.USER_MANAGE);
  const canManageRoles = !!user?.permissions.includes(Permission.ROLE_MANAGE);

  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [editingRoles, setEditingRoles] = useState<string | null>(null);
  const [roleDraft, setRoleDraft] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery<{ data: AdminUser[]; total: number }>({
    queryKey: ['admin-users', search],
    queryFn: async () => (await api.get('/admin/users', { params: { q: search || undefined, pageSize: 100 } })).data,
    enabled: canManage,
  });

  const invalidate = () => void qc.invalidateQueries({ queryKey: ['admin-users'] });
  const wrap = <T,>(fn: () => Promise<T>) => fn().catch((e: { response?: { data?: { message?: string } } }) => {
    setError(e.response?.data?.message ?? 'Action not permitted.');
  });

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => api.patch(`/admin/users/${id}`, { status }),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/users/${id}`),
    onSuccess: invalidate,
  });
  const restore = useMutation({
    mutationFn: (id: string) => api.post(`/admin/users/${id}/restore`, {}),
    onSuccess: invalidate,
  });
  const saveRoles = useMutation({
    mutationFn: ({ id, roles }: { id: string; roles: string[] }) => api.put(`/admin/users/${id}/roles`, { roles }),
    onSuccess: () => { setEditingRoles(null); invalidate(); },
  });

  if (!canManage) {
    return <div className="section"><div className="container"><div className="alert alert--danger">You do not have user-management permission.</div></div></div>;
  }

  return (
    <div className="section">
      <div className="container">
        <p className="eyebrow">Administration</p>
        <h1>User management</h1>
        <p className="muted">Edit account status and roles, or remove (deactivate) any user. Removal is a soft delete — records are retained and sessions are revoked.</p>

        {error && <div className="alert alert--danger" role="alert" onClick={() => setError(null)}>{error}</div>}

        <form className="directory-search" onSubmit={(e) => { e.preventDefault(); setSearch(q); }} role="search">
          <input className="input" placeholder="Search by email or name" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="btn btn--primary" type="submit">Search</button>
        </form>

        {isLoading ? <p className="muted">Loading…</p> : (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <table className="table">
              <thead>
                <tr><th>Email</th><th>Name</th><th>Roles</th><th>Status</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {data?.data.map((u) => {
                  const isSelf = u.id === user?.id;
                  const isSuper = u.roles.includes(Role.SUPER_ADMIN);
                  const locked = isSuper && !canManageRoles; // a plain admin cannot touch a super-admin
                  return (
                    <tr key={u.id} style={u.deletedAt ? { opacity: 0.55 } : undefined}>
                      <td>{u.email}{!u.emailVerified && <span className="badge badge--warning" style={{ marginInlineStart: 6 }}>unverified</span>}</td>
                      <td>{u.displayName}{isSelf && <span className="field__hint"> (you)</span>}</td>
                      <td>
                        {editingRoles === u.id ? (
                          <div className="role-editor">
                            {ASSIGNABLE_ROLES.map((r) => (
                              <label key={r} className="check-row">
                                <input
                                  type="checkbox"
                                  checked={roleDraft.includes(r)}
                                  onChange={(e) => setRoleDraft((d) => e.target.checked ? [...d, r] : d.filter((x) => x !== r))}
                                /> {ROLE_LABELS[r]}
                              </label>
                            ))}
                            <div style={{ display: 'flex', gap: 'var(--sp-2)', marginTop: 'var(--sp-2)' }}>
                              <button className="btn btn--primary" onClick={() => wrap(() => saveRoles.mutateAsync({ id: u.id, roles: roleDraft }))}>Save</button>
                              <button className="btn btn--ghost" onClick={() => setEditingRoles(null)}>Cancel</button>
                            </div>
                          </div>
                        ) : (
                          u.roles.map((r) => <span key={r} className="badge badge--gold">{ROLE_LABELS[r as Role] ?? r}</span>)
                        )}
                      </td>
                      <td><span className={`badge ${u.status === 'ACTIVE' ? 'badge--success' : u.status === 'SUSPENDED' ? 'badge--warning' : ''}`}>{u.status.replaceAll('_', ' ')}</span></td>
                      <td>
                        <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap', alignItems: 'center' }}>
                          <select
                            className="select"
                            style={{ width: 'auto' }}
                            value={STATUS_OPTIONS.includes(u.status) ? u.status : ''}
                            disabled={locked || (isSelf)}
                            onChange={(e) => wrap(() => setStatus.mutateAsync({ id: u.id, status: e.target.value }))}
                          >
                            {!STATUS_OPTIONS.includes(u.status) && <option value="">{u.status}</option>}
                            {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                          </select>
                          {canManageRoles && !u.deletedAt && (
                            <button className="btn btn--ghost" onClick={() => { setEditingRoles(u.id); setRoleDraft(u.roles); }}>Roles</button>
                          )}
                          {u.deletedAt ? (
                            <button className="btn btn--ghost" onClick={() => wrap(() => restore.mutateAsync(u.id))}>Restore</button>
                          ) : (
                            <button
                              className="btn btn--ghost"
                              style={{ color: 'var(--c-danger)' }}
                              disabled={locked || isSelf}
                              onClick={() => { if (confirm(`Remove ${u.email}? This deactivates the account and revokes sessions.`)) void wrap(() => remove.mutateAsync(u.id)); }}
                            >Remove</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
