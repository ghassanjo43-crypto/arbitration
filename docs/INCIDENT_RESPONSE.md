# Observability & Incident Response

> **Purpose.** Detect, investigate and respond to failures affecting arbitration
> cases, notices, documents, hearings, deadlines, awards and user access. This
> document is the on-call runbook. It complements
> [BACKUP_AND_DR.md](BACKUP_AND_DR.md) (recovery) and
> [SECURITY.md](SECURITY.md) (controls).

## What the platform gives you to observe

| Signal | Where | Notes |
|--------|-------|-------|
| **Correlation id** | `X-Correlation-Id` response header + every log line + error body | Reuses an inbound `X-Correlation-Id`/`X-Request-Id`; ties a client error to its server logs |
| **Structured request log** | App logs (`Request` context) | JSON per request: `method, path, status, durationMs, correlationId, userId, roles, caseId`. Metadata only — no bodies/query, so no secrets/case material leak |
| **Safe error envelope** | API responses | 5xx returns a generic message + correlation id; full detail is logged server-side only |
| **Operational failure events** | `AuditLog` (action `OPERATIONAL_FAILURE`) + `Operational` logs | Recorded for unhandled 5xx (tagged by component: `storage / video / pdf / email / screening / deadline / auth / api`) and for account lockout |
| **Email delivery evidence** | `EmailDelivery` / `EmailDeliveryEvent` + audit | Per-email status trail, provider message id, bounce/complaint, manual fallback |
| **Login events** | `LoginEvent` | `SUCCESS / FAILED / LOCKED / MFA_REQUIRED` with ip/user-agent |
| **Liveness** | `GET /api/health` | Process is up; **no** dependency checks (Render `healthCheckPath`) |
| **Readiness** | `GET /api/readiness` | Deep: `db, migrations, storage, video, email, screening`; **503** when not ready — point uptime monitoring here |

### What the app can check vs what infrastructure must check

| App-checkable | Infrastructure-level (out of band) |
|---|---|
| Liveness, readiness (DB/migrations/storage/video/email/screening) | Provider dashboards (Render, Resend, S3, Daily) |
| Operational-failure audit events | Centralised log aggregation / alerting / error tracking |
| Email delivery + webhook-failure evidence | DNS / SPF / DKIM / DMARC health |
| Backup readiness (`npm run verify:backup`) | That backups/PITR actually exist and a restore drill ran |

## Recommended production monitoring [INFRA]

1. **Uptime check** on `GET /api/readiness` (1–2 min interval) — alert on `503`
   or any `checks.*: down`. (Keep the Render `healthCheckPath` on `/api/health`.)
2. **Render alerts**: deploy failures, service restarts, instance health, and
   **PostgreSQL** metrics (connections, storage, CPU).
3. **Resend dashboard / webhook**: bounce + complaint rates; alert when the email
   webhook stops delivering events (the `EmailDelivery` rows will sit in `SENT`
   without progressing — query for `SENT` older than N hours).
4. **S3 / object storage**: 4xx/5xx error-rate metrics and access logs; bucket
   metrics (size, request errors).
5. **DB health**: connection saturation, replication/PITR lag, free storage.
6. **Backup verification**: run `npm run verify:backup -w @gaap/api` on a schedule
   and alert on a non-zero exit.
7. **Log aggregation**: ship app logs to a central store and alert on
   `OPERATIONAL_FAILURE` and on 5xx rate.

## Severity levels

| Sev | Definition | Target response | Escalation |
|-----|------------|-----------------|------------|
| **SEV1** | Platform down, data-integrity risk, or **suspected unauthorized access** to case data | **Acknowledge ≤ 15 min**, all-hands | On-call → eng lead → security/DPO + management; preserve evidence immediately |
| **SEV2** | A critical subsystem degraded (email/storage/video/PDF/deadlines) but the platform is partly usable | **Acknowledge ≤ 1 h** | On-call → eng lead |
| **SEV3** | Minor/contained; workaround exists; no case impact | **Next business day** | On-call handles |

> Failed **service of a notice** or a missed/incorrect **deadline** is at least
> SEV2 — it can prejudice a party. Suspected **unauthorized access to tribunal
> deliberations or party-private material** is **SEV1**.

## Evidence to preserve during ANY incident

Before remediating, capture (and do not alter):

- **Audit logs** (`AuditLog`, append-only) for the window — especially
  `OPERATIONAL_FAILURE` rows and the affected actions.
- **Service evidence**: `FormalNotice` / `NoticeRecipient` / `NoticeDeliveryAttempt`
  / `ServiceCertificate`, and **email delivery evidence** (`EmailDelivery` +
  events) with **provider message ids / event ids**.
- **Document & PDF hashes** (`DocumentVersion.fileHash`, `Award.documentHash`,
  `ServiceCertificate.documentHash`) — to prove integrity post-recovery.
