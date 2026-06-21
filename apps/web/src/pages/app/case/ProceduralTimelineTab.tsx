import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { CaseStage, PROCEDURAL_PHASES, ProceduralPhase, phaseOfStage } from '@gaap/shared';
import { api } from '../../../lib/api';

interface ProceduralEvent {
  id: string;
  type: string;
  occurredAt: string;
  effectiveDate?: string | null;
}

/** Which procedural-event types belong under which phase (best-effort grouping). */
const EVENT_PHASE: Record<string, ProceduralPhase> = {
  CASE_REGISTERED: ProceduralPhase.COMMENCEMENT,
  FILING_FEE_PAID: ProceduralPhase.COMMENCEMENT,
  COMMENCEMENT: ProceduralPhase.COMMENCEMENT,
  NOTICE_SERVED: ProceduralPhase.SERVICE,
  NOTICE_ISSUED: ProceduralPhase.SERVICE,
  RESPONSE_RECEIVED: ProceduralPhase.SERVICE,
  TRIBUNAL_CONSTITUTED: ProceduralPhase.TRIBUNAL_CONSTITUTION,
  ARBITRATOR_ACCEPTED: ProceduralPhase.TRIBUNAL_CONSTITUTION,
  FILING_SUBMITTED: ProceduralPhase.PLEADINGS,
  PROCEDURAL_ORDER_ISSUED: ProceduralPhase.PLEADINGS,
  HEARING_SCHEDULED: ProceduralPhase.HEARING,
  HEARING_HELD: ProceduralPhase.HEARING,
  AWARD_ISSUED: ProceduralPhase.AWARD,
  CASE_CLOSED: ProceduralPhase.AWARD,
};

type PhaseState = 'done' | 'current' | 'upcoming';

function phaseState(phase: ProceduralPhase, currentPhase: ProceduralPhase | null): PhaseState {
  const order = PROCEDURAL_PHASES.map((p) => p.phase);
  const curIdx = currentPhase ? order.indexOf(currentPhase) : -1;
  if (curIdx === -1) return 'upcoming';
  const thisIdx = order.indexOf(phase);
  if (thisIdx < curIdx) return 'done';
  if (thisIdx === curIdx) return 'current';
  return 'upcoming';
}

export function ProceduralTimelineTab({ caseId, stage }: { caseId: string; stage: string }) {
  const { t } = useTranslation();
  const { data: events } = useQuery<ProceduralEvent[]>({
    queryKey: ['procedural-events', caseId],
    queryFn: async () => (await api.get(`/cases/${caseId}/procedural-events`)).data,
  });

  const currentPhase = phaseOfStage(stage as CaseStage);
  const isTerminal = currentPhase === null;

  const eventsByPhase = (phase: ProceduralPhase) =>
    (events ?? []).filter((e) => EVENT_PHASE[e.type] === phase);

  return (
    <div>
      <h2 className="card__title">{t('timeline.title')}</h2>
      {isTerminal && <div className="alert alert--warning">{t('timeline.terminal')}</div>}

      <ol className="proc-timeline">
        {PROCEDURAL_PHASES.map(({ phase }) => {
          const state = phaseState(phase, currentPhase);
          const phaseEvents = eventsByPhase(phase);
          return (
            <li key={phase} className={`proc-timeline__phase proc-timeline__phase--${state}`}>
              <div className="proc-timeline__marker" aria-hidden="true" />
              <div className="proc-timeline__body card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--sp-3)' }}>
                  <h3 style={{ margin: 0 }}>{t(`timeline.phase.${phase}`)}</h3>
                  <span className={`badge badge--${state === 'done' ? 'success' : state === 'current' ? 'gold' : 'info'}`}>
                    {t(`timeline.${state}`)}
                  </span>
                </div>
                {phaseEvents.length > 0 ? (
                  <ul className="timeline" style={{ marginTop: 'var(--sp-2)' }}>
                    {phaseEvents.map((e) => (
                      <li key={e.id} className="timeline__item">
                        <span className="timeline__dot" aria-hidden="true" />
                        <strong>{e.type.replaceAll('_', ' ')}</strong>{' '}
                        <span className="muted">— {new Date(e.effectiveDate ?? e.occurredAt).toLocaleDateString()}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="field__hint" style={{ marginTop: 'var(--sp-2)' }}>{t('timeline.noEvents')}</p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
