# Data Retention & Protection (Chapter 25)

> **Counsel-review notice.** Retention periods, deletion handling, data-subject
> rights, data hosting location and cross-border transfer mechanisms must be set
> by qualified privacy/data-protection counsel for each relevant jurisdiction
> before production launch. The values here are engineering defaults, not legal
> determinations.

## Principles

- **Confidentiality by default.** A case is confidential unless the parties
  consent otherwise. Documents carry a `ConfidentialityLevel`
  (`PUBLIC`, `CASE_PARTIES`, `PARTY_PRIVATE`, `TRIBUNAL_ONLY`, `ADMIN_ONLY`) with
  side-scoped `PARTY_PRIVATE`.
- **Least privilege.** `CaseAccessService` enforces case-level access; holding a
  powerful global role (even `SUPER_ADMIN`) never grants tribunal deliberations
  or merits-private documents.
- **Technical administrators must not have unrestricted access** to case files.
  Any exceptional access must be authorised, purpose-limited, time-limited,
  logged and reviewable.

## Records & soft deletion

Models use UUID keys and `createdAt` / `updatedAt`, with `deletedAt` where
retention matters (soft delete preserves the arbitral record). Append-only logs
(`AuditLog`, `RuleAuditLog`, `FinancialLedgerEntry`) are **not** editable or
deletable by normal users or ordinary administrators.

## Executable retention framework

The platform implements a **controlled, auditable** retention/deletion/export
framework (`apps/api/src/retention`). It is **safe by design** — nothing is
deleted by default.

### Categories, behaviours & default periods

Periods are **engineering defaults** (`retention-policy.ts`), overridable per
category via the `retention.policy` SystemSetting. Counsel must set the real
values per seat.

| Category | Behaviour | Default | Anchor |
|----------|-----------|---------|--------|
| Case records | SOFT_DELETE | 10 yr | case closure |
| Filings / pleadings | SOFT_DELETE (with the case) | 10 yr | case closure |
| Evidence / documents | SOFT_DELETE (with the case) | 10 yr | case closure |
| **Awards & generated PDFs** | **RETAIN_FOREVER** | — | — |
| **Notices & service certificates** | **RETAIN_FOREVER** | — | — |
| **Audit logs** | **RETAIN_FOREVER** | — | — |
| Email delivery evidence | REVIEW | 7 yr | sent date |
| Compliance / KYC screening | REVIEW | 5 yr | created |
| User accounts | REVIEW | 3 yr | deactivation |
| Authentication logs | REVIEW | 1 yr | created |
| Public CMS content | REVIEW (manual) | — | — |

- **RETAIN_FOREVER** — safeguarded; a sweep reports it as `RETAINED` and **refuses
  to delete** it. Awards, service evidence and audit logs always survive.
- **SOFT_DELETE** — past the period → `deletedAt` set + status `DELETED`, with a
  **tombstone** (`RetentionSweepRecord`) and a preserved content hash. The row and
  its evidence remain.
- **REVIEW** — past the period → reported as `ELIGIBLE_FOR_REVIEW`; **never
  auto-deleted** — a human decides.

### Retention status (`RetentionStatus`)

`ACTIVE · RETAINED · ELIGIBLE_FOR_REVIEW · SCHEDULED_FOR_DELETION · DELETED ·
LEGAL_HOLD` — tracked on the `Case` (and reported per record class in a sweep).

### Legal hold

A `LegalHold` (active/released, with reason + who/when) sets `Case.legalHold`. A
held case is **never** deleted by a sweep (`assertNoLegalHold` also guards any
direct case-deletion path). Release clears the flag only when no other active hold
remains. Place/release are audited (`LEGAL_HOLD_PLACED` / `LEGAL_HOLD_RELEASED`).

### Sweep: dry-run first, gated execution

- **Dry run** (`POST /api/admin/retention/sweep/dry-run`) — evaluates every
  category and reports eligible counts (and how many are blocked by a legal hold).
  **Changes nothing.** Audited `RETENTION_DRY_RUN`.
- **Execute** (`POST /api/admin/retention/sweep/execute`) — **gated**: requires the
  **SUPER_ADMIN** role, **`confirm: true`**, and an explicit **opt-in category
  list**. Only `SOFT_DELETE` categories act (currently at the case-record anchor);
  `RETAIN_FOREVER` is refused; `REVIEW` is flagged not deleted; legal-held cases are
  skipped. Each deletion writes a tombstone + audit
  (`CASE_SOFT_DELETED_RETENTION`, `RETENTION_SWEEP_EXECUTED`).

### Export before deletion

`GET /api/admin/retention/cases/:caseId/export` produces a **manifest** of the
case (identity, parties, status history, and the **hashes** of documents, awards
and service certificates) — the portability/pre-deletion bundle. The binaries
themselves are exported from object storage (S3 `sync`/download) alongside the
manifest; the hashes let the export be integrity-checked after transfer.

### Admin UI

Super-admins manage retention at **`/app/admin/retention`**: the policy table,
legal-hold place/release, a dry-run report, and (super-admin only) the gated
execute with a confirmation prompt. All endpoints require `SETTINGS_MANAGE`.

### Safeguards (criterion 11)

Awards, audit logs and service evidence (notices/certificates + service email
evidence) are `RETAIN_FOREVER` and **cannot be deleted by a sweep**. Document and
record **hashes** (`DocumentVersion.fileHash`, `Award.documentHash`,
`ServiceCertificate.documentHash`/`payloadHash`) and the append-only audit trail
are preserved as deletion evidence.

## Retention vs. erasure

Arbitral records may need to be retained for enforcement and limitation periods
that can **override** a deletion request. Counsel must define, per jurisdiction:

- retention period per record class (case file, award, financial ledger, audit
  logs, identity/KYC, login history);
- which records survive a data-subject erasure request and on what legal basis;
- export format and process for data-portability requests;
- breach-notification thresholds and timelines.

## Hosting & transfers

Production data is hosted in the configured Render region (see
`docs/DEPLOYMENT.md`). Cross-border transfer mechanisms (adequacy, SCCs) and the
lawful hosting location are **legal questions** tracked in
`docs/LEGAL_REVIEW_CHECKLIST.md` (items 12–14).

## Source

Confidentiality enforcement: `apps/api/src/authz/case-access.service.ts`.
Audit: `apps/api/src/audit/`. Schema: `Document*`, `AuditLog`, `RuleAuditLog`,
`LoginEvent`, `Session`, `IdentityVerification`.
