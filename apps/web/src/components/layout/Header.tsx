import { useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LanguageSwitcher } from '../LanguageSwitcher';
import { useAuth } from '../../auth/AuthContext';

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

const PRIMARY_LINKS = [
  { to: '/about', key: 'nav.about' },
  { to: '/how-it-works', key: 'nav.howItWorks' },
  { to: '/arbitrators', key: 'nav.arbitrators' },
  { to: '/rules', key: 'nav.rules' },
  { to: '/news', key: 'nav.news' },
  { to: '/contact', key: 'nav.contact' },
];

export function Header() {
  const { t } = useTranslation();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const handleSignOut = async () => {
    setOpen(false);
    await logout();
    navigate('/');
  };

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
            <div className="user-menu">
              <Link to="/app" className="user-chip" title={`${user.displayName} — ${user.email}`}>
                <span className="user-chip__avatar" aria-hidden="true">{initials(user.displayName)}</span>
                <span className="user-chip__text">
                  <span className="user-chip__name">{user.displayName}</span>
                  <span className="user-chip__hint">{t('nav.dashboard')}</span>
                </span>
              </Link>
              <button type="button" className="user-chip__signout" onClick={handleSignOut}>
                {t('nav.signOut')}
              </button>
            </div>
          ) : (
            <>
              <Link to="/sign-in" className="btn btn--ghost">{t('nav.signIn')}</Link>
              <Link to="/file-a-case" className="btn btn--gold">{t('common.fileCaseCta')}</Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
