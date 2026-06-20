import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../../../lib/api';

interface CaseRulesResponse {
  link: {
    ruleSetVersion: {
      id: string; version: string; status: string; effectiveDate?: string | null;
      mandatoryLawNotice: string; mandatoryLawNoticeAr?: string | null;
      ruleSet: { title: string; titleAr?: string | null; code: string };
    };
    assignedAt: string;
  } | null;
  acceptances: {
    id: string; receiptNumber: string; acceptedAt: string; seat?: string | null;
    governingLaw?: string | null; languageOfProceedings?: string | null; numberOfArbitrators?: number | null;
    consentElectronicService: boolean; consentOnlineHearings: boolean;
  }[];
}

interface DeadlineRow {
  id: string; title: string; description?: string | null; dueAt: string; status: string;
  dayKind?: string | null; days?: number | null; definitionKey?: string | null;
  extensions: { id: string; previousDueAt: string; newDueAt?: string | null; reason: string; createdAt: string }[];
}

function countdown(dueAt: string): { label: string; tone: string } {
  const ms = new Date(dueAt).getTime() - Date.now();
  const days = Math.ceil(ms / 86400000);
  if (ms < 0) return { label: `Overdue by ${Math.abs(days)} day(s)`, tone: 'badge--danger' };
  if (days <= 2) return { label: `${days} day(s) left`, tone: 'badge--danger' };
  if (days <= 7) return { label: `${days} day(s) left`, tone: 'badge--gold' };
  return { label: `${days} day(s) left`, tone: 'badge--info' };
}

export function RulesProcedureTab({ caseId, isParty }: { caseId: string; isParty: boolean }) {
  const qc = useQueryClient();
  const { i18n } = useTranslation();
  const ar = i18n.language === 'ar';
  const pick = (en: string, arVal?: string | null) => (ar && arVal ? arVal : en);

  const rules = useQuery<CaseRulesResponse>({
    queryKey: ['case-rules', caseId],
    queryFn: async () => (await api.get(`/cases/${caseId}/rules`)).data,
  });
  const deadlines = useQuery<DeadlineRow[]>({
    queryKey: ['deadlines', caseId],
    queryFn: async () => (await api.get(`/cases/${caseId}/deadlines`)).data,
  });

  const [accepted, setAccepted] = useState(false);
  const acceptMut = useMutation({
    mutationFn: async () => (await api.post(`/cases/${caseId}/rules/accept`, { consentElectronicService: true, consentOnlineHearings: true })).data,
    onSuccess: () => { setAccepted(true); void qc.invalidateQueries({ queryKey: ['case-rules', caseId] }); },
  });

  if (rules.isLoading) return <p className="muted">Loading…</p>;

  const link = rules.data?.link ?? null;
  const v = link?.ruleSetVersion;

  return (
    <div className="grid" style={{ gap: 'var(--sp-5)' }}>
      <div className="card">
        <h3 className="card__title">Applicable rules</h3>
        {v ? (
          <>
            <p>
              <strong>{pick(v.ruleSet.title, v.ruleSet.titleAr)}</strong>{' '}
              <span className="badge badge--info">v{v.version}</span>{' '}
              <span className="badge">{v.status}</span>
            </p>
            <p className="field__hint">
              Pinned to this case on {link && new Date(link.assignedAt).toLocaleDateString()}. A later amendment to the rules
              does not change the version applied to this case.
            </p>
            <div className="alert alert--warning" style={{ marginTop: 'var(--sp-3)' }}>
              {pick(v.mandatoryLawNotice, v.mandatoryLawNoticeAr)}
            </div>
          </>
        ) : (
          <p className="muted">This case has not yet been linked to a rule set version by the registry.</p>
        )}
      </div>

      <div className="card">
        <h3 className="card__title">Rule acceptance</h3>
        {rules.data?.acceptances.length ? (
          <ul className="timeline">
            {rules.data.acceptances.map((a) => (
              <li key={a.id} className="timeline__item">
                <span className="timeline__dot" aria-hidden="true" />
                <strong>Receipt {a.receiptNumber}</strong> — <span className="muted">{new Date(a.acceptedAt).toLocaleString()}</span>
                <div className="field__hint">
                  Seat: {a.seat ?? '—'} · Law: {a.governingLaw ?? '—'} · Language: {a.languageOfProceedings ?? '—'} ·
                  Arbitrators: {a.numberOfArbitrators ?? '—'} · e-service: {a.consentElectronicService ? 'yes' : 'no'} ·
                  online hearings: {a.consentOnlineHearings ? 'yes' : 'no'}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">No acceptances recorded yet.</p>
        )}

        {isParty && link && !accepted && (
          <form onSubmit={(e) => { e.preventDefault(); acceptMut.mutate(); }} style={{ marginTop: 'var(--sp-3)' }}>
            <p className="field__hint">
              By accepting, you confirm the applicable rules and consent to electronic service and online hearings. An immutable
              acceptance receipt will be generated.
            </p>
            <button className="btn btn--primary" disabled={acceptMut.isPending}>
              {acceptMut.isPending ? 'Recording…' : 'Accept the applicable rules'}
            </button>
            {acceptMut.isError && <p className="alert alert--danger" style={{ marginTop: 8 }}>You may already have accepted, or you are not a party on this case.</p>}
          </form>
        )}
        {accepted && <p className="alert alert--success" style={{ marginTop: 8 }}>Acceptance recorded. Receipt issued.</p>}
      </div>

      <div className="card">
        <h3 className="card__title">Procedural deadlines</h3>
        <ul className="timeline" style={{ marginTop: 'var(--sp-3)' }}>
          {deadlines.data?.length ? deadlines.data.map((d) => {
            const c = countdown(d.dueAt);
            return (
              <li key={d.id} className="timeline__item">
                <span className="timeline__dot" aria-hidden="true" />
                <strong>{d.title}</strong>{' '}
                <span className={`badge ${c.tone}`}>{d.status === 'MET' ? 'Filed' : c.label}</span>
                <div className="field__hint">
                  Due {new Date(d.dueAt).toLocaleString()}
                  {d.dayKind && d.days ? ` · ${d.days} ${d.dayKind === 'BUSINESS' ? 'business' : 'calendar'} days` : ''}
                  {d.definitionKey ? ` · rule-generated` : ''}
                </div>
                {d.extensions.length > 0 && (
                  <div className="field__hint">
                    {d.extensions.length} extension(s). Original due {new Date(d.extensions[0].previousDueAt).toLocaleDateString()}.
                    Latest reason: “{d.extensions[d.extensions.length - 1].reason}”.
                  </div>
                )}
              </li>
            );
          }) : <p className="muted">No deadlines yet.</p>}
        </ul>
      </div>
    </div>
  );
}