- **Access logs**: `LoginEvent`, `DocumentActivity`, infra-level S3 access logs.
- **Affected case ids** and the **correlation ids** from the error/logs.

These are immutable/append-only by design; the goal is to snapshot them (e.g. a
read-only DB export of the relevant rows) before any restore overwrites context.

---

## Incident runbooks

### 1. Email delivery outage (SEV2)
- **Detect:** readiness `email: down`; rising `EmailDelivery` rows stuck in `SENT`;
  webhook events stop; Resend dashboard errors.
- **Investigate:** check `RESEND_API_KEY` validity, sending-domain DNS
  (SPF/DKIM/DMARC), Resend status, and recent `EMAIL_SEND_FAILED` audit rows.
- **Respond:** transient failures auto-retry with backoff
  (`POST /api/admin/email-deliveries/retry-sweep` to force a sweep). For
  legally-significant notices that hard-bounced, the notice is already routed to
  **manual/substitute service** — effect it (courier/registered mail) and record
  it. **Never** mark a notice received from a send.
- **Preserve:** `EmailDelivery` rows + provider message ids, `NoticeFailure`.

### 2. Storage / S3 outage (SEV2, SEV1 if data loss suspected)
- **Detect:** readiness `storage: down`; document upload/download 5xx;
  `OPERATIONAL_FAILURE` with component `storage`.
- **Investigate:** S3 status, bucket/credentials/region, `npm run verify:backup`
  (sample object readable?).
- **Respond:** if reachability only, wait out the provider / fail over region. If
  objects are missing, restore from **versioning** or the **replica** (see
  BACKUP_AND_DR). Generated award PDFs can be **regenerated** from the relational
  record if the binary is lost (the sealed hash will differ — note it).
- **Preserve:** document hashes, the list of affected `storageKey`s.

### 3. Database outage (SEV1)
- **Detect:** readiness `db: down`; 5xx across the app.
- **Investigate:** Render PostgreSQL status, connection limits, storage full.
- **Respond:** restore connectivity; if data loss, follow the **PITR / restore
  runbook** (BACKUP_AND_DR) into a **new** instance, then repoint `DATABASE_URL`.
  Run `npm run verify:backup` (latest migration applied?) before restoring traffic.
- **Preserve:** the last good snapshot id / PITR timestamp; do not overwrite the
  damaged instance until evidence is captured.

### 4. Video-provider outage (SEV2)
- **Detect:** readiness `video: down`; hearing-room provisioning 5xx
  (`OPERATIONAL_FAILURE` component `video`).
- **Investigate:** Daily status, `DAILY_API_KEY`.
- **Respond:** reschedule or fall back to the backup hearing platform noted on the
  hearing (`backupContact`); the tribunal may adjourn. Rooms auto-expire, so
  re-provision when restored.

### 5. Suspected unauthorized access (SEV1)
- **Detect:** anomalous `LoginEvent` (geo/volume), repeated `LOCKED`, unexpected
  `DocumentActivity` on `PARTY_PRIVATE`/`TRIBUNAL_ONLY`, or an
  `OPERATIONAL_FAILURE` component `auth`.
- **Respond:** **preserve evidence first** (audit, login, access logs). Rotate
  affected secrets (`PASSWORD_PEPPER` requires care — see below), force-logout /
  reset affected accounts, suspend compromised accounts. Engage security/DPO;
  assess **breach-notification** obligations (privacy law / seat). Confidential
  deliberations and party-private material are the highest priority.
- **Note:** rotating `PASSWORD_PEPPER` invalidates all stored password hashes —
  plan a coordinated reset, do not rotate it casually.

### 6. Failed award / document generation (SEV2)
- **Detect:** `OPERATIONAL_FAILURE` component `pdf`; award/certificate generation
  5xx.
- **Investigate:** the correlation id in the response → server logs; storage
  reachability (the PDF is stored after rendering).
- **Respond:** retry generation (`POST /api/awards/:id/document`); it rebuilds from
  the relational record. Confirm the download re-verifies the stored hash. The
  tribunal's decision is unaffected — only the rendered artifact failed.

### 7. Failed migration / deploy (SEV1/SEV2)
- **Detect:** deploy fails; readiness `migrations: down` (an unfinished migration);
  app won't start.
- **Investigate:** the Render deploy logs and `prisma migrate status`.
- **Respond:** migrations are **forward-only** — there is no auto-rollback. Either
  fix forward (a corrective migration) or **restore the DB to a point-in-time
  before the migration** (BACKUP_AND_DR) and redeploy the prior app version. Never
  edit an already-applied migration. Validate with `npm run verify:backup` and
  `/api/readiness` before restoring traffic.

## Source

`apps/api/src/common/observability/` (correlation-id middleware, request-logging
interceptor, observability service), `apps/api/src/common/http-exception.filter.ts`,
`apps/api/src/health/` (liveness + readiness). Tests: `readiness.service.spec.ts`,
`http-exception.filter.spec.ts`.
