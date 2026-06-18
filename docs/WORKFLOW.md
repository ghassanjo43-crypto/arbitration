# Sample Arbitration Workflow

This walkthrough maps the 38 case stages to the critical flows in the specification. Stages are
defined in `packages/shared/src/case.ts` (`CaseStage`) and recorded in `CaseStatusHistory`.

## 1. Individual registers and files a case
1. Individual registers (`POST /auth/register`, role `INDIVIDUAL`) and verifies email.
2. Signs in, opens **File a Case**, completes the guided Notice of Arbitration.
3. `POST /cases/draft` creates a `Case` at stage **DRAFT** with the filer as `CLAIMANT`
   (`CaseTeamMember`) and a unique reference `GAAP-YYYY-NNNNNN`.
4. After declarations, `POST /cases/:id/submit` → **SUBMITTED**.

## 2. Lawyer files on behalf of a company
1. Lawyer registers (role `LAWYER`), completes profile (bar, jurisdiction, licence docs).
2. Files with capacity `LAWYER_FOR_COMPANY`; lawyer becomes `CLAIMANT_REPRESENTATIVE`, the
   company `CLAIMANT`.

## 3. Registrar reviews and registers
- Stages: **SUBMITTED → FILING_FEE_PENDING → ADMINISTRATIVE_REVIEW**.
- If incomplete: **DEFICIENCY_NOTICE_ISSUED → AWAITING_CLAIMANT_CORRECTION**.
- Otherwise: **CASE_REGISTERED** (registrar holds `case:register`).

## 4. Respondent receives notice and onboards
- **NOTICE_BEING_SERVED → AWAITING_RESPONDENT_REGISTRATION → AWAITING_RESPONSE**.
- Respondent registers, is added as `RESPONDENT` (and rep as `RESPONDENT_REPRESENTATIVE`).
- **RESPONSE_RECEIVED** once the answer is filed.

## 5–7. Tribunal constitution
- **ARBITRATION_TERMS_PENDING → TRIBUNAL_APPOINTMENT_PENDING**.
- `AppointmentInvitation` issued to arbitrator(s).
- **CONFLICT_CHECK** — arbitrator submits `ConflictDisclosure` with independence/impartiality
  declarations.
- **ARBITRATOR_ACCEPTANCE_PENDING** → on acceptance a `TribunalMember` + a `TRIBUNAL_CHAIR`/
  `TRIBUNAL_MEMBER` `CaseTeamMember` row is created → **TRIBUNAL_CONSTITUTED**.
- Only now can that arbitrator read the case and access the **deliberation area**.

## 8. Parties exchange submissions
- **PRELIMINARY_CONFERENCE_SCHEDULED → PROCEDURAL_TIMETABLE_ISSUED →
  STATEMENT_OF_CLAIM → STATEMENT_OF_DEFENCE → (COUNTERCLAIM) → REPLY → REJOINDER →
  DOCUMENT_PRODUCTION → WITNESS_EVIDENCE → EXPERT_EVIDENCE**.
- Substantive party-to-tribunal messages are visible to all authorised parties (ex-parte guard).

## 9. Registrar schedules a hearing
- **HEARING_PREPARATION → HEARING_IN_PROGRESS**.
- `Hearing` + `HearingRoom`s (tribunal, party/witness waiting, breakout) via the video provider
  abstraction; identity-verification and attendance logged.

## 10. Tribunal issues an award
- **POST_HEARING_SUBMISSIONS → DELIBERATION → DRAFT_AWARD → AWARD_ISSUED**.
- Deliberation notes are tribunal-only. `Award` records type, seat, signature status, delivery,
  download log, and correction/interpretation status.
- **CORRECTION_OR_INTERPRETATION** if requested → **CLOSED**.
- Alternative terminal stages: **SUSPENDED**, **SETTLED**, **WITHDRAWN**, **TERMINATED**.

## Access-control checks proven by tests
- **11. Unauthorised users cannot view documents** — `canViewDocument` denies non-members and
  opposing-side `PARTY_PRIVATE`.
- **12. Administrators cannot access tribunal deliberations** — `assertDeliberationAccess`
  rejects everyone who is not an appointed tribunal member, including `SUPER_ADMIN`.
