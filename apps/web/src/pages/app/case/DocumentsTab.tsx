import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ConfidentialityLevel, DocumentCategory } from '@gaap/shared';
import { api } from '../../../lib/api';

interface DocMeta {
  id: string;
  caseDocumentNumber: string;
  title: string;
  category: string;
  confidentiality: string;
  fileName?: string;
  fileSize?: number;
  fileHash?: string;
  virusScan?: string;
  createdAt: string;
}

const CATEGORY_OPTIONS = Object.values(DocumentCategory);
const CONFIDENTIALITY_OPTIONS = Object.values(ConfidentialityLevel);

function humanSize(bytes?: number) {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function DocumentsTab({ caseId }: { caseId: string }) {
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<string>(DocumentCategory.OTHER);
  const [confidentiality, setConfidentiality] = useState<string>(ConfidentialityLevel.CASE_PARTIES);

  const { data, isLoading } = useQuery<DocMeta[]>({
    queryKey: ['documents', caseId],
    queryFn: async () => (await api.get(`/cases/${caseId}/documents`)).data,
  });

  const upload = useMutation({
    mutationFn: async () => {
      const fd = new FormData();
      fd.append('title', title);
      fd.append('category', category);
      fd.append('confidentiality', confidentiality);
      if (file) fd.append('file', file);
      return (await api.post(`/cases/${caseId}/documents`, fd)).data;
    },
    onSuccess: () => {
      setTitle(''); setFile(null);
      void qc.invalidateQueries({ queryKey: ['documents', caseId] });
    },
  });

  const download = async (doc: DocMeta) => {
    const res = await api.get(`/documents/${doc.id}/download`, { responseType: 'blob' });
    const url = URL.createObjectURL(res.data as Blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = doc.fileName ?? doc.title;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="grid" style={{ gap: 'var(--sp-5)' }}>
      <form
        className="card"
        onSubmit={(e) => { e.preventDefault(); if (title && file) upload.mutate(); }}
      >
        <h3 className="card__title">Upload a document</h3>
        <div className="grid grid-2">
          <div className="field">
            <label htmlFor="d-title">Title</label>
            <input id="d-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor="d-cat">Category</label>
            <select id="d-cat" className="select" value={category} onChange={(e) => setCategory(e.target.value)}>
              {CATEGORY_OPTIONS.map((c) => <option key={c} value={c}>{c.replaceAll('_', ' ')}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="d-conf">Confidentiality</label>
            <select id="d-conf" className="select" value={confidentiality} onChange={(e) => setConfidentiality(e.target.value)}>
              {CONFIDENTIALITY_OPTIONS.map((c) => <option key={c} value={c}>{c.replaceAll('_', ' ')}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="d-file">File</label>
            <input id="d-file" type="file" className="input" onChange={(e) => setFile(e.target.files?.[0] ?? null)} required />
          </div>
        </div>
        <button className="btn btn--primary" type="submit" disabled={upload.isPending || !title || !file}>
          {upload.isPending ? 'Uploading…' : 'Upload'}
        </button>
        {upload.isError && <div className="alert alert--danger" style={{ marginTop: 'var(--sp-3)' }}>Upload failed or not permitted.</div>}
      </form>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {isLoading ? <p className="muted" style={{ padding: 'var(--sp-4)' }}>Loading…</p> : (
          <table className="table">
            <thead><tr><th>No.</th><th>Title</th><th>Category</th><th>Confidentiality</th><th>Size</th><th>Scan</th><th></th></tr></thead>
            <tbody>
              {data?.length ? data.map((d) => (
                <tr key={d.id}>
                  <td>{d.caseDocumentNumber}</td>
                  <td>{d.title}<br /><span className="field__hint" title={d.fileHash}>#{d.fileHash?.slice(0, 10)}</span></td>
                  <td>{d.category.replaceAll('_', ' ')}</td>
                  <td><span className="badge badge--info">{d.confidentiality.replaceAll('_', ' ')}</span></td>
                  <td>{humanSize(d.fileSize)}</td>
                  <td><span className={`badge ${d.virusScan === 'CLEAN' ? 'badge--success' : 'badge--warning'}`}>{d.virusScan}</span></td>
                  <td><button className="btn btn--ghost" onClick={() => void download(d)}>Download</button></td>
                </tr>
              )) : <tr><td colSpan={7}><div className="empty-state" style={{ border: 0 }}>No documents you can access.</div></td></tr>}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
