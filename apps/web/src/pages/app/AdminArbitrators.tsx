import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Permission } from '@gaap/shared';
import { useAuth } from '../../auth/AuthContext';
import { api } from '../../lib/api';

interface InternalArbitrator {
  id: string;
  fullName: string;
  accessEmail: string;
  profileEmail: string | null;
  accountStatus: string;
  availability: string;
  approvalStatus: string;
  verificationStatus: string;
  professionalTitle: string | null;
  specializations: string[];
}

// Roles authorised to view arbitrator access (login) emails.
const VIEW_PERMS = [Permission.USER_MANAGE, Permission.APPOINTMENT_MANAGE, Permission.ARBITRATOR_APPROVE, Permission.CONFLICT_REVIEW];

export function AdminArbitrators() {
  const { user } = useAuth();
  const canView = !!user?.permissions.some((p) => VIEW_PERMS.includes(p as Permission));

  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');

  const { data, isLoading } = useQuery<{ data: InternalArbitrator[]; total: number }>({
    queryKey: ['admin-arbitrators', search],
    queryFn: async () => (await api.get('/arbitrators/internal', { params: { q: search || undefined, pageSize: 200 } })).data,
    enabled: canView,
  });

  if (!canView) {
    return <div className="section"><div className="container"><div className="alert alert--danger">You are not authorised to view arbitrator access details.</div></div></div>;
  }

  return (
    <div className="section">
      <div className="container">
        <p className="eyebrow">Administration</p>
        <h1>Arbitrators — access directory</h1>
        <p className="muted">
          Internal view for authorised staff: shows each arbitrator’s <strong>access (login) email</strong> so you know
          which account belongs to whom. Passwords are never shown, and this exposes no case data or deliberations.
        </p>

        <form className="directory-search" onSubmit={(e) => { e.preventDefault(); setSearch(q); }} role="search">
          <input className="input" placeholder="Search by name or access email" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="btn btn--primary" type="submit">Search</button>
        </form>

        {isLoading ? <p className="muted" style={{ marginTop: 'var(--sp-3)' }}>Loading…</p> : (
          <div className="card admin-users" style={{ padding: 0, overflow: 'hidden', marginTop: 'var(--sp-3)' }}>
            <table className="table">
              <thead>
                <tr><th>Arbitrator</th><th>Access (login) email</th><th>Profile email</th><th>Status</th><th>Panel role / specialization</th><th>Approval</th></tr>
              </thead>
              <tbody>
                {data?.data.length ? data.data.map((a) => (
                  <tr key={a.id}>
                    <td><strong>{a.fullName}</strong>{a.professionalTitle && <span className="field__hint"> · {a.professionalTitle}</span>}</td>
                    <td><code style={{ fontSize: 12 }}>{a.accessEmail}</code></td>
                    <td className="field__hint">{a.profileEmail && a.profileEmail !== a.accessEmail ? a.profileEmail : 'same as access'}</td>
                    <td>
                      <span className={`badge ${a.accountStatus === 'ACTIVE' ? 'badge--success' : 'badge--warning'}`}>{a.accountStatus.replaceAll('_', ' ')}</span>
                      {a.availability && <span className="badge badge--info" style={{ marginInlineStart: 4 }}>{a.availability.replaceAll('_', ' ')}</span>}
                    </td>
                    <td className="field__hint">{a.specializations.length ? a.specializations.join(', ') : '—'}</td>
                    <td><span className="badge">{a.approvalStatus.replaceAll('_', ' ')}</span></td>
                  </tr>
                )) : <tr><td colSpan={6} className="muted">No arbitrators found.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
