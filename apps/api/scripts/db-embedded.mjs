/**
 * Local PostgreSQL for development WITHOUT Docker or a system install.
 * Uses the `embedded-postgres` package (real PostgreSQL 18 binaries) to run a
 * managed cluster on port 5433. The process stays alive so the API can connect.
 *
 *   npm run db:embedded   (keep running in its own terminal / background)
 *
 * Data persists under apps/api/.pgdata. Credentials match DATABASE_URL in .env.
 */
import EmbeddedPostgres from 'embedded-postgres';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, '..', '.pgdata');

const PORT = Number(process.env.EMBEDDED_PG_PORT ?? 5433);
const USER = process.env.EMBEDDED_PG_USER ?? 'arbitration';
const PASSWORD = process.env.EMBEDDED_PG_PASSWORD ?? 'arbitration_local_dev';
const DB_NAME = process.env.EMBEDDED_PG_DB ?? 'arbitration';

const pg = new EmbeddedPostgres({
  databaseDir: DATA_DIR,
  user: USER,
  password: PASSWORD,
  port: PORT,
  authMethod: 'scram-sha-256',
  persistent: true,
  onLog: (m) => process.stdout.write(`[pg] ${m}\n`),
  onError: (m) => process.stderr.write(`[pg:err] ${m}\n`),
});

async function main() {
  const alreadyInitialised = existsSync(resolve(DATA_DIR, 'PG_VERSION'));
  if (!alreadyInitialised) {
    console.log(`Initialising new PostgreSQL cluster at ${DATA_DIR} …`);
    await pg.initialise();
  } else {
    console.log(`Reusing existing cluster at ${DATA_DIR}.`);
  }

  await pg.start();
  console.log(`PostgreSQL started on 127.0.0.1:${PORT} (user "${USER}").`);

  // Ensure the application database exists (createDatabase is a no-op-safe call we guard).
  try {
    await pg.createDatabase(DB_NAME);
    console.log(`Created database "${DB_NAME}".`);
  } catch (err) {
    const msg = String(err?.message ?? err);
    if (/already exists/i.test(msg)) console.log(`Database "${DB_NAME}" already exists.`);
    else throw err;
  }

  console.log('READY — embedded PostgreSQL is running. Press Ctrl+C to stop.');

  const shutdown = async (signal) => {
    console.log(`\nReceived ${signal}, stopping PostgreSQL …`);
    try {
      await pg.stop();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  // Keep the event loop alive indefinitely.
  await new Promise(() => {});
}

main().catch((err) => {
  console.error('Failed to start embedded PostgreSQL:', err);
  process.exit(1);
});
