/**
 * Backup & disaster-recovery READINESS verification (read-only, non-destructive).
 *
 * This script never writes, deletes, or restores anything. It confirms the
 * preconditions a healthy backup/DR posture depends on, and reports what it
 * CANNOT verify from the app (those are infrastructure-level checks the operator
 * must perform — see docs/BACKUP_AND_DR.md).
 *
 * Checks:
 *   1. Database reachable.
 *   2. Latest migration in prisma/migrations is applied (schema is current).
 *   3. Object storage reachable (S3 HeadBucket, or local root exists).
 *   4. A sample stored document object is readable (HEAD/stat — bytes not fetched).
 *   5. The restore procedure is documented (docs/BACKUP_AND_DR.md present).
 *
 * Usage (run with the target environment's env):
 *   DATABASE_URL=... [STORAGE_DRIVER=s3 S3_BUCKET=... S3_REGION=...] \
 *     node apps/api/scripts/verify-backup-readiness.mjs
 *
 * Exit code 0 if all CRITICAL checks pass; non-zero otherwise. INFO/WARN findings
 * (e.g. no documents yet to sample) do not fail the run.
 */
import { PrismaClient } from '@prisma/client';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const API_ROOT = resolve(__dirname, '..');
const REPO_ROOT = resolve(API_ROOT, '..', '..');

const results = [];
function record(name, level, ok, detail) {
  results.push({ name, level, ok, detail });
  const tag = ok ? 'PASS' : level === 'CRITICAL' ? 'FAIL' : level;
  console.log(`[${tag}] ${name}${detail ? ` — ${detail}` : ''}`);
}

const prisma = new PrismaClient();

async function checkDatabase() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    record('Database reachable', 'CRITICAL', true, process.env.DATABASE_URL ? maskUrl(process.env.DATABASE_URL) : '(from env)');
    return true;
  } catch (e) {
    record('Database reachable', 'CRITICAL', false, e.message.split('\n')[0]);
    return false;
  }
}

