import { useLocation, useNavigate } from 'react-router-dom';

/**
 * Compact in-app navigation shown at the top of every authenticated page except
 * the dashboard itself. "Back" uses browser history when there is an in-app entry
 * to return to, and otherwise falls back to the dashboard (so it is never a no-op).
 */
export function PageNav() {
  const navigate = useNavigate();
  const location = useLocation();

  const goBack = () => {
    // react-router sets location.key to 'default' for the first entry of the
    // session — i.e. the user landed here directly with no in-app history.
    if (location.key !== 'default') navigate(-1);
    else navigate('/app');
  };

  return (
    <nav className="page-nav" aria-label="Page navigation">
      <div className="container page-nav__inner">
        <button type="button" className="btn btn--ghost btn--sm" onClick={goBack} aria-label="Back">
          <span aria-hidden="true">←</span> Back
        </button>
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => navigate('/app')}>
          Dashboard
        </button>
      </div>
    </nav>
  );
}
