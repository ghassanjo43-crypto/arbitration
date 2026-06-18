import { useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LanguageSwitcher } from '../LanguageSwitcher';
import { useAuth } from '../../auth/AuthContext';

const PRIMARY_LINKS = [
  { to: '/about', key: 'nav.about' },
  { to: '/how-it-works', key: 'nav.howItWorks' },
  { to: '/arbitrators', key: 'nav.arbitrators' },
  { to: '/rules', key: 'nav.rules' },
  { to: '/fee-calculator', key: 'nav.feeCalculator' },
  { to: '/news', key: 'nav.news' },
];

export function Header() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);

  return (
    <header className="site-header">
      <div className="container site-header__inner">
        <Link to="/" className="brand" aria-label={t('brand.name')}>
          <span className="brand__mark" aria-hidden="true">GA</span>
          <span className="brand__text">
            <span className="brand__name">{t('brand.short')}</span>
            <span className="brand__sub">{t('home.heroEyebrow')}</span>
          </span>
        </Link>

        <button
          className="site-header__toggle"
          aria-expanded={open}
          aria-controls="primary-nav"
          onClick={() => setOpen((o) => !o)}
        >
          <span className="sr-only">Menu</span>
          <span aria-hidden="true">≡</span>
        </button>

        <nav id="primary-nav" className={`site-nav ${open ? 'site-nav--open' : ''}`} aria-label="Primary">
          {PRIMARY_LINKS.map((l) => (
            <NavLink key={l.to} to={l.to} className="site-nav__link" onClick={() => setOpen(false)}>
              {t(l.key)}
            </NavLink>
          ))}
        </nav>

        <div className="site-header__actions">
          <LanguageSwitcher />
          {user ? (
            <Link to="/app" className="btn btn--ghost">{t('nav.dashboard')}</Link>
          ) : (
            <Link to="/sign-in" className="btn btn--ghost">{t('nav.signIn')}</Link>
          )}
          <Link to="/file-a-case" className="btn btn--gold">{t('common.fileCaseCta')}</Link>
        </div>
      </div>
    </header>
  );
}
