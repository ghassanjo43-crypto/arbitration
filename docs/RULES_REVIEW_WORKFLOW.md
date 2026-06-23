# Rules Counsel-Review & Versioning Workflow

> **The platform does not perform the legal review.** This workflow records
> qualified counsel's per-rule decisions and *gates* activation so a procedural
> rule set cannot go live until every rule has been cleared. The legal judgement
> itself is, and remains, external. See the
> [Legal Review Checklist](LEGAL_REVIEW_CHECKLIST.md) for the institution-level
> matters that sit alongside this per-rule review.

This is the authoring / diff / versioning tooling for the procedural rules. It
lets the policy function (council, `POLICY_MANAGE`) draft a new rule-set version,
have counsel review it rule by rule, compare it against an existing version, and
publish it only once review is complete.

## Roles & permissions

All administration endpoints require the **`POLICY_MANAGE`** permission (held by
`COUNCIL_MEMBER`). Reading the public rules and the per-case applicable rules is
unchanged and unaffected.

> Separation of duties (author ≠ approver) is not yet enforced — the same
> `POLICY_MANAGE` holder may both edit and clear a rule. Every action is
> attributed and audited; enforcing distinct author/approver identities is a
> documented future enhancement.

## Lifecycle

```
ACTIVE v1 ──clone──▶ DRAFT v2 ──edit rules──▶ counsel review (per rule)
                                                   │
                          PENDING / CHANGE_REQUIRED / BLOCKER  ──▶ (blocked)
                                                   │ all OK
                                                   ▼
                                        activate ──▶ ACTIVE v2  (v1 → SUPERSEDED)
```

1. **Clone to draft** — `POST /rules/admin/versions` deep-clones a version's
   chapters, rules and deadline definitions into a new `DRAFT`. Every cloned rule
   gets a `PENDING` review item. Live cases are untouched: each case stays pinned
   to its own `RuleSetVersion`.
2. **Edit (draft only)** — `PATCH /rules/admin/rules/:ruleId` edits a rule's text
   (`title`/`text` EN+AR, `mandatoryLawWarning`, `publicVisible`). Editing an
   `ACTIVE` version is refused (active versions are immutable). **Any edit
   re-opens that rule's review** (back to `PENDING`) so a late change cannot
   bypass review.
3. **Diff** — `GET /rules/admin/diff?base=<id>&target=<id>` returns a per-rule
   diff matched by rule number: `ADDED` / `REMOVED` / `CHANGED` (with the list of
   changed fields and both texts) / `UNCHANGED`, plus a summary count.
4. **Review** — `POST /rules/admin/versions/:versionId/rules/:ruleId/review`
   records counsel's decision per rule: `OK` / `CHANGE_REQUIRED` / `BLOCKER`
   (or back to `PENDING`), with an optional `jurisdiction` and `note`. Decisions
   may only be recorded against a `DRAFT`.
5. **Activate (gated)** — `POST /rules/admin/versions/:id/activate` refuses
   unless **every** rule is reviewed `OK` (no `PENDING`/`CHANGE_REQUIRED`/
   `BLOCKER`). On success the version becomes `ACTIVE` with an effective date and
   the prior `ACTIVE` version of the same rule set is `SUPERSEDED`.

## What gates activation

`summarise(versionId)` reports `{ ruleCount, OK, CHANGE_REQUIRED, BLOCKER,
PENDING, clearToActivate }`. `clearToActivate` is true **only** when
`OK === ruleCount` (rules without a review item count as `PENDING`). The frontend
disables the **Activate** button until then; the API enforces the same gate
server-side.

## Engine graph after activation

Cloned rules carry their scalar operational metadata and deadline definitions.
The normalized engine graph (`RuleTrigger`/`RuleAction` and requirement rows) is
derived idempotently by `backfillEngineGraph()` and runs on every deploy via
`npm run db:seed:topup` (see [RULES_ENGINE.md](RULES_ENGINE.md)). Run that
top-up after activating a new version so the engine acts on the new rules.

## UI

A council user reaches the workflow from the dashboard (**Rules review**) →
`/app/admin/rules`: a versions table with each version's review summary and a
gated **Activate** action, a per-version review surface with a status selector
per rule, and a **Compare against** picker that flags added/changed rules inline.

## Source

`apps/api/src/rules/rule-review.service.ts` (+ `RuleReviewController` in
`rules.controller.ts`), schema models `RuleReviewItem` / `RuleReviewStatus`.
Tests: `rule-review.service.spec.ts`, `AdminRulesReview.test.tsx`.
