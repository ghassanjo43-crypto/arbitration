import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ORDERED_STAGES } from '@gaap/shared';
import { api } from '../../lib/api';
import { DocumentsTab } from './case/DocumentsTab';
import { MessagesTab } from './case/MessagesTab';
import { CalendarTab } from './case/CalendarTab';
import { FinanceTab } from './case/FinanceTab';
import { AwardsTab } from './case/AwardsTab';
import { DeliberationsTab } from './case/DeliberationsTab';
import { RulesProcedureTab } from './case/RulesProcedureTab';
import { ProceduralTimelineTab } from './case/ProceduralTimelineTab';

interface CaseDetail {
  id: string;
  reference: string;
  title: string;
  stage: string;
  seat?: string;
  governingLaw?: string;
  language: string;
  parties: { id: string; side: string; legalName: string }[];
  statusHistory: { id: string; toStage: string; createdAt: string }[];
  tribunal?: { members: { id: string; role: string }[] } | null;
  _membership: { isTribunal: boolean; caseRoles: string[] };
}

type TabKey = 'overview' | 'timeline' | 'rules' | 'documents' | 'messages' | 'calendar' | 'finance' | 'awards' | 'deliberations';

const PARTY_ROLES = ['CLAIMANT', 'CLAIMANT_REPRESENTATIVE', 'RESPONDENT', 'RESPONDENT_REPRESENTATIVE'];

export function CaseWorkspace() {
  const { id } = useParams<{ id: string }>();
  const [tab, setTab] = useState<TabKey>('overview');

  const { data, isLoading, isError } = useQuery<CaseDetail>({
    queryKey: ['case', id],
    queryFn: async () => (await api.get(`/cases/${id}`)).data,
    enabled: !!id,
  });

  if (isLoading) return <div className="section"><div className="container"><p className="muted">Loading…</p></div></div>;
  if (isError || !data) return <div className="section"><div className="container"><div className="alert alert--danger">You are not authorised to view this case, or it does not exist.</div></div></div>;

  const currentIndex = ORDERED_STAGES.indexOf(data.stage as never);
  const isTribunal = data._membership.isTribunal;

  const isParty = data._membership.caseRoles.some((r) => PARTY_ROLES.includes(r));

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'timeline', label: 'Timeline' },
    { key: 'rules', label: 'Rules & Procedure' },
    { key: 'documents', label: 'Documents' },
    { key: 'messages', label: 'Messages' },
    { key: 'calendar', label: 'Calendar' },
    { key: 'finance', label: 'Finance' },
    { key: 'awards', label: 'Awards' },
    ...(isTribunal ? [{ key: 'deliberations' as TabKey, label: 'Deliberations' }] : []),
  ];

  return (
    <div className="section">
      <div className="container">
        <Link to="/app" className="muted">← Back to dashboard</Link>
        <div className="dash-head" style={{ marginTop: 'var(--sp-3)' }}>
          <div>
            <p className="eyebrow">{data.reference}</p>
            <h1 style={{ marginBottom: 4 }}>{data.title}</h1>
            <span className="badge badge--info">{data.stage.replaceAll('_', ' ')}</span>
            {isTribunal && <span className="badge badge--gold" style={{ marginInlineStart: 8 }}>Tribunal member</span>}
          </div>
        </div>

        <nav className="tabs" role="tablist" aria-label="Case sections">
          {tabs.map((t) => (
            <button key={t.key} role="tab" aria-selected={tab === t.key} className={`tab ${tab === t.key ? 'tab--active' : ''}`} onClick={() => setTab(t.key)}>
              {t.label}
            </button>
          ))}
        </nav>

        <div className="tab-panel">
          {tab === 'overview' && (
            <div className="grid grid-2" style={{ alignItems: 'start' }}>
              <div className="card">
                <h2 className="card__title">Parties</h2>
                <table className="table">
                  <tbody>{data.parties.map((p) => <tr key={p.id}><td>{p.side}</td><td>{p.legalName}</td></tr>)}</tbody>
                </table>
                <hr className="rule" />
                <dl className="kv">
                  <div><dt>Seat</dt><dd>{data.seat ?? '—'}</dd></div>
                  <div><dt>Governing law</dt><dd>{data.governingLaw ?? '—'}</dd></div>
                  <div><dt>Language</dt><dd>{data.language}</dd></div>
                </dl>
              </div>
              <div className="card">
                <h2 className="card__title">Progress</h2>
                <ul className="timeline">
                  {ORDERED_STAGES.slice(0, Math.max(currentIndex + 2, 6)).map((s, i) => (
                    <li key={s} className={`timeline__item ${i < currentIndex ? 'timeline__item--done' : ''} ${i === currentIndex ? 'timeline__item--current' : ''}`}>
                      <span className="timeline__dot" aria-hidden="true" />
                      <span>{s.replaceAll('_', ' ')}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
          {tab === 'timeline' && <ProceduralTimelineTab caseId={data.id} stage={data.stage} />}
          {tab === 'rules' && <RulesProcedureTab caseId={data.id} isParty={isParty} />}
          {tab === 'documents' && <DocumentsTab caseId={data.id} />}
          {tab === 'messages' && <MessagesTab caseId={data.id} />}
          {tab === 'calendar' && <CalendarTab caseId={data.id} isTribunal={isTribunal} />}
          {tab === 'finance' && <FinanceTab caseId={data.id} />}
          {tab === 'awards' && <AwardsTab caseId={data.id} isTribunal={isTribunal} />}
          {tab === 'deliberations' && isTribunal && <DeliberationsTab caseId={data.id} />}
        </div>
      </div>
    </div>
  );
}
