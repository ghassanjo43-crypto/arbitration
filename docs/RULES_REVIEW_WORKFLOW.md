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
ACTIVE v1 ──clone──▶ DRAFT v2 ──edit──▶ chapter-by-chapter review
                                              │
              BLOCKER / CHANGE_REQUESTED  ──▶ (blocked: no sign-off)
                                              │ every chapter cleared
                                              ▼
                                    sign-off ──▶ reviewState APPROVED
                                              │
                                    activate ──▶ ACTIVE v2  (v1 → SUPERSEDED)

   (abandoned drafts / superseded versions ──▶ archive ──▶ ARCHIVED, history kept)
```

1. **Clone to draft** — `POST /rules/admin/versions` deep-clones a version's
   chapters, rules and deadline definitions into a new `DRAFT`. Live cases are
   untouched: each case stays pinned to its own `RuleSetVersion`.
2. **Edit (draft only)** — `PATCH /rules/admin/rules/:ruleId` edits a rule's text
   (`title`/`text` EN+AR, `mandatoryLawWarning`, `publicVisible`). Editing an
   `ACTIVE` version is refused (active versions are immutable).
3. **Diff** — `GET /rules/admin/diff?base=<id>&target=<id>` returns a per-rule
   diff matched by rule number: `ADDED` / `REMOVED` / `CHANGED` (with the list of
   changed fields and both texts) / `UNCHANGED`, plus a summary count.
4. **Chapter review** — `POST /rules/admin/versions/:versionId/chapters/:chapterId/review`
   records counsel's decision **per chapter**: `NO_ISSUE` / `COMMENT` /
   `CHANGE_REQUESTED` / `BLOCKER` / `APPROVED`, with an optional `jurisdiction`
   and `comment`. Each decision recomputes the version's `reviewState`
   (`UNDER_REVIEW` / `CHANGES_REQUESTED` / `BLOCKED`); introducing a blocker or
   change after sign-off automatically **revokes** the sign-off. (A finer per-rule
   review endpoint also exists for detail.)
5. **Comments** — `POST /rules/admin/versions/:versionId/comments` appends an
   immutable reviewer comment (chapter-scoped or version-wide) with author and
   timestamp preserved.
6. **Sign-off (gated)** — `POST /rules/admin/versions/:id/sign-off` requires every
   chapter to be reviewed with **no `BLOCKER` and no `CHANGE_REQUESTED`**. It
   records who signed off and when and sets `reviewState = APPROVED`.
7. **Activate (gated)** — `POST /rules/admin/versions/:id/activate` requires the
   version to be **signed off** (`reviewState = APPROVED`) and re-validates the
   chapter gate. On success the version becomes `ACTIVE` and the prior `ACTIVE`
   version is `SUPERSEDED`.
8. **Archive** — `POST /rules/admin/versions/:id/archive` sets `ARCHIVED`
   (abandoned drafts / superseded versions kept for history). The active version
   cannot be archived. **History is preserved** — content is never overwritten.

## Version states

- **Lifecycle** (`status`): `DRAFT` → `ACTIVE` → `SUPERSEDED`; plus `WITHDRAWN`
  and `ARCHIVED`.
- **Review state** (`reviewState`, derived from chapter reviews + sign-off):
  `NOT_STARTED` → `UNDER_REVIEW` → `CHANGES_REQUESTED` / `BLOCKED` → `APPROVED`
  (only on sign-off).

## What gates sign-off & activation

`chapterSummary(versionId)` reports per-status chapter counts plus
`clearForSignOff` (every chapter reviewed, no `BLOCKER`, no `CHANGE_REQUESTED`)
and `activatable` (DRAFT + `reviewState APPROVED` + signed off). The frontend
disables **Sign off** until `clearForSignOff`, and **Activate** until
`activatable`; the API enforces both gates server-side.

## Engine graph after activation

Cloned rules carry their scalar operational metadata and deadline definitions.
The normalized engine graph (`RuleTrigger`/`RuleAction` and requirement rows) is
derived idempotently by `backfillEngineGraph()` and runs on every deploy via
`npm run db:seed:topup` (see [RULES_ENGINE.md](RULES_ENGINE.md)). Run that
top-up after activating a new version so the engine acts on the new rules.

## Audit events

`RULE_VERSION_DRAFTED`, `RULE_TEXT_EDITED`, `RULE_CHAPTER_REVIEWED`,
`RULE_REVIEW_COMMENT_ADDED`, `RULE_VERSION_SIGNED_OFF`, `RULE_VERSION_ACTIVATED`,
`RULE_VERSION_ARCHIVED` (+ the finer `RULE_REVIEW_RECORDED` per rule).

## UI

A council user reaches the workflow from the dashboard (**Rules review**) →
`/app/admin/rules`: a versions table showing each version's **lifecycle** and
**review state** with gated **Sign off** / **Activate** / **Archive** actions; a
per-version surface with a **chapter-by-chapter** decision selector, the comment
log, and a **Compare against** diff picker. A prominent banner states this is a
counsel-review workflow, **not** a substitute for qualified legal advice.

## Source

`apps/api/src/rules/rule-review.service.ts` (+ `RuleReviewController` in
`rules.controller.ts`), schema models `RuleChapterReview` / `RuleReviewComment` /
`RuleReviewItem` and enums `ChapterReviewStatus` / `VersionReviewState`.
Tests: `rule-review.service.spec.ts`, `AdminRulesReview.test.tsx`.
