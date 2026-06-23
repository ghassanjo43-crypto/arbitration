import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AwardType } from '@gaap/shared';
import { api } from '../../../lib/api';

interface Award {
  id: string;
  type: string;
  issueDate: string | null;
  seat: string | null;
  signatureStatus: string;
  correctionStatus: string | null;
  generatedDocumentKey: string | null;
  deliveries: { recipientLabel: string; deliveredAt: string | null }[];
  corrections: { kind: string; status: string }[];
}

export function AwardsTab({ caseId, isTribunal }: { caseId: string; isTribunal: boolean }) {
  const qc = useQueryClient();
  const [type, setType] = useState<string>(AwardType.FINAL);

  const { data } = useQuery<{ awards: Award[]; enforcementNote: string }>({
    queryKey: ['awards', caseId],
    queryFn: async () => (await api.get(`/cases/${caseId}/awards`)).data,
  });

  const invalidate = () => void qc.invalidateQueries({ queryKey: ['awards', caseId] });
  const create = useMutation({ mutationFn: async () => api.post(`/cases/${caseId}/awards`, { type }), onSuccess: invalidate });
  const sign = useMutation({ mutationFn: async (id: string) => api.post(`/awards/${id}/sign`, { signatureMetadata: 'e-signed (dev)' }), onSuccess: invalidate });
  const issue = useMutation({ mutationFn: async (id: string) => api.post(`/awards/${id}/issue`, {}), onSuccess: invalidate });
  const correct = useMutation({
    mutationFn: async (id: string) => api.post(`/awards/${id}/corrections`, { kind: 'CORRECTION', details: 'Please correct a clerical error in the award.' }),
    onSuccess: invalidate,
  });
  const generateDoc = useMutation({ mutationFn: async (id: string) => api.post(`/awards/${id}/document`, {}), onSuccess: invalidate });
  const downloadDoc = useMutation({
    mutationFn: async (id: string) => {
      const res = await api.get(`/awards/${id}/document`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data as Blob);
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    },
  });

  return (
    <div className="grid" style={{ gap: 'var(--sp-5)' }}>
      <div className="alert alert--legal">{data?.enforcementNote}</div>

      {isTribunal && (
        <form className="card field-inline" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
          <select className="select" value={type} onChange={(e) => setType(e.target.value)} style={{ maxWidth: 220 }}>
            {Object.values(AwardType).map((t) => <option key={t} value={t}>{t} award</option>)}
          </select>
          <button className="btn btn--primary" disabled={create.isPending}>Draft award</button>
        </form>
      )}

      <div className="grid" style={{ gap: 'var(--sp-3)' }}>
        {data?.awards.length ? data.awards.map((a) => (
          <article key={a.id} className="card">
            <div className="arb-card__meta" style={{ justifyContent: 'space-between' }}>
              <span className="badge badge--gold">{a.type} AWARD</span>
              <span className={`badge ${a.issueDate ? 'badge--success' : 'badge--warning'}`}>
                {a.issueDate ? `Issued ${new Date(a.issueDate).toLocaleDateString()}` : 'Draft'}
              </span>
            </div>
            <p className="field__hint" style={{ marginTop: 'var(--sp-2)' }}>
              Signature: {a.signatureStatus}{a.seat ? ` · Seat: ${a.seat}` : ''}
              {a.correctionStatus && a.correctionStatus !== 'NONE' ? ` · Correction: ${a.correctionStatus}` : ''}
            </p>
            {a.deliveries.length > 0 && (
              <p className="field__hint">Delivered to: {a.deliveries.map((d) => d.recipientLabel).join(', ')}</p>
            )}

            <div style={{ display: 'flex', gap: 'var(--sp-2)', marginTop: 'var(--sp-3)', flexWrap: 'wrap' }}>
              {isTribunal && a.signatureStatus !== 'SIGNED' && (
                <button className="btn btn--ghost" disabled={sign.isPending} onClick={() => sign.mutate(a.id)}>Sign</button>
              )}
              {isTribunal && a.signatureStatus === 'SIGNED' && !a.issueDate && (
                <button className="btn btn--primary" disabled={issue.isPending} onClick={() => issue.mutate(a.id)}>Issue & deliver</button>
              )}
              {!isTribunal && a.issueDate && (
                <button className="btn btn--ghost" disabled={correct.isPending} onClick={() => correct.mutate(a.id)}>Request correction</button>
              )}
              {isTribunal && (
                <button className="btn btn--ghost" disabled={generateDoc.isPending} onClick={() => generateDoc.mutate(a.id)}>
                  {a.generatedDocumentKey ? 'Regenerate PDF' : 'Generate PDF'}
                </button>
              )}
              {a.generatedDocumentKey && (isTribunal || a.issueDate) && (
                <button className="btn btn--ghost" disabled={downloadDoc.isPending} onClick={() => downloadDoc.mutate(a.id)}>Download PDF</button>
              )}
            </div>
          </article>
        )) : <div className="empty-state">No awards yet.</div>}
      </div>
    </div>
  );
}
