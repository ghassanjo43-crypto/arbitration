# Architecture

## Overview

A TypeScript monorepo (npm workspaces) with three packages:

- `@gaap/shared` — framework-agnostic domain model: roles, permissions, case stages,
  arbitration fields, DTO contracts, and centralised legal text. Imported by **both** the API
  and the web app so the two never drift on enums or authorization vocabulary.
- `@gaap/api` — NestJS REST API with Prisma/PostgreSQL.
- `@gaap/web` — React/Vite SPA, bilingual (EN/AR) with full RTL.

```
Browser (React SPA)
   │  HTTPS, Bearer access token (in memory) + httpOnly refresh cookie
   ▼
NestJS API  ──>  PostgreSQL (Prisma)
   │             Redis (rate-limit / cache — ready)
   ├─> Email provider (console | smtp)
   ├─> Storage provider (local | s3)        signed, time-limited URLs
   ├─> Payment provider (manual | stripe)
   └─> Video provider (placeholder | zoom | teams | meet)
```

## Authorization: two layers

1. **Global RBAC.** A user holds one or more `Role`s. Each role maps to a set of global
   `Permission`s (`packages/shared/src/permissions.ts`). Guards: `RolesGuard`,
   `PermissionsGuard` with the `@Roles()` / `@RequirePermissions()` decorators.

2. **Case-level access.** `CaseTeamMember` rows define each user's `CaseRole` on a specific
   case. `CaseAccessService` resolves membership and enforces:
   - case visibility (member or administering staff),
   - **tribunal-only deliberations** (appointed tribunal members of *that* case only),
   - per-document `ConfidentialityLevel` with side-scoped `PARTY_PRIVATE`.

Holding a powerful global role (even `SUPER_ADMIN`) never grants deliberation access or
merits-private documents — that is by design and covered by unit tests.

## API modules

Implemented: `auth`, `users`, `arbitrators`, `lawyers`, `parties`, `content`
(news/highlights/publications), `cases` (+ deliberations), `appointments`,
`registry`, `documents`, `messages`, `audit`, `health`, `fees` (+ deposits),
`payments`, `awards`, `hearings`, and the procedural-environment modules:

- `rules` — versioned rules + the operational engine (`docs/RULES_ENGINE.md`)
- `service` — electronic service of documents, Ch2 (`docs/ELECTRONIC_SERVICE_PROTOCOL.md`)
- `deadlines` — deadline engine, Ch6 (`docs/DEADLINE_CALCULATION.md`)
- `filings` — pleadings (Ch10) + document production (Ch12)
- `evidence` — witnesses (Ch13), experts (Ch14), evidence objections
- `defaults` — default / non-participation proceedings (Ch17)
- `interim` — interim & emergency measures (Ch16)
- `casetracks` — expedited (Ch23) + multi-party / consolidation / joinder (Ch24)
- `dashboards` — registrar / arbitrator / finance aggregation endpoints

Cross-cutting: `prisma`, `authz`, `providers` (email / storage / payment / video).

## Data model

See `apps/api/prisma/schema.prisma` — 100+ models, all UUID keys,
`createdAt`/`updatedAt`, `deletedAt` where retention matters. Highlights:

- Identity: `User`, `UserProfile`, `IndividualProfile`, `Company`, `CompanyMember`,
  `LawyerProfile`, `ArbitratorProfile` (+ expertise/language/availability/reference).
- Case spine: `Case`, `CaseParty`, `PartyRepresentative`, `CaseTeamMember`,
  `ArbitrationAgreement`, `Claim`, `ReliefRequest`, `CaseStatusHistory`.
- Tribunal: `Tribunal`, `TribunalMember`, `AppointmentInvitation`, `ConflictDisclosure`,
  `ArbitratorChallenge`, `DeliberationNote` (tribunal-only).
- Documents: `Document`, `DocumentVersion`, `DocumentAccess`, `DocumentActivity`.
- Procedure: `ProceduralOrder`, `Deadline`, `Hearing`, `HearingRoom`, `HearingParticipant`.
- Finance: `FeeEstimate`, `Invoice`, `Payment`, `PaymentAllocation`.
- Awards: `Award`, `AwardDelivery`, `CorrectionRequest`.
- Rules engine: `RuleSet`/`RuleSetVersion`/`RuleChapter`/`Rule`, `RuleTrigger`/`RuleAction`,
  `Rule*Requirement`, `CaseRuleSet`/`CaseRuleAcceptance`/`CaseProceduralEvent`,
  `CaseRuleExecution`/`CaseRuleOverride`/`CaseRuleException`, `RuleAuditLog`.
- Service (Ch2): `FormalNotice`, `NoticeRecipient`, `NoticeDocument`,
  `NoticeDeliveryAttempt`, `NoticeAccessEvent`, `NoticeAcknowledgement`,
  `NoticeFailure`, `SubstituteServiceOrder`, `ServiceCertificate`.
- Deadlines (Ch6): `Deadline`, `DeadlineExtension`, `DeadlineReminder`,
  `HolidayCalendar`, `Holiday`.
- Filings/production (Ch10/12): `Filing`, `FilingReceipt`, `FilingCorrection`,
  `ProductionRequest`, join tables.
- Evidence (Ch13/14): `Witness`, `WitnessStatement`, `Expert`, `ExpertReport`,
  `EvidenceObjection`.
- Default/interim/tracks: `DefaultProceeding`(+notice/review/report/decision),
  `InterimMeasure`(+events), `ExpeditedTrack`(+consents), `PartyJoinderRequest`.
- Finance (Ch18): `FeeSchedule*`, `FeeEstimate`, `DepositRequest`/`DepositAllocation`/
  `DepositPayment`, `Invoice`, `Payment`, `Refund`, `PaymentDefault`, `FinancialLedgerEntry`.
- Content/ops: `NewsArticle`, `CourtHighlight`, `Publication`, `AuditLog`, `SupportTicket`,
  `ComplianceCheck`, `IdentityVerification`, `SystemSetting`, `Session`, `LoginEvent`,
  `EmailToken`.

## Frontend structure

```
src/
├─ i18n/            en.json, ar.json, RTL handling
├─ lib/api.ts       axios client + refresh-token interceptor
├─ auth/            AuthContext, ProtectedRoute
├─ components/      layout (Header/Footer/PublicLayout), PageHeader, LanguageSwitcher
├─ pages/           Home, ArbitratorDirectory, FeeCalculator, FileACase, content, static, app/*
└─ styles/          tokens.css (design system), components.css, layout.css, home.css, pages.css
```

State: TanStack Query for server state; React Context for the authenticated session; React
Hook Form + Zod for forms.

## Environments

`.env` drives everything. `NODE_ENV` switches secure cookie flags, Prisma logging, and the
production Docker target. No secrets are committed; `.env.example` documents every variable.

## Further reading

See the [documentation index](README.md). Before any production launch, every
item in the [Legal Review Checklist](LEGAL_REVIEW_CHECKLIST.md) — the *Matters
Requiring External Legal Review* — must be cleared by qualified counsel.

Remaining engineering follow-ups: full EN/AR bilingual sweep of older pages and
notification/email templates; the end-to-end (20-step) integration test; and
optional depth on awards/corrections (Ch20/21), fee finishing
(receipt/credit/cost-decision) and online-hearing room tooling (Ch15).
