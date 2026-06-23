# Backup & Disaster Recovery

> **Status: production-readiness plan, not an active guarantee.** This document
> defines the backup/DR strategy and runbooks. Several controls require
> **provider configuration** (Render, S3) that engineering cannot enable from the
> application — those are called out explicitly. Before launch, every item marked
> **[INFRA]** must be configured and a restore drill completed; every **[LEGAL]**
> target must be approved by the business and counsel. See the
> [Legal Review Checklist](LEGAL_REVIEW_CHECKLIST.md) (data hosting / residency).

## What has to survive a disaster (and where it lives)

| Asset | Where it is stored | Backed up by |
|-------|--------------------|--------------|
| **Relational data** (cases, parties, tribunal, deadlines, fees, rules) | PostgreSQL | DB backup |
| **Audit logs** (`AuditLog`, append-only) | PostgreSQL | DB backup |
| **Email delivery evidence** (`EmailDelivery` / `EmailDeliveryEvent`) | PostgreSQL | DB backup |
| **Rule reviews / sign-offs, screening, compliance holds** | PostgreSQL | DB backup |
| **Uploaded case documents** (`DocumentVersion.storageKey`) | Object storage (S3) | Storage backup |
| **Generated award PDFs** (`Award.generatedDocumentKey`) | Object storage (S3) | Storage backup |
| **Service certificate PDFs** (`ServiceCertificate.documentKey`) | Object storage (S3) | Storage backup |

**Key point:** the audit log and the email delivery evidence are *rows in
PostgreSQL*, so they are protected by the **database** backup — not the object
store. The object store protects the **binary documents** (uploads + generated
PDFs). A complete recovery needs **both** restored to a consistent point.

> Integrity aids already in the app: documents and generated PDFs are stored with
> a **SHA-256 hash**; the audit log is **append-only** (no update/delete path);
> rule acceptances, awards and certificates carry **sealed hashes**. After a
> restore, these hashes let you detect tampering or partial corruption.

---

## RPO / RTO targets (PLACEHOLDERS — pending business/legal approval) [LEGAL]

| Target | Placeholder | Meaning |
|--------|-------------|---------|
| **RPO** (max acceptable data loss) | **≤ 5 minutes** with PITR enabled; **≤ 24 h** with daily snapshots only | How much recent data a disaster may lose |
| **RTO** (max acceptable downtime) | **≤ 4 hours** | How long recovery may take before service is restored |
| **Backup retention** | **35 days** (DB PITR window) + **90 days** (storage versions) | How far back you can recover |
| **Restore-drill cadence** | **Quarterly** on staging | How often recovery is rehearsed |

These are starting points. Final values must be set against the parties' and
seats' expectations and any data-protection obligations, then re-stated here.

---

## PostgreSQL — backup requirements [INFRA]

1. **Automated backups.** Enable the managed provider's automated daily backups.
   On **Render**, use a paid PostgreSQL plan (Free has no backups) — daily backups
   are taken automatically and shown under the database's *Backups* tab.
2. **Point-in-time recovery (PITR).** Enable PITR where the plan supports it
   (Render paid plans retain WAL for a recovery window, typically ~7 days; higher
   tiers longer). PITR is what makes the **≤ 5 min RPO** achievable.
