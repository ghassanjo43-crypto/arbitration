import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ASSIGNABLE_IDENTITY_TYPES, CASE_ROLE_LABELS, IDENTITY_TYPE_LABELS, Permission, Role, ROLE_LABELS } from '@gaap/shared';
import { useAuth } from '../../auth/AuthContext';
import { api } from '../../lib/api';

interface AdminUser {
  id: string;
  email: string;
  displayName: string;
  firstName: string | null;
  lastName: string | null;
  status: string;
  emailVerified: boolean;
  roles: string[];
  identityType: string;
  caseRoles: string[];
  linkedRecordCount: number | null; // 0 = unlinked (hard-deletable); >0 or null = archive only
  deletedAt: string | null;
}

const STATUS_OPTIONS = ['ACTIVE', 'SUSPENDED', 'DEACTIVATED'];
const ASSIGNABLE_ROLES = Object.values(Role);

function apiError(e: unknown): string {
  const m = (e as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message;
  return Array.isArray(m) ? m.join('; ') : (m ?? 'Action not permitted.');
}

/**
 * Describe a user's case role(s) for display. Claimant/Respondent are case roles,
 * not generic site roles — and a party not yet attached to a case shows a clear
 * "pending" status instead of any generic classification.
 */
function caseRoleSummary(identityType: string, caseRoles: string[]): string[] {
  const isParty = identityType === 'INDIVIDUAL' || identityType === 'COMPANY';
  if (!caseRoles.length) return isParty ? ['Party account — pending case-role assignment'] : [];
  const prefix = identityType === 'COMPANY' ? 'Company' : identityType === 'INDIVIDUAL' ? 'Individual' : '';
  return caseRoles.map((cr) => {
    const label = (CASE_ROLE_LABELS as Record<string, string>)[cr] ?? cr.replaceAll('_', ' ');
    return isParty && (cr === 'CLAIMANT' || cr === 'RESPONDENT') ? `${prefix} ${label}`.trim() : label;
  });
}

export function AdminUsers() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const canManage = !!user?.permissions.includes(Permission.USER_MANAGE);
  const canManageRoles = !!user?.permissions.includes(Permission.ROLE_MANAGE);

  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [editingRoles, setEditingRoles] = useState<string | null>(null);
  const [roleDraft, setRoleDraft] = useState<string[]>([]);
  const [editingDetails, setEditingDetails] = useState<string | null>(null);
  const [detailDraft, setDetailDraft] = useState<{ firstName: string; lastName: string; email: string; emailVerified: boolean }>({ firstName: '', lastName: '', email: '', emailVerified: false });
  const [showCreate, setShowCreate] = useState(false);
  const [createDraft, setCreateDraft] = useState<{ email: string; firstName: string; lastName: string; roles: string[] }>({ email: '', firstName: '', lastName: '', roles: [] });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [savingUserId, setSavingUserId] = useState<string | null>(null);
  const [linkFilter, setLinkFilter] = useState<'all' | 'eligible' | 'linked' | 'archived'>('all');
  const [blockersFor, setBlockersFor] = useState<{ id: string; blockers: Record<string, number> } | null>(null);

  const { data, isLoading } = useQuery<{ data: AdminUser[]; total: number }>({
    queryKey: ['admin-users', search],
    queryFn: async () => (await api.get('/admin/users', { params: { q: search || undefined, pageSize: 100 } })).data,
    enabled: canManage,
  });

  const invalidate = () => void qc.invalidateQueries({ queryKey: ['admin-users'] });
  const wrap = <T,>(fn: () => Promise<T>) => fn().catch((e: unknown) => { setError(apiError(e)); setNotice(null); });

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => api.patch(`/admin/users/${id}`, { status }),
    onSuccess: invalidate,
  });
  // Archive (soft-delete) is always allowed; permanent delete is only for unlinked
  // accounts and is refused server-side otherwise (the error lists the blockers).
  const archive = useMutation({
    mutationFn: (id: string) => api.post(`/admin/users/${id}/archive`, {}),
    onSuccess: () => { setNotice('User archived'); setError(null); invalidate(); },
    onError: (e: unknown) => { setError(apiError(e)); setNotice(null); },
  });
  const hardDelete = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/users/${id}`),
    onSuccess: () => { setNotice('User permanently deleted'); setError(null); invalidate(); void qc.invalidateQueries({ queryKey: ['admin-arbitrators'] }); },
    onError: (e: unknown) => { setError(apiError(e)); setNotice(null); },
  });
  // On-demand "why is this account not deletable?" — fetches the blocker breakdown.
  const checkLinks = useMutation({
    mutationFn: (id: string) => api.get(`/admin/users/${id}/delete-check`).then((r) => r.data as { id: string; blockers: Record<string, number> }),
    onSuccess: (d) => { setBlockersFor({ id: d.id, blockers: d.blockers }); setError(null); },
    onError: (e: unknown) => { setError(apiError(e)); },
  });
  const restore = useMutation({ mutationFn: (id: string) => api.post(`/admin/users/${id}/restore`, {}), onSuccess: invalidate });
  const saveRoles = useMutation({
    mutationFn: ({ id, roles }: { id: string; roles: string[] }) => api.put(`/admin/users/${id}/roles`, { roles }),
    onSuccess: () => { setEditingRoles(null); invalidate(); void qc.invalidateQueries({ queryKey: ['admin-arbitrators'] }); },
  });
  const setIdentity = useMutation({
    mutationFn: ({ id, identityType }: { id: string; identityType: string }) => api.patch(`/admin/users/${id}/identity`, { identityType }),
    onSuccess: () => { invalidate(); void qc.invalidateQueries({ queryKey: ['admin-arbitrators'] }); },
  });
  // Plain, deterministic save — NO mutation callbacks, NO native confirm, NO form
  // submit. Local savingUserId drives the button so "Saving…" appears the instant
  // it is clicked; success/failure are handled inline in this one function.
  async function handleSaveUserDetails(u: AdminUser) {
    setSavingUserId(u.id);
    setError(null);
    setNotice(null);
    const nextEmail = detailDraft.email.trim().toLowerCase();
    try {
      // Admin user update endpoint (supports email changes). Sends the edited email.
      const res = await api.patch(`/admin/users/${u.id}`, {
        firstName: detailDraft.firstName,
        lastName: detailDraft.lastName,
        email: detailDraft.email,
        emailVerified: detailDraft.emailVerified,
      });
      const updated = res?.data;
      // Deterministically reflect the saved row immediately (then reconcile via refetch).
      qc.setQueryData(['admin-users', search], (old: { data: AdminUser[]; total: number } | undefined) =>
        old
          ? { ...old, data: old.data.map((r) => (r.id === u.id
              ? { ...r, ...(updated && typeof updated === 'object' ? updated : {}), email: nextEmail, firstName: detailDraft.firstName, lastName: detailDraft.lastName, emailVerified: detailDraft.emailVerified }
              : r)) }
          : old);
      setEditingDetails(null);
      setEditingRoles(null);
      setNotice('User updated');
      invalidate();
      void qc.invalidateQueries({ queryKey: ['admin-arbitrators'] });
    } catch (err) {
      setError(apiError(err)); // keep edit mode open; input preserved
    } finally {
      setSavingUserId(null);
    }
  }
  const createUser = useMutation({
    mutationFn: (body: { email: string; firstName: string; lastName: string; roles: string[] }) =>
      api.post('/admin/users', body).then((r) => r.data as { temporaryPassword?: string }),
    onSuccess: (res) => {
      setShowCreate(false);
      setCreateDraft({ email: '', firstName: '', lastName: '', roles: [] });
      setNotice(res.temporaryPassword ? `User created. Temporary password (shown once): ${res.temporaryPassword}` : 'User created.');
      setError(null);
      invalidate();
    },
  });
  const resetPassword = useMutation({
    mutationFn: ({ id, sendEmail }: { id: string; sendEmail: boolean }) =>
      api.post(`/admin/users/${id}/reset-password`, { sendEmail }).then((r) => r.data as { temporaryPassword?: string; mode: string }),
    onSuccess: (res) => {
      setNotice(res.temporaryPassword ? `Password reset. Temporary password (shown once): ${res.temporaryPassword}` : 'Password-reset link e-mailed to the user.');
      setError(null);
    },
  });

  if (!canManage) {
    return <div className="section"><div className="container"><div className="alert alert--danger">You do not have user-management permission.</div></div></div>;
  }

  return (
    <div className="section">
      <div className="container">
        <p className="eyebrow">Administration</p>
        <h1>User management</h1>
        <p className="muted">Create, edit and manage platform accounts: details, roles, status and passwords. This is platform administration only — it grants no access to tribunal deliberations or case merits, which remain gated by case membership. Removal is a soft delete: records are retained and sessions are revoked.</p>
        <div className="alert alert--info" role="note">
          Users are classified by their <strong>legal identity</strong> and by their <strong>role in each arbitration case</strong>.
          Claimant and Respondent are case roles, not generic website roles.
        </div>
        <div className="alert alert--legal" role="note">
          <strong>Permanent delete is available only for unused accounts with no linked platform records.</strong> Linked
          accounts can only be <strong>archived</strong> to preserve case history, audit logs, awards and arbitrator records.
        </div>

        {notice && <div className="alert alert--success" role="status" onClick={() => setNotice(null)}>{notice}</div>}
        {error && <div className="alert alert--danger" role="alert" onClick={() => setError(null)}>{error}</div>}

        <div style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center', flexWrap: 'wrap' }}>
          <form className="directory-search" onSubmit={(e) => { e.preventDefault(); setSearch(q); }} role="search">
            <input className="input" placeholder="Search by email or name" value={q} onChange={(e) => setQ(e.target.value)} />
            <button className="btn btn--primary" type="submit">Search</button>
          </form>
          <label className="field" style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
            <span className="field__hint">Show</span>
            <select className="select" style={{ width: 'auto' }} aria-label="Filter users" value={linkFilter} onChange={(e) => setLinkFilter(e.target.value as typeof linkFilter)}>
              <option value="all">All users</option>
              <option value="eligible">Delete-eligible (unlinked)</option>
              <option value="linked">Linked (archive only)</option>
              <option value="archived">Archived</option>
            </select>
          </label>
          <button className="btn btn--secondary" onClick={() => { setShowCreate((s) => !s); setError(null); }}>{showCreate ? 'Close' : 'Create user'}</button>
        </div>

        {showCreate && (
          <section className="card" style={{ marginTop: 'var(--sp-3)' }}>
            <h2 className="card__title">Create user</h2>
            <form
              onSubmit={(e) => { e.preventDefault(); if (createDraft.email && createDraft.firstName && createDraft.lastName) void wrap(() => createUser.mutateAsync(createDraft)); }}
              style={{ display: 'grid', gap: 'var(--sp-2)', maxWidth: 520 }}
            >
              <input className="input" type="email" placeholder="Email" value={createDraft.email} onChange={(e) => setCreateDraft((d) => ({ ...d, email: e.target.value }))} required />
              <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
                <input className="input" placeholder="First name" value={createDraft.firstName} onChange={(e) => setCreateDraft((d) => ({ ...d, firstName: e.target.value }))} required />
                <input className="input" placeholder="Last name" value={createDraft.lastName} onChange={(e) => setCreateDraft((d) => ({ ...d, lastName: e.target.value }))} required />
              </div>
              <fieldset style={{ border: '1px solid var(--c-border)', borderRadius: 6, padding: 'var(--sp-2)' }}>
                <legend className="field__hint">Roles {canManageRoles ? '' : '(staff/admin roles need super-admin)'}</legend>
                {ASSIGNABLE_ROLES.map((r) => (
                  <label key={r} className="check-row" style={{ display: 'inline-flex', marginInlineEnd: 'var(--sp-3)' }}>
                    <input type="checkbox" checked={createDraft.roles.includes(r)}
                      onChange={(e) => setCreateDraft((d) => ({ ...d, roles: e.target.checked ? [...d.roles, r] : d.roles.filter((x) => x !== r) }))}
                    /> {ROLE_LABELS[r]}
                  </label>
                ))}
              </fieldset>
              <p className="field__hint">A temporary password is generated and shown once on creation.</p>
              <div><button className="btn btn--primary" type="submit" disabled={createUser.isPending}>Create user</button></div>
            </form>
          </section>
        )}

        {isLoading ? <p className="muted" style={{ marginTop: 'var(--sp-3)' }}>Loading…</p> : (() => {
          const rows = (data?.data ?? []).filter((u) => {
            if (linkFilter === 'eligible') return u.linkedRecordCount === 0 && !u.deletedAt;
            if (linkFilter === 'linked') return (u.linkedRecordCount ?? 1) > 0;
            if (linkFilter === 'archived') return !!u.deletedAt;
            return true;
          });
          if (linkFilter === 'eligible' && rows.length === 0) {
            return <p className="muted" style={{ marginTop: 'var(--sp-3)' }}>No users are currently eligible for permanent deletion.</p>;
          }
          return (
          <div className="card admin-users" style={{ padding: 0, overflow: 'hidden', marginTop: 'var(--sp-3)' }}>
            <table className="table">
              <thead>
                <tr><th>Email</th><th>Name</th><th>User type / identity</th><th>Case role(s)</th><th>Linked records</th><th>Status</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {rows.map((u) => {
                  const isSelf = u.id === user?.id;
                  const isSuper = u.roles.includes(Role.SUPER_ADMIN);
                  const locked = isSuper && !canManageRoles; // a plain admin cannot touch a super-admin
                  // Account lifecycle is driven by STATUS, never by deletedAt or
                  // verification. An ACTIVE account is active even if unverified or
                  // carrying a stray deletedAt; only SUSPENDED/DEACTIVATED is inactive.
                  const isActive = u.status === 'ACTIVE';
                  // Permanent delete is only offered for unlinked accounts (count === 0),
                  // to a super administrator, never for self/locked rows. Everyone else
                  // gets Archive (soft-delete). null count = unknown → treat as linked.
                  const canHardDelete = u.linkedRecordCount === 0 && canManageRoles && !isSelf && !locked;
                  const linkTitle = (u.linkedRecordCount ?? 1) > 0
                    ? `Linked to ${u.linkedRecordCount} platform record(s) — permanent delete is blocked. Archive deactivates the account and keeps all records linked.`
                    : 'Archive deactivates the account and revokes sessions; records are retained.';
                  // Editing details/email uses a dedicated full-width row so the Save
                  // button is unambiguous and can never be overlapped by adjacent cells.
                  if (editingDetails === u.id) {
                    return (
                      <tr key={u.id}>
                        <td colSpan={7}>
                          <div className="user-edit-form" style={{ display: 'grid', gap: 'var(--sp-2)', maxWidth: 560, padding: 'var(--sp-2)' }}>
                            <strong>Editing {u.email}</strong>
                            <label className="field"><span className="field__label">Login email</span>
                              <input className="input" type="email" aria-label="Login email" value={detailDraft.email} onChange={(e) => setDetailDraft((d) => ({ ...d, email: e.target.value }))} /></label>
                            {detailDraft.email.trim().toLowerCase() !== u.email.toLowerCase() && (
                              <p className="field__hint" style={{ color: 'var(--c-warning)' }}>⚠ Changing this email changes the user’s login address.</p>
                            )}
                            <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
                              <input className="input" placeholder="First" value={detailDraft.firstName} onChange={(e) => setDetailDraft((d) => ({ ...d, firstName: e.target.value }))} />
                              <input className="input" placeholder="Last" value={detailDraft.lastName} onChange={(e) => setDetailDraft((d) => ({ ...d, lastName: e.target.value }))} />
                            </div>
                            <label className="check-row"><input type="checkbox" checked={detailDraft.emailVerified} onChange={(e) => setDetailDraft((d) => ({ ...d, emailVerified: e.target.checked }))} /> Email verified</label>
                            <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
                              <button type="button" className="btn btn--primary btn--sm" disabled={savingUserId === u.id} onClick={() => { void handleSaveUserDetails(u); }}>
                                {savingUserId === u.id ? 'Saving…' : 'Save'}
                              </button>
                              <button type="button" className="btn btn--ghost btn--sm" disabled={savingUserId === u.id} onClick={() => setEditingDetails(null)}>Cancel</button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    );
                  }
                  return (
                    <tr key={u.id} style={u.deletedAt ? { opacity: 0.55 } : undefined}>
                      <td>{u.email}{!u.emailVerified && <span className="badge badge--warning" style={{ marginInlineStart: 6 }}>unverified</span>}</td>
                      <td>{u.displayName}{isSelf && <span className="field__hint"> (you)</span>}</td>
                      {/* User type / identity (with the full system-roles editor when editing). */}
                      <td>
                        {editingRoles === u.id ? (
                          <div className="role-editor">
                            <p className="field__hint">System &amp; identity roles</p>
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
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
                            <span className="badge badge--gold">{(IDENTITY_TYPE_LABELS as Record<string, string>)[u.identityType] ?? u.identityType}</span>
                            {canManageRoles && u.identityType !== 'INTERNAL' && !u.deletedAt && (
                              <select className="select" style={{ width: 'auto' }} aria-label={`Identity for ${u.email}`} value={u.identityType}
                                onChange={(e) => wrap(() => setIdentity.mutateAsync({ id: u.id, identityType: e.target.value }))}>
                                {ASSIGNABLE_IDENTITY_TYPES.map((it) => <option key={it} value={it}>{IDENTITY_TYPE_LABELS[it]}</option>)}
                              </select>
                            )}
                          </div>
                        )}
                      </td>
                      {/* Case role(s) — derived from case membership (read-only here). */}
                      <td className="field__hint">
                        {(() => {
                          const summary = caseRoleSummary(u.identityType, u.caseRoles);
                          return summary.length
                            ? summary.map((s) => <span key={s} className="badge badge--info" style={{ marginInlineEnd: 4 }}>{s}</span>)
                            : '—';
                        })()}
                      </td>
                      {/* Linked records — drives delete eligibility. */}
                      <td>
                        {u.linkedRecordCount === 0 ? (
                          <span className="badge badge--success">Delete eligible</span>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
                            <span className="badge badge--warning">Linked — archive only{u.linkedRecordCount != null ? ` (${u.linkedRecordCount})` : ''}</span>
                            <button className="btn btn--ghost btn--sm" disabled={checkLinks.isPending} onClick={() => checkLinks.mutate(u.id)}>Why?</button>
                            {blockersFor?.id === u.id && (
                              <div className="field__hint" style={{ fontSize: 12 }}>
                                {Object.entries(blockersFor.blockers).map(([k, v]) => <div key={k}>{k}: {v}</div>)}
                              </div>
                            )}
                          </div>
                        )}
                      </td>
                      <td><span className={`badge ${u.status === 'ACTIVE' ? 'badge--success' : u.status === 'SUSPENDED' ? 'badge--warning' : ''}`}>{u.status.replaceAll('_', ' ')}</span></td>
                      <td>
                        <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap', alignItems: 'center' }}>
                          {/* Edit / Roles / Reset are management actions available regardless
                              of lifecycle status (a super-admin may still administer a
                              suspended account); only super-admin-locked rows hide them. */}
                          {!locked && editingDetails !== u.id && (
                            <button className="btn btn--ghost btn--sm" onClick={() => { setEditingDetails(u.id); setDetailDraft({ firstName: u.firstName ?? '', lastName: u.lastName ?? '', email: u.email, emailVerified: u.emailVerified }); }}>Edit</button>
                          )}
                          {canManageRoles && (
                            <button className="btn btn--ghost btn--sm" onClick={() => { setEditingRoles(u.id); setRoleDraft(u.roles); }}>System roles</button>
                          )}
                          {!locked && (
                            <button className="btn btn--ghost btn--sm" disabled={resetPassword.isPending}
                              onClick={() => { const email = confirm(`Reset password for ${u.email}?\n\nOK = e-mail a reset link to the user.\nCancel = generate a temporary password to show here.`); void wrap(() => resetPassword.mutateAsync({ id: u.id, sendEmail: email })); }}
                            >Reset password</button>
                          )}

                          {isActive ? (
                            <>
                              {/* Active account: Suspend / Deactivate (no Restore). */}
                              <select
                                className="select"
                                style={{ width: 'auto' }}
                                aria-label={`Set status for ${u.email}`}
                                value={u.status}
                                disabled={locked || isSelf}
                                onChange={(e) => wrap(() => setStatus.mutateAsync({ id: u.id, status: e.target.value }))}
                              >
                                {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                              </select>
                              {canHardDelete ? (
                                <button className="btn btn--ghost btn--sm" style={{ color: 'var(--c-danger)' }}
                                  onClick={() => { if (confirm(`Permanently delete ${u.email}? This account has no linked records and cannot be recovered.`)) hardDelete.mutate(u.id); }}
                                >Delete permanently</button>
                              ) : (
                                <button className="btn btn--ghost btn--sm" title={linkTitle} disabled={locked || isSelf}
                                  onClick={() => { if (confirm(`Archive ${u.email}? This deactivates the account and revokes sessions; records are retained.`)) archive.mutate(u.id); }}
                                >Archive</button>
                              )}
                            </>
                          ) : (
                            /* Inactive account (SUSPENDED/DEACTIVATED/soft-deleted):
                               Reactivate is the primary action; permanent delete only if unlinked. */
                            <>
                              <button className="btn btn--secondary btn--sm" disabled={locked} onClick={() => wrap(() => restore.mutateAsync(u.id))}>Reactivate</button>
                              {canHardDelete && (
                                <button className="btn btn--ghost btn--sm" style={{ color: 'var(--c-danger)' }}
                                  onClick={() => { if (confirm(`Permanently delete ${u.email}? This account has no linked records and cannot be recovered.`)) hardDelete.mutate(u.id); }}
                                >Delete permanently</button>
                              )}
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          );
        })()}
      </div>
    </div>
  );
}
