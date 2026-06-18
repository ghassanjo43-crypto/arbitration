import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '../components/PageHeader';
import { api } from '../lib/api';

interface NewsItem { id: string; slug: string; title: string; excerpt?: string; category?: string; publishedAt?: string; }
interface HighlightItem { id: string; slug: string; courtName: string; jurisdiction: string; caseName: string; citation?: string; legalIssue: string; summary: string; outcome?: string; decisionDate?: string; }
interface PublicationItem { id: string; slug: string; title: string; abstract?: string; authorName?: string; }

function useList<T>(key: string, url: string) {
  return useQuery<{ data: T[] }>({ queryKey: [key], queryFn: async () => (await api.get(url)).data });
}

export function News() {
  const { t } = useTranslation();
  const { data, isLoading } = useList<NewsItem>('news', '/news');
  return (
    <>
      <PageHeader eyebrow="Insight" title={t('home.newsTitle')} lede="Developments in international arbitration, legislation, and enforcement." />
      <div className="section"><div className="container">
        {isLoading && <p className="muted">{t('common.loading')}</p>}
        {data && data.data.length === 0 && <div className="empty-state">{t('common.noResults')}</div>}
        <div className="grid grid-3">
          {data?.data.map((n) => (
            <article key={n.id} className="card card--interactive">
              {n.category && <span className="badge badge--gold">{n.category}</span>}
              <h3 className="card__title" style={{ marginTop: 'var(--sp-3)' }}>{n.title}</h3>
              <p className="muted">{n.excerpt}</p>
            </article>
          ))}
        </div>
      </div></div>
    </>
  );
}

export function CourtHighlights() {
  const { t } = useTranslation();
  const { data, isLoading } = useList<HighlightItem>('highlights', '/court-highlights');
  return (
    <>
      <PageHeader eyebrow="Insight" title={t('home.highlightsTitle')} lede="Notable decisions on arbitration, recognition, and enforcement." />
      <div className="section"><div className="container">
        {isLoading && <p className="muted">{t('common.loading')}</p>}
        {data && data.data.length === 0 && <div className="empty-state">{t('common.noResults')}</div>}
        <div className="grid grid-2">
          {data?.data.map((h) => (
            <article key={h.id} className="card">
              <div className="arb-card__meta">
                <span className="badge badge--info">{h.jurisdiction}</span>
                {h.citation && <span className="badge">{h.citation}</span>}
              </div>
              <h3 className="card__title" style={{ marginTop: 'var(--sp-3)' }}>{h.caseName}</h3>
              <p className="muted"><strong>{h.courtName}</strong> — {h.legalIssue}</p>
              <p className="muted">{h.summary}</p>
              {h.outcome && <p><strong>Outcome:</strong> {h.outcome}</p>}
            </article>
          ))}
        </div>
      </div></div>
    </>
  );
}

export function Publications() {
  const { t } = useTranslation();
  const { data, isLoading } = useList<PublicationItem>('publications', '/publications');
  return (
    <>
      <PageHeader eyebrow="Insight" title={t('nav.publications')} />
      <div className="section"><div className="container">
        {isLoading && <p className="muted">{t('common.loading')}</p>}
        {data && data.data.length === 0 && <div className="empty-state">{t('common.noResults')}</div>}
        <div className="grid grid-3">
          {data?.data.map((p) => (
            <article key={p.id} className="card card--interactive">
              <h3 className="card__title">{p.title}</h3>
              {p.authorName && <p className="field__hint">{p.authorName}</p>}
              <p className="muted">{p.abstract}</p>
            </article>
          ))}
        </div>
      </div></div>
    </>
  );
}
