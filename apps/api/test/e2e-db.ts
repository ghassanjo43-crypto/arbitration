import { readFileSync } from 'fs';
import { resolve } from 'path';

export const E2E_SCHEMA = 'e2e_test';
export const E2E_PEPPER = 'e2e-fixed-pepper';
export const E2E_PASSWORD = 'E2ePassword!2026';

/** Reads the dev DATABASE_URL from the repo-root .env and retargets it to an isolated schema. */
function baseUrl(): string {
  const txt = readFileSync(resolve(__dirname, '..', '..', '..', '.env'), 'utf8');
  const m = txt.match(/^DATABASE_URL=(.*)$/m);
  if (!m) throw new Error('DATABASE_URL not found in root .env — start the embedded DB first.');
  return m[1].trim();
}

export function e2eDatabaseUrl(): string {
  const url = baseUrl();
  return url.includes('schema=')
    ? url.replace(/schema=[^&]*/, `schema=${E2E_SCHEMA}`)
    : url + (url.includes('?') ? '&' : '?') + `schema=${E2E_SCHEMA}`;
}

export function adminDatabaseUrl(): string {
  const url = baseUrl();
  return url.includes('schema=') ? url.replace(/schema=[^&]*/, 'schema=public') : url;
}
