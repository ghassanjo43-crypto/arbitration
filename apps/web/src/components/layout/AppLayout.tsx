import { Outlet } from 'react-router-dom';
import { PageNav } from './PageNav';

/**
 * Layout for authenticated app pages (everything under /app except the dashboard
 * index). Renders the compact Back / Dashboard navigation above the routed page so
 * every internal/admin page has a consistent way back to the main area.
 */
export function AppLayout() {
  return (
    <>
      <PageNav />
      <Outlet />
    </>
  );
}
