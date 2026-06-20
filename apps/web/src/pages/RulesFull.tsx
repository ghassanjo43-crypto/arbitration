import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';

interface VersionSummary {
  id: string;
  version: string;
  status: string;
  effectiveDate?: string | null;
  supersededAt?: string | null;
  changeSummary?: string | null;
  changeSummaryAr?: string | null;
}
interface RuleSetSummary {
  id: string;
  code: string;
  title: string;
  titleAr?: string | null;
  description?: string | null;
  descriptionAr?: string | null;
  versions: VersionSummary[];
}
interface DeadlineDef { id: string; key: string; label: string; labelAr?: string | null; days: number; dayKind: string; }
interface RuleNode {
  id: string; number: string; title: string; titleAr?: string | null; text: string; textAr?: string | null;
  deadlineDefinitions: DeadlineDef[];
}
interface ChapterNode { id: string; number: number; title: string; titleAr?: string | null; summary?: string | null; summaryAr?: string | null; rules: RuleNode[]; }
interface VersionDetail {
  id: string; version: string; status: string; effectiveDate?: string | null;
  mandatoryLawNotice: string; mandatoryLawNoticeAr?: string | null;
  ruleSet: RuleSetSummary; chapters: ChapterNode[];
}

export function RulesFull() {
  const { i18n } = useTranslation();
  const ar = i18n.language === 'ar';
  const pick = (en: string, arVal?: string | null) => (ar && arVal ? arVal : en);

  const [sets, setSets] = useState<RuleSetSummary[]>([]);
  const [versionId, setVersionId] = useState<string | null>(null);
  const [detail, setDetail] = useState<VersionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    api.get('/rules/sets')
      .then(({ data }) => {
        if (!active) return;
        setSets(data);
        const active2 = data[0]?.versions.find((v: VersionSummary) => v.status === 'ACTIVE') ?? data[0]?.versions[0];
        setVersionId(active2?.id ?? null);
      })
      .catch(() => active && setError(true))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!versionId) return;
    let active = true;
    api.get(`/rules/versions/${versionId}`)
      .then(({ data }) => active && setDetail(data))
      .catch(() => active && setError(true));
    return () => { active = false; };
  }, [versionId]);

  if (loading) return <div className="section"><div className="container"><p className="muted">Loading rules…</p></div></div>;
  if (error || sets.length === 0) {
    return (
      <div className="section"><div className="container">
        <div className="alert alert--info">
          The procedural rules have not yet been published in this environment. Once a rule set is seeded it will appear here in English and Arabic.
        </div>
      </div></div>
    );
  }

  const set = sets[0];

  return (
    <div className="section">
      <div className="container">
        <p className="eyebrow">{set.code}</p>
        <h1>{pick(set.title, set.titleAr)}</h1>
        {set.description && <p className="lead">{pick(set.description, set.descriptionAr)}</p>}

        <div className="field-inline" style={{ marginTop: 'var(--sp-4)' }}>
          <label className="field__label" htmlFor="ver">Applicable version</label>
          <select id="ver" className="input" value={versionId ?? ''} onChange={(e) => setVersionId(e.target.value)}>
            {set.versions.map((v) => (
              <option key={v.id} value={v.id}>
                {`v${v.version} — ${v.status}${v.effectiveDate ? ` (eff. ${new Date(v.effectiveDate).toLocaleDateString()})` : ''}`}
              </option>
            ))}
          </select>
        </div>

        {detail && (
          <>
            <div className="alert alert--warning" style={{ marginTop: 'var(--sp-4)' }}>
              {pick(detail.mandatoryLawNotice, detail.mandatoryLawNoticeAr)}
            </div>

            {detail.chapters.map((ch) => (
              <section key={ch.id} style={{ marginTop: 'var(--sp-6)' }}>
                <h2>{ch.number}. {pick(ch.title, ch.titleAr)}</h2>
                {ch.summary && <p className="muted">{pick(ch.summary, ch.summaryAr)}</p>}
                {ch.rules.map((r) => (
                  <div key={r.id} className="card" style={{ marginTop: 'var(--sp-3)' }}>
                    <h3 className="card__title">{r.number} {pick(r.title, r.titleAr)}</h3>
                    <p>{pick(r.text, r.textAr)}</p>
                    {r.deadlineDefinitions.map((d) => (
                      <span key={d.id} className="badge badge--gold" style={{ marginInlineEnd: 8 }}>
                        ⏱ {pick(d.label, d.labelAr)}: {d.days} {d.dayKind === 'BUSINESS' ? 'business' : 'calendar'} days
                      </span>
                    ))}
                  </div>
                ))}
              </section>
            ))}
          </>
        )}

        <p className="field__hint" style={{ marginTop: 'var(--sp-6)' }}>
          These rules require review by qualified arbitration counsel before production launch. Recognition and enforcement of any
          award remain subject to applicable arbitration law, international conventions, due-process requirements, arbitrability,
          public policy, and the law of the jurisdiction in which recognition or enforcement is sought.
        </p>
      </div>
    </div>
  );
}
