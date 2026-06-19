import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

const COLUMNS = [
  {
    headingKey: 'nav.platform',
    links: [
      { to: '/about', key: 'nav.about' },
      { to: '/how-it-works', key: 'nav.howItWorks' },
      { to: '/rules', key: 'nav.rules' },
      { to: '/arbitrators', key: 'nav.arbitrators' },
    ],
  },
  {
    headingKey: 'nav.resources',
    links: [
      { to: '/news', key: 'nav.news' },
      { to: '/court-highlights', key: 'nav.courtHighlights' },
      { to: '/publications', key: 'nav.publications' },
      { to: '/model-clause', key: 'nav.modelClause' },
      { to: '/submission-agreement', key: 'nav.submissionAgreement' },
    ],
  },
  {
    headingKey: 'nav.fileCase',
    links: [
      { to: '/file-a-case', key: 'nav.fileCase' },
      { to: '/lawyer-registration', key: 'nav.lawyerRegistration' },
      { to: '/faq', key: 'nav.faq' },
      { to: '/contact', key: 'nav.contact' },
    ],
  },
];

export function Footer() {
  const { t } = useTranslation();
  return (
    <footer className="site-footer">
      <div className="container">
        <div className="site-footer__top">
          <div className="site-footer__brand">
            <span className="brand__name brand__name--light">{t('brand.name')}</span>
            <p className="muted-light">{t('footer.tagline')}</p>
          </div>
          {COLUMNS.map((col) => (
            <nav key={col.headingKey} aria-label={t(col.headingKey)}>
              <h4 className="site-footer__heading">{t(col.headingKey)}</h4>
              <ul className="site-footer__list">
                {col.links.map((l) => (
                  <li key={l.to}>
                    <Link to={l.to}>{t(l.key)}</Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="site-footer__notice">
          <strong>{t('footer.disclaimerTitle')}:</strong> {t('legal.noGuarantee')}
        </div>

        <div className="site-footer__bottom">
          <span>© {new Date().getFullYear()} {t('brand.name')}. {t('footer.rights')}</span>
          <span className="site-footer__legal-links">
            <Link to="/privacy">{t('nav.privacy')}</Link>
            <Link to="/terms">{t('nav.terms')}</Link>
          </span>
        </div>
      </div>
    </footer>
  );
}
