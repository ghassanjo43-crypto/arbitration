# Security

This document summarises the security architecture and operational posture. It is a living
document; items marked *(ready)* have an interface/abstraction in place pending production wiring.

## Authentication

- **Password hashing:** Argon2id with a server-side **pepper** (`PASSWORD_PEPPER`) mixed in as
  the secret, so a database leak alone cannot verify passwords.
- **Tokens:** short-lived JWT **access token** (default 15 min) held in memory on the client;
  opaque **refresh token** stored as a hashed `Session` row and delivered via an `httpOnly`,
  `SameSite=Lax`, `Secure`-in-production cookie scoped to `/auth`.
- **Refresh-token rotation:** every refresh issues a new token and invalidates the old one;
  token reuse/mismatch revokes the session defensively.
- **Email verification & password reset:** single-use, hashed, time-limited tokens. Password
  reset invalidates all sessions.
- **Account lockout:** configurable failed-attempt threshold (`MAX_FAILED_LOGINS`) and lock
  window (`ACCOUNT_LOCK_MINUTES`).
- **MFA-ready:** schema fields (`mfaEnabled`, `mfaSecret`, recovery codes) and login gating in
  place; TOTP verification via `otplib` to be enabled per account.
- **Login history & device tracking:** `LoginEvent` and `Session` record IP, user-agent,
  outcome, and a `suspicious` flag for alerting.

## Authorization

- **Global RBAC** via `RolesGuard` / `PermissionsGuard`.
- **Case-level + object-level** authorization via `CaseAccessService`:
  - Tribunal deliberations: appointed tribunal members of the case only (no global override).
  - Documents: `ConfidentialityLevel` (`PUBLIC` / `CASE_PARTIES` / `PARTY_PRIVATE` /
    `TRIBUNAL_ONLY` / `ADMIN_ONLY`) with side scoping; opposing parties are blocked from each
    other's private material.
- **Self-registration restrictions:** staff and arbitrator roles cannot be self-assigned; they
  are provisioned/approved by the institution.

## Transport & headers

- **Helmet** security headers, configurable **CORS** allow-list, cookie signing.
- **Rate limiting** via `@nestjs/throttler` (global + stricter limits on auth endpoints).
- HTTPS/TLS terminates at the proxy in production (encryption in transit).

## Input & data safety

- **Validation:** global `ValidationPipe` with `whitelist` + `forbidNonWhitelisted`; DTOs use
  `class-validator`. Frontend mirrors with Zod.
- **SQL injection:** all access via Prisma (parameterised) — no raw string SQL on user input.
- **File handling:** type/size limits (`MAX_UPLOAD_MB`), SHA-256 integrity hashes, virus-scan
  status field *(scan adapter ready)*, soft-delete + retention fields.
- **Confidential files are never served from the public web root.** Downloads require a
  signed, time-limited, HMAC-verified token issued by the API.
- **Encryption at rest** *(ready)* — storage abstraction supports an encrypting/S3 backend.

## Auditability

- Append-only `AuditLog` covering login/logout/failed-login, account & role changes, case
  access, document upload/view/download/delete, messages, notices, payments, appointments,
  conflict disclosures, procedural orders, award upload/delivery, and permission changes.
- **No update or delete path** for audit records through the API or UI.

## Secrets & configuration

- No secrets in source. `.env` only; `.env.example` documents every variable with safe
  placeholders. Development fallbacks are clearly non-production and must be overridden.

## Incident response & backup *(operational)*

- **Backups:** nightly logical dumps of PostgreSQL + object-store replication; restore drills
  documented per environment.
- **Incident response:** triage → contain (revoke sessions/keys) → eradicate → recover →
  post-incident review; audit log and login history support forensic timelines.
- **Session invalidation:** per-session and per-user revocation supported (`TokensService`).

## Tested guarantees

Unit suite (`apps/api/src`, 27 tests):
- `authz/case-access.service.spec.ts` — deliberations restricted to appointed tribunal members
  (super-admin and registrar denied); opposing party cannot read another side's `PARTY_PRIVATE`
  documents; PUBLIC/CASE_PARTIES/TRIBUNAL_ONLY visibility behave as specified.
- `authz/permissions.spec.ts` — `deliberation:participate` is granted to no global role;
  party roles hold no global permissions; `role:manage`/`settings:manage` are super-admin only.
- `auth/password.service.spec.ts` — Argon2id hash/verify, random salt, and pepper-mismatch
  rejection (a DB-only leak cannot verify passwords).
- `fees/fee-calculator.service.spec.ts` — advisory fee logic.

End-to-end suite (`apps/api/test/app.e2e-spec.ts`, 11 tests, isolated `e2e_test` schema):
- auth (wrong password → 401, valid → token, no token → 401);
- case access (member 200, outsider 403);
- tribunal deliberations (member 200; party 403; **super-admin 403**);
- document access (opposing party cannot list or fetch a side's `PARTY_PRIVATE` doc; tribunal can);
- critical flow: appointment invite → conflict disclosure → accept (grants deliberation access) →
  constitute → award draft → sign → issue; and super-admin award drafting → 403.
