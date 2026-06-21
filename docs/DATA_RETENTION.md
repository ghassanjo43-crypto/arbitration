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