async function checkMigrationsCurrent() {
  // The migration directory names are the source of truth.
  const migDir = join(API_ROOT, 'prisma', 'migrations');
  if (!existsSync(migDir)) {
    record('Latest migration applied', 'WARN', false, 'no migrations directory found');
    return;
  }
  const dirs = readdirSync(migDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  const latest = dirs[dirs.length - 1];
  if (!latest) {
    record('Latest migration applied', 'WARN', false, 'no migrations on disk');
    return;
  }
  try {
    const rows = await prisma.$queryRaw`
      SELECT migration_name, finished_at FROM "_prisma_migrations"
      WHERE finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 1`;
    const appliedLatest = rows?.[0]?.migration_name;
    const ok = appliedLatest === latest;
    record('Latest migration applied', 'CRITICAL', ok,
      ok ? latest : `on disk: ${latest}; applied: ${appliedLatest ?? 'none'} — run \`prisma migrate deploy\``);
  } catch (e) {
    record('Latest migration applied', 'WARN', false, `could not read _prisma_migrations: ${e.message.split('\n')[0]}`);
  }
}

async function checkStorage() {
  const driver = process.env.STORAGE_DRIVER ?? 'local';
  if (driver === 's3') {
    const bucket = process.env.S3_BUCKET;
    if (!bucket) {
      record('Object storage reachable', 'CRITICAL', false, 'STORAGE_DRIVER=s3 but S3_BUCKET unset');
      return null;
    }
    try {
      const { S3Client, HeadBucketCommand } = await import('@aws-sdk/client-s3');
      const s3 = makeS3(S3Client);
      await s3.send(new HeadBucketCommand({ Bucket: bucket }));
      record('Object storage reachable', 'CRITICAL', true, `s3 bucket ${bucket}`);
      return { driver, s3, bucket };
    } catch (e) {
      record('Object storage reachable', 'CRITICAL', false, `s3 bucket ${bucket}: ${e.message.split('\n')[0]}`);
      return null;
    }
  }
  // local driver
  const root = resolve(API_ROOT, process.env.STORAGE_LOCAL_ROOT ?? './storage');
  const ok = existsSync(root);
  record('Object storage reachable', ok ? 'CRITICAL' : 'WARN', ok, `local root ${root}${ok ? '' : ' (will be created on first upload)'}`);
  return ok ? { driver, root } : null;
}

async function checkSampleObjectReadable(storage) {
  if (!storage) {
    record('Sample document object readable', 'WARN', false, 'storage not reachable — skipped');
    return;
  }
  const version = await prisma.documentVersion.findFirst({ orderBy: { createdAt: 'desc' }, select: { storageKey: true, fileName: true } }).catch(() => null);
  if (!version) {
    record('Sample document object readable', 'INFO', true, 'no documents stored yet — nothing to sample');
    return;
  }
  if (storage.driver === 's3') {
    // In production (S3) a missing object is a CRITICAL finding — real data loss.
    try {
      const { HeadObjectCommand } = await import('@aws-sdk/client-s3');
      await storage.s3.send(new HeadObjectCommand({ Bucket: storage.bucket, Key: version.storageKey }));
      record('Sample document object readable', 'CRITICAL', true, `HEAD ok: ${version.storageKey}`);
    } catch (e) {
      record('Sample document object readable', 'CRITICAL', false, `${version.storageKey}: ${e.message.split('\n')[0]}`);
    }
  } else {
    // Local driver = development. Seeded/synthetic documents may have storage keys
    // with no backing file, so a miss here is a WARN, not a critical failure.
    const full = join(storage.root, version.storageKey);
    const ok = existsSync(full) && statSync(full).size > 0;
    record('Sample document object readable', ok ? 'CRITICAL' : 'WARN', ok,
      ok ? `readable: ${version.storageKey}` : `missing on local disk: ${version.storageKey} (expected for synthetic seed data; verify with a real S3 bucket)`);
  }
}

function checkRestoreDocumented() {
  const doc = join(REPO_ROOT, 'docs', 'BACKUP_AND_DR.md');
  const ok = existsSync(doc);
  record('Restore procedure documented', 'CRITICAL', ok, ok ? 'docs/BACKUP_AND_DR.md' : 'docs/BACKUP_AND_DR.md missing');
}

function makeS3(S3Client) {
  const endpoint = process.env.S3_ENDPOINT || undefined;
  const accessKeyId = process.env.S3_ACCESS_KEY_ID || undefined;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY || undefined;
  return new S3Client({
    region: process.env.S3_REGION ?? 'us-east-1',
    ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
    ...(accessKeyId && secretAccessKey ? { credentials: { accessKeyId, secretAccessKey } } : {}),
  });
}

function maskUrl(url) {
  return url.replace(/:\/\/([^:]+):[^@]*@/, '://$1:***@');
}

function infraReminders() {
  console.log('\nThe app CANNOT verify these — confirm at the infrastructure level (docs/BACKUP_AND_DR.md):');
  console.log('  • Automated DB backups + PITR are enabled and a recent snapshot exists.');
  console.log('  • S3 bucket versioning, lifecycle, encryption and access logging are configured.');
  console.log('  • A non-destructive restore drill has been run on staging within the review window.');
  console.log('  • Secrets (PASSWORD_PEPPER, signing keys, provider keys) are vaulted and rotated.');
}

async function main() {
  console.log('Backup & DR readiness — read-only verification\n');
  const dbOk = await checkDatabase();
  if (dbOk) {
    await checkMigrationsCurrent();
  }
  const storage = await checkStorage();
  await checkSampleObjectReadable(storage);
  checkRestoreDocumented();
  infraReminders();

  await prisma.$disconnect();
  const criticalFailures = results.filter((r) => r.level === 'CRITICAL' && !r.ok);
  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} checks passed; ${criticalFailures.length} critical failure(s).`);
  process.exit(criticalFailures.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
