import { useState } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { ORDERED_STAGES } from '@gaap/shared';
import { api } from '../../lib/api';
import { DocumentsTab } from './case/DocumentsTab';
import { TribunalTab } from './case/TribunalTab';
import { DeliveryTab } from './case/DeliveryTab';
import { MessagesTab } from './case/MessagesTab';
import { CalendarTab } from './case/CalendarTab';
import { FinanceTab } from './case/FinanceTab';
import { AwardsTab } from './case/AwardsTab';
import { DeliberationsTab } from './case/DeliberationsTab';
import { RulesProcedureTab } from './case/RulesProcedureTab';
import { ProceduralTimelineTab } from './case/ProceduralTimelineTab';
import { CaseAdminTab } from './case/CaseAdminTab';

interface CaseDetail {
  id: string;
  reference: string;
  title: string;
  stage: string;
  seat?: string;
  governingLaw?: string;
  language: string;
  category?: string;
  industry?: string;
  numberOfArbitrators?: number;
  appointmentMechanism?: string;
  parties: { id: string; side: string; legalName: string }[];
  statusHistory: { id: string; toStage: string; createdAt: string }[];
  tribunal?: { members: { id: string; role: string }[] } | null;
  _membership: { isTribunal: boolean; isRegistrar?: boolean; canAdminister?: boolean; caseRoles: string[] };
}

type TabKey = 'overview' | 'timeline' | 'tribunal' | 'rules' | 'documents' | 'messages' | 'calendar' | 'finance' | 'awards' | 'delivery' | 'deliberations' | 'admin';

const PARTY_ROLES = ['CLAIMANT', 'CLAIMANT_REPRESENTATIVE', 'RESPONDENT', 'RESPONDENT_REPRESENTATIVE'];

export function CaseWorkspace() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const { t } = useTranslation();
  // Allow deep-linking to a specific tab, e.g. /app/cases/:id?tab=admin.
  const [tab, setTab] = useState<TabKey>(() => (searchParams.get('tab') as TabKey) || 'overview');

  const { data, isLoading, isError } = useQuery<CaseDetail>({
    queryKey: ['case', id],
    queryFn: async () => (await api.get(`/cases/${id}`)).data,
    enabled: !!id,
  });

  if (isLoading) return <div className="section"><div className="container"><p className="muted">Loading…</p></div></div>;
  if (isError || !data) return <div className="section"><div className="container"><div className="alert alert--danger">You are not authorised to view this case, or it does not exist.</div></div></div>;

  const currentIndex = ORDERED_STAGES.indexOf(data.stage as never);
  const isTribunal = data._membership.isTribunal;
  // Registry/administrative reach: a case-team registrar OR any user with
  // institutional administrative authority (global registrar/admin/super-admin).
  const isRegistry = !!data._membership.isRegistrar || !!data._membership.canAdminister;

  const isParty = data._membership.caseRoles.some((r) => PARTY_ROLES.includes(r));

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'overview', label: t('case.tab.overview') },
    { key: 'timeline', label: t('case.tab.timeline') },
    { key: 'tribunal', label: t('case.tab.tribunal') },
    { key: 'rules', label: t('case.tab.rules') },
    { key: 'documents', label: t('case.tab.documents') },
    { key: 'messages', label: t('case.tab.messages') },
    { key: 'calendar', label: t('case.tab.calendar') },
    { key: 'finance', label: t('case.tab.finance') },
    { key: 'awards', label: t('case.tab.awards') },
    // Delivery evidence is a registry/tribunal view (shows recipient addresses).
    ...(isTribunal || isRegistry ? [{ key: 'delivery' as TabKey, label: t('case.tab.delivery') }] : []),
    ...(isTribunal ? [{ key: 'deliberations' as TabKey, label: t('case.tab.deliberations') }] : []),
    // Registrar/registry administration (edit admin info, status, notes).
    ...(isRegistry ? [{ key: 'admin' as TabKey, label: t('case.tab.administration') }] : []),
  ];

  // A deep-linked tab the current user can't see falls back to the overview.
  const activeTab: TabKey = tabs.some((tt) => tt.key === tab) ? tab : 'overview';

  return (
    <div className="section">
      <div className="container">
        <Link to="/app" className="muted">← {t('case.back')}</Link>
        <div className="dash-head" style={{ marginTop: 'var(--sp-3)' }}>
          <div>
            <p className="eyebrow">{data.reference}</p>
            <h1 style={{ marginBottom: 4 }}>{data.title}</h1>
            <span className="badge badge--info">{data.stage.replaceAll('_', ' ')}</span>
            {isTribunal && <span className="badge badge--gold" style={{ marginInlineStart: 8 }}>{t('case.tribunalMember')}</span>}
          </div>
        </div>

        <nav className="tabs" role="tablist" aria-label="Case sections">
          {tabs.map((t) => (
            <button key={t.key} role="tab" aria-selected={activeTab === t.key} className={`tab ${activeTab === t.key ? 'tab--active' : ''}`} onClick={() => setTab(t.key)}>
              {t.label}
            </button>
          ))}
        </nav>

        <div className="tab-panel">
          {activeTab === 'overview' && (
            <div className="grid grid-2" style={{ alignItems: 'start' }}>
              <div className="card">
                <h2 className="card__title">{t('case.parties')}</h2>
                <table className="table">
                  <tbody>{data.parties.map((p) => <tr key={p.id}><td>{p.side}</td><td>{p.legalName}</td></tr>)}</tbody>
                </table>
                <hr className="rule" />
                <dl className="kv">
                  <div><dt>{t('case.seat')}</dt><dd>{data.seat ?? '—'}</dd></div>
                  <div><dt>{t('case.governingLaw')}</dt><dd>{data.governingLaw ?? '—'}</dd></div>
                  <div><dt>{t('case.language')}</dt><dd>{data.language}</dd></div>
                </dl>
              </div>
              <div className="card">
                <h2 className="card__title">{t('case.progress')}</h2>
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
          {activeTab === 'timeline' && <ProceduralTimelineTab caseId={data.id} stage={data.stage} />}
          {activeTab === 'tribunal' && <TribunalTab caseId={data.id} />}
          {activeTab === 'rules' && <RulesProcedureTab caseId={data.id} isParty={isParty} />}
          {activeTab === 'documents' && <DocumentsTab caseId={data.id} />}
          {activeTab === 'messages' && <MessagesTab caseId={data.id} />}
          {activeTab === 'calendar' && <CalendarTab caseId={data.id} isTribunal={isTribunal} />}
          {activeTab === 'finance' && <FinanceTab caseId={data.id} />}
          {activeTab === 'awards' && <AwardsTab caseId={data.id} isTribunal={isTribunal} />}
          {activeTab === 'delivery' && (isTribunal || isRegistry) && <DeliveryTab caseId={data.id} />}
          {activeTab === 'deliberations' && isTribunal && <DeliberationsTab caseId={data.id} />}
          {activeTab === 'admin' && isRegistry && <CaseAdminTab caseData={data} goTab={setTab} />}
        </div>
      </div>
    </div>
  );
}
