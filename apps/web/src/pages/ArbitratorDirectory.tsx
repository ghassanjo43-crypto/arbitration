import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  ARBITRATION_FIELD_LABELS,
  ArbitrationField,
  AvailabilityStatus,
  FeeBand,
} from '@gaap/shared';
import { api } from '../lib/api';

interface ArbitratorCard {
  id: string;
  fullName: string;
  professionalTitle?: string;
  photoUrl?: string;
  nationality?: string;
  countryOfResidence?: string;
  biography?: string;
  yearsExperience?: number;
  casesAsChair: number;
  casesAsSole: number;
  feeBand: string;
  availability: string;
  legalFields: string[];
  languages: string[];
}

interface SearchResponse {
  data: ArbitratorCard[];
  total: number;
  page: number;
  pageSize: number;
}

export function ArbitratorDirectory() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');

  const filters = {
    q: params.get('q') ?? undefined,
    legalField: params.get('legalField') ?? undefined,
    language: params.get('language') ?? undefined,
    availability: params.get('availability') ?? undefined,
    feeBand: params.get('feeBand') ?? undefined,
    minYears: params.get('minYears') ?? undefined,
    page: params.get('page') ?? '1',
  };

  const { data, isLoading, isError } = useQuery<SearchResponse>({
    queryKey: ['arbitrators', filters],
    queryFn: async () => {
      const res = await api.get('/arbitrators', { params: filters });
      return res.data;
    },
  });

  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete('page');
    setParams(next);
  };

  return (
    <div className="section">
      <div className="container">
        <header className="page-head">
          <p className="eyebrow">{t('nav.platform')}</p>
          <h1>{t('directory.title')}</h1>
          <p className="lede">{t('directory.subtitle')}</p>
        </header>

        <form
          className="directory-search"
          onSubmit={(e) => {
            e.preventDefault();
            update('q', q);
          }}
          role="search"
        >
          <input
            className="input"
            placeholder={t('common.search')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label={t('common.search')}
          />
          <button className="btn btn--primary" type="submit">{t('common.search')}</button>
        </form>

        <div className="directory-layout">
          <aside className="directory-filters" aria-label={t('common.filters')}>
            <div className="field">
              <label htmlFor="f-field">{t('directory.legalField')}</label>
              <select id="f-field" className="select" value={filters.legalField ?? ''} onChange={(e) => update('legalField', e.target.value)}>
                <option value="">{t('common.all')}</option>
                {Object.values(ArbitrationField).map((f) => (
                  <option key={f} value={f}>{ARBITRATION_FIELD_LABELS[f]}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="f-lang">{t('common.language')}</label>
              <select id="f-lang" className="select" value={filters.language ?? ''} onChange={(e) => update('language', e.target.value)}>
                <option value="">{t('common.all')}</option>
                <option value="English">English</option>
                <option value="Arabic">Arabic</option>
                <option value="French">French</option>
                <option value="Spanish">Spanish</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="f-avail">{t('directory.availability')}</label>
              <select id="f-avail" className="select" value={filters.availability ?? ''} onChange={(e) => update('availability', e.target.value)}>
                <option value="">{t('common.all')}</option>
                {Object.values(AvailabilityStatus).map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="f-fee">{t('directory.feeBand')}</label>
              <select id="f-fee" className="select" value={filters.feeBand ?? ''} onChange={(e) => update('feeBand', e.target.value)}>
                <option value="">{t('common.all')}</option>
                {Object.values(FeeBand).map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="f-years">{t('directory.experience')}</label>
              <select id="f-years" className="select" value={filters.minYears ?? ''} onChange={(e) => update('minYears', e.target.value)}>
                <option value="">{t('common.all')}</option>
                <option value="10">10+</option>
                <option value="15">15+</option>
                <option value="20">20+</option>
                <option value="25">25+</option>
              </select>
            </div>
            <button type="button" className="btn btn--ghost btn--block" onClick={() => setParams(new URLSearchParams())}>
              {t('common.clearFilters')}
            </button>
          </aside>

          <section className="directory-results" aria-live="polite">
            {isLoading && <p className="muted">{t('common.loading')}</p>}
            {isError && <div className="alert alert--danger">{t('common.error')}</div>}
            {data && data.data.length === 0 && <div className="empty-state">{t('common.noResults')}</div>}
            <div className="grid grid-2">
              {data?.data.map((a) => (
                <article key={a.id} className="card card--interactive arb-card">
                  <div className="arb-card__head">
                    <div className="arb-avatar" aria-hidden="true">
                      {a.fullName.split(' ').map((n) => n[0]).slice(0, 2).join('')}
                    </div>
                    <div>
                      <h3 className="card__title">{a.fullName}</h3>
                      <p className="muted arb-card__title">{a.professionalTitle}</p>
                    </div>
                  </div>
                  <p className="muted arb-card__bio">{a.biography}</p>
                  <div className="arb-card__meta">
                    {a.countryOfResidence && <span className="badge">{a.countryOfResidence}</span>}
                    <span className="badge badge--info">{a.casesAsChair} as chair</span>
                    <span className={`badge ${a.availability === 'AVAILABLE' ? 'badge--success' : 'badge--warning'}`}>{a.availability}</span>
                  </div>
                  <div className="arb-card__fields">
                    {a.legalFields.slice(0, 3).map((f) => (
                      <span key={f} className="badge badge--gold">{ARBITRATION_FIELD_LABELS[f as ArbitrationField] ?? f}</span>
                    ))}
                  </div>
                  <Link to={`/arbitrators/${a.id}`} className="btn btn--ghost btn--block">{t('common.readMore')}</Link>
                </article>
              ))}
            </div>

            {data && data.total > data.pageSize && (
              <nav className="pagination" aria-label="Pagination">
                <button
                  className="btn btn--ghost"
                  disabled={Number(filters.page) <= 1}
                  onClick={() => update('page', String(Number(filters.page) - 1))}
                >←</button>
                <span className="muted">
                  {t('common.page')} {data.page} {t('common.of')} {Math.ceil(data.total / data.pageSize)}
                </span>
                <button
                  className="btn btn--ghost"
                  disabled={data.page >= Math.ceil(data.total / data.pageSize)}
                  onClick={() => update('page', String(data.page + 1))}
                >→</button>
              </nav>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