3. **Off-provider copy.** At least weekly, export a logical dump and store it in a
   **separate** account/region (so a provider-account compromise can't take both):
   ```bash
   pg_dump --no-owner --format=custom "$DATABASE_URL" > gaap-$(date +%F).dump
   # upload the dump to a separate, encrypted, versioned bucket
   ```
4. **Migration rollback policy.** Migrations are forward-only (`prisma migrate
   deploy`). There is **no automatic down-migration**. To roll back a bad schema
   change: restore the database to a point-in-time **before** the migration, or
   apply a hand-written compensating migration. Never edit an already-applied
   migration file. (The verification script checks the latest migration is
   applied — see below.)
5. **Restore testing.** Run the staging restore drill (below) at least quarterly
   and record the date + measured restore time here.

### Restore runbook — PostgreSQL

**A. Provider snapshot / PITR (preferred):**
1. In the Render dashboard → database → *Backups*, pick the snapshot or PITR
   timestamp closest to (but before) the incident.
2. Restore into a **new** database instance (never overwrite the live one blindly).
3. Update `DATABASE_URL` on the API service to point at the restored instance.
4. Run `npm run verify:backup -w @gaap/api` against it (checks reachability +
   that the latest migration is applied).
5. Redeploy the API; confirm `GET /api/health` reports `db: up`.

**B. From a logical dump:**
```bash
# into a fresh, empty database
pg_restore --no-owner --clean --if-exists --dbname "$RESTORE_DATABASE_URL" gaap-YYYY-MM-DD.dump
npx prisma migrate deploy   # ensure the schema is current
```

---

## Object storage (S3-compatible) — bucket requirements [INFRA]

The app uses `STORAGE_DRIVER=s3` with a single documents bucket. Configure the
bucket itself (the app cannot set these):

1. **Versioning — ON.** Lets you recover a document that was overwritten or
   deleted (the app writes immutable, randomised keys, but versioning protects
   against operator/error/ransomware deletion).
2. **Lifecycle policy.** Transition noncurrent versions to cheaper storage after
   ~30 days and expire them after the retention window (e.g. 90 days), aligned to
   the data-retention policy ([DATA_RETENTION.md](DATA_RETENTION.md)). **Do not**
   expire *current* versions of records that must be retained for the arbitral
   file.
3. **Encryption at rest.** Default SSE (`AES256` or `aws:kms`). The app already
   requests SSE on every upload (`S3_SERVER_SIDE_ENCRYPTION`); enforce it with a
   bucket policy that denies unencrypted PUTs.
4. **Access logging.** Enable server access logging / CloudTrail data events to a
   separate log bucket, so document access is auditable at the infra layer (the
   app already logs document access at the application layer).
5. **Backup / replication.** Enable **cross-region replication** (or scheduled
   bucket-to-bucket copy) to a bucket in a second region/account. This is the
   object-store equivalent of the off-provider DB copy.
6. **Block public access — ON.** Confidential files are only ever served through
   the API's signed, time-limited, access-checked download path.

### Restore runbook — object storage
- **Single object / accidental delete:** restore the prior **version** (versioning
  must be ON), or copy it back from the replica bucket.
- **Whole-bucket loss:** re-create the bucket with the same settings and sync from
  the replica: `aws s3 sync s3://gaap-docs-replica s3://gaap-docs`.
- After restore, run `npm run verify:backup` to confirm a **sample document object
  is readable**, then spot-check that an award/certificate PDF downloads via the
  app (which re-verifies its stored SHA-256 hash path).

---

## Generated documents, awards, certificates & audit logs in the DR plan

- **Award PDFs** and **service-certificate PDFs** live in object storage; their
  storage keys + sealed SHA-256 hashes live in PostgreSQL. Both must be restored
  to a consistent point so a PDF's bytes still match the hash recorded for it.
- **Audit logs** and **email delivery evidence** are PostgreSQL rows — covered by
  the DB backup, **not** the object store. They are append-only / event-logged, so
  a PITR restore reconstructs the trail up to the recovery point.
- After any restore, regenerating an award PDF (`POST /awards/:id/document`) is
  always possible from the relational record if a binary is lost — but the
  original sealed hash will differ, so prefer restoring the original binary.

---

## Non-destructive restore drill (staging) [INFRA]

Rehearse recovery **without touching production**:

1. Provision a throwaway staging database (or an isolated schema) and a throwaway
   staging bucket.
2. Restore the **latest production DB snapshot** into the staging database
   (provider "restore to new instance", or `pg_restore` of a dump).
3. Sync a copy of the documents bucket into the staging bucket
   (`aws s3 sync s3://gaap-docs s3://gaap-docs-staging-drill`).
4. Point a staging API at the restored DB + staging bucket and run:
   ```bash
   DATABASE_URL=<staging> STORAGE_DRIVER=s3 S3_BUCKET=gaap-docs-staging-drill \
     npm run verify:backup -w @gaap/api
   ```
5. Manually confirm: a case loads, an award PDF downloads, the Delivery tab shows
   email evidence, and the audit log is present.
6. **Record** the drill date and the measured restore time (→ RTO) in this file.
7. Tear down the throwaway database + bucket. **Never** run a restore that
   overwrites the live database; restores always target a *new* instance first.

> The repo's own dev workflow mirrors this safety rule: schema validation is done
> in a throwaway schema via non-destructive `prisma migrate deploy`, never
> `migrate reset`, on a database that holds real data.

---

## Verification tooling (what the app CAN check)

`npm run verify:backup -w @gaap/api` (read-only, non-destructive) confirms:

| Check | Critical? |
|-------|-----------|
| Database reachable | yes |
| Latest migration applied (schema current) | yes |
| Object storage reachable (S3 `HeadBucket` / local root) | yes |
| A sample stored document object is readable (HEAD/stat only) | yes (if any docs exist) |
| Restore procedure documented (this file present) | yes |

It also prints the **[INFRA]** items it *cannot* verify and that the operator must
confirm out-of-band.

### App-level vs infrastructure-level readiness

| Can be checked **by the app** | Must be checked **at the infrastructure level** |
|---|---|
| DB connectivity (`GET /api/health` → `db`) | Automated backups enabled + a recent snapshot exists |
| Storage reachability (`GET /api/health` → `storage`) | PITR/WAL retention window |
| Latest migration applied (`verify:backup`) | Bucket versioning / lifecycle / encryption / access logging |
| A sample object is readable (`verify:backup`) | Cross-region replication / off-provider copy |
| Generated-PDF hash on download | A restore drill was actually completed |

`GET /api/health` already reports `db`, `storage`, `video`, `screening` as
`up`/`down` for liveness/readiness probes; it intentionally does **not** assert
that backups exist (an app cannot prove that).

---

## Environment / config reference

| Variable | Purpose | DR relevance |
|----------|---------|--------------|
| `DATABASE_URL` | Postgres connection | Restore target points here |
| `STORAGE_DRIVER` / `S3_BUCKET` / `S3_REGION` / `S3_ENDPOINT` | Object storage | Bucket to back up / replicate |
| `S3_SERVER_SIDE_ENCRYPTION` | SSE on upload | Encryption at rest |
| `PASSWORD_PEPPER`, `JWT_*`, `COOKIE_SECRET`, `EMAIL_WEBHOOK_SECRET` | Secrets | **Vault + rotate**; a restore is useless if these are lost — store them in the provider's secret manager, not only in `.env` |

> Losing `PASSWORD_PEPPER` makes every restored password hash unverifiable. Treat
> the secrets as part of the backup set: store them in a managed secret vault with
> their own recovery path.

## Drill log

| Date | Environment | DB restore time | Storage restore time | Result | Notes |
|------|-------------|-----------------|----------------------|--------|-------|
| _(pending first drill)_ | | | | | |
