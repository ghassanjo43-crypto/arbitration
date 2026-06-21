# Rules Engine

> **Counsel-review notice.** The procedural rules and their operational encoding
> require review by qualified arbitration counsel before production launch.
> Mandatory provisions of the law of the seat prevail over any portal rule.

The platform does not merely publish a PDF of rules: the rules are an
**operational engine** that governs case workflow. This document describes how it
is built and how to author rules.

## Entities

Authoring / content (versioned, immutable per version):

- `RuleSet` → `RuleSetVersion` → `RuleChapter` → `Rule`
- `RuleDeadlineDefinition` — a reusable deadline rule attached to a `Rule`
- Normalized operational graph: `RuleTrigger` → `RuleAction`, plus
  `RuleNoticeRequirement`, `RuleDocumentRequirement`, `RuleFeeDefinition`,
  `RulePermissionRequirement`

Per-case (the engine acts on these):

- `CaseRuleSet` — pins a case to **exactly one** `RuleSetVersion` (immutable)
- `CaseRuleAcceptance` — a party's sealed acceptance receipt (hashed)
- `CaseProceduralEvent` — the event log the engine reacts to
- `CaseRuleExecution` — provenance of every automated action
- `CaseRuleOverride` — an authorised, recorded modification for one case
- `CaseRuleException` — a tribunal / mandatory-law displacement of a step
- `RuleAuditLog` — append-only engine/rule audit trail

## How a rule fires

1. An authorised actor records a `CaseProceduralEvent` (e.g. `NOTICE_SERVED`,
   `FILING_SUBMITTED`, `CASE_REGISTERED`).
2. `RuleEngineService.applyEvent()` resolves every `RuleTrigger` whose
   `eventType` matches — **but only within the case's pinned `RuleSetVersion`.**
   A later amendment therefore never reaches a live case.
3. For each matching trigger, its `RuleAction`s run in order:
   - `CREATE_DEADLINE` — materialises a `Deadline` from a
     `RuleDeadlineDefinition` (see `docs/DEADLINE_CALCULATION.md`). This is the
     only action that creates a concrete entity.
   - `REQUIRE_NOTICE`, `REQUIRE_DOCUMENT`, `ASSESS_FEE`, `ADVANCE_STAGE`,
     `FLAG_DEFAULT`, `RECORD_COMMENCEMENT` — record an **advisory**
     `CaseRuleExecution` (a worklist item) for the registry / tribunal. The
     engine never decides merits, fees or stage on its own.
4. Every action writes a `CaseRuleExecution` and an immutable `RuleAuditLog` row.
5. Execution is **idempotent**: re-processing the same event never duplicates a
   deadline or a worklist item.

Optional JSON guards on a trigger (`conditionJson`) are matched against the
event's `metadata`; a malformed guard never blocks the workflow.

## Authoring rules

Rules are seeded (`apps/api/prisma/seed.ts`) with scalar metadata on each `Rule`
(`triggeringEvent`, `requiredNotice`, `feeConsequence`, `mandatoryLawWarning`,
`publicVisible`, EN + AR text, …). The idempotent `backfillEngineGraph()` derives
the normalized `RuleTrigger`/`RuleAction`/requirement rows from those scalars, so
the same intent is both human-readable and operational. The backfill runs on
every deploy via `npm run db:seed:topup`.

Each rule supports: number, title, chapter, text (EN + AR), version, effective
date, status, triggering event, responsible participant, permitted action,
required notice/documents, deadline calculation, fee/default consequence,
extension/waiver authority, applicable case types/roles, audit requirement,
mandatory-law warning, and public/internal visibility.

## Acceptance

`CaseRuleAcceptance` records who accepted, on behalf of which party, with seat /
governing law / language / number of arbitrators / appointment method / consents,
plus evidentiary metadata (IP, user-agent, auth method, e-signature metadata).
A **sealed receipt** (`receiptNumber` + SHA-256 `receiptHash` over the canonical
payload) is produced and cannot be altered unnoticed.

## Overrides, exceptions, mandatory law

- **Override** (`CaseRuleOverride`) — a recorded, agreed modification for one
  case (authority: party agreement or tribunal direction). The original value is
  preserved.
- **Exception** (`CaseRuleException`) — a procedural step modified to preserve
  fairness, or displaced by mandatory law of the seat. Authority: tribunal,
  appointing authority, or mandatory law. The portal administrator cannot
  override a tribunal decision.

## Source

`apps/api/src/rules/` (engine, service, controller), schema section
"NORMALIZED RULES ENGINE" in `apps/api/prisma/schema.prisma`. Tests:
`rule-engine.spec.ts`.
