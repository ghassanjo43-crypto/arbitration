import { useQuery } from '@tanstack/react-query';
import { api } from '../../../lib/api';

interface DeliveryEvent { id: string; type: string; providerEventId: string | null; detail: string | null; occurredAt: string }
interface EmailDelivery {
  id: string; provider: string; providerMessageId: string | null; toEmail: string; subject: string;
  status: string; failureKind: string | null; errorDetail: string | null; attemptCount: number;
  nextAttemptAt: string | null; noticeId: string | null; noticeType: string | null; sentAt: string | null;
  events: DeliveryEvent[];
}

function statusBadge(s: string): string {
  switch (s) {
    case 'DELIVERED': return 'badge--success';
    case 'SENT': case 'OPENED': case 'CLICKED': return 'badge--info';
    case 'BOUNCED': case 'COMPLAINED': case 'FAILED': return 'badge--danger';
    case 'QUEUED': return 'badge--warning';
    default: return '';
  }
}
function humanize(s: string | null): string {
  return s ? s.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : '—';
}
function fmt(d: string | null): string {
  return d ? new Date(d).toLocaleString() : '—';
}

/**
 * Email-delivery evidence for the case (registry/tribunal). Each row is a tracked
 * outbound email with its provider message id and status trail. Dispatch is not
 * receipt: a DELIVERED status means delivered to the mail server, not that the
 * recipient has accessed or acknowledged the document.
 */
export function DeliveryTab({ caseId }: { caseId: string }) {
  const { data, isLoading, isError } = useQuery<EmailDelivery[]>({
    queryKey: ['email-deliveries', caseId],
    queryFn: async () => (await api.get(`/cases/${caseId}/email-deliveries`)).data,
  });

  if (isLoading) return <p className="muted">Loading delivery evidence…</p>;
  if (isError) return <div className="alert alert--danger">You are not authorised to view delivery evidence for this case.</div>;

  return (
    <div className="grid" style={{ gap: 'var(--sp-4)' }}>
      <div className="alert alert--legal" role="note">
        Email <strong>dispatch is not receipt</strong>: a <em>Delivered</em> status confirms delivery to the recipient's
        mail server only. Formal service is evidenced by portal access or an explicit acknowledgement, and a bounce or
        complaint routes the notice to manual (substitute) service.
      </div>

      <section className="card">
        <h3 className="card__title">Email delivery log</h3>
        {data && data.length ? (
          <table className="table" style={{ marginTop: 'var(--sp-3)' }}>
            <thead><tr><th>Recipient</th><th>Subject</th><th>Type</th><th>Status</th><th>Provider message ID</th><th>Attempts</th><th>Events</th></tr></thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.id}>
                  <td>{d.toEmail}</td>
                  <td>{d.subject}</td>
                  <td>{d.noticeType ? humanize(d.noticeType) : 'Notification'}</td>
                  <td>
                    <span className={`badge ${statusBadge(d.status)}`}>{humanize(d.status)}</span>
                    {d.failureKind && <span className="field__hint"> ({humanize(d.failureKind)})</span>}
                    {d.nextAttemptAt && <div className="field__hint">Retry due {fmt(d.nextAttemptAt)}</div>}
                    {d.errorDetail && <div className="field__hint">{d.errorDetail}</div>}
                  </td>
                  <td><code style={{ fontSize: 12 }}>{d.providerMessageId ?? '—'}</code></td>
                  <td>{d.attemptCount}</td>
                  <td>
                    <details>
                      <summary className="muted">{d.events.length} event(s)</summary>
                      <ul className="timeline" style={{ marginTop: 6 }}>
                        {d.events.map((e) => (
                          <li key={e.id} className="timeline__item">
                            <span className="timeline__dot" aria-hidden="true" />
                            <strong>{humanize(e.type)}</strong> — <span className="muted">{fmt(e.occurredAt)}</span>
                            {e.detail && <div className="field__hint">{e.detail}</div>}
                          </li>
                        ))}
                      </ul>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="muted" style={{ marginTop: 'var(--sp-3)' }}>No tracked emails for this case yet.</p>}
      </section>
    </div>
  );
}
