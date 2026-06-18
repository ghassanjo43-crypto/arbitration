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

Implemented now: `auth`, `arbitrators`, `content` (news/highlights/publications),
`cases` (+ deliberations), `fees`, `audit`, `health`, plus cross-cutting `prisma`, `authz`,
`providers`.

Planned (schema + authz already in place): `users/profiles`, `companies`, `lawyers`,
`parties`, `representatives`, `tribunal`, `appointments`, `conflicts`, `challenges`,
`documents`, `messages`, `notifications`, `deadlines`, `hearings`, `payments`, `awards`,
`administration`, `compliance`, `support`, `settings`.

## Data model

See `apps/api/prisma/schema.prisma` — ~60 models, all UUID keys, `createdAt`/`updatedAt`,
`deletedAt` where retention matters. Highlights:

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

## Roadmap to the remaining phases

Phases 3–6 add the full 9-step filing wizard, tribunal appointment workflow, document
repository with watermarking/bundles, secure messaging with ex-parte guards, procedural
calendar, hearing module, payment flows, award lifecycle, content CMS admin, the role-specific
dashboards (client/lawyer/arbitrator/registrar/council), security hardening, and the full
test matrix described in `docs/` and the specification.
