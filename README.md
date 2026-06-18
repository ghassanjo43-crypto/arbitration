# Global Ad Hoc Arbitration Panel

A secure online platform for administering **ad hoc** international arbitration proceedings.
The operating company provides technology, case administration, secure storage, online
hearings, and fee administration. **The tribunal alone decides the merits** — the platform
never adjudicates and never guarantees worldwide enforceability of awards.

> Awards are intended to be final and binding and may be recognised and enforced subject to
> applicable arbitration laws, international conventions, public policy, due process, and the
> law of the enforcement jurisdiction.

## Monorepo layout

```
arbitration/
├─ apps/
│  ├─ api/            NestJS + Prisma REST API (TypeScript)
│  └─ web/            React + Vite + TypeScript SPA (EN/AR, full RTL)
├─ packages/
│  └─ shared/         Shared domain enums, permissions, DTOs, legal text
├─ docs/              Architecture, security, role–permission matrix, workflow
├─ docker-compose.yml Postgres + Redis + API (development)
└─ .env.example       Environment template (never commit a real .env)
```

## Technology

| Layer        | Stack |
|--------------|-------|
| Frontend     | React 18, TypeScript, Vite, React Router, TanStack Query, React Hook Form, Zod, i18next |
| Backend      | NestJS 10, TypeScript, REST, Prisma ORM, PostgreSQL, Redis-ready, JWT + refresh rotation |
| Auth         | Argon2id hashing + pepper, email verification, password reset, account lockout, MFA-ready |
| Infra        | Docker, Docker Compose, Swagger/OpenAPI, local-storage abstraction (S3-ready) |
| Integrations | Email, payment, file storage, and video-hearing **provider abstractions** with dev adapters |

## Prerequisites

- Node.js ≥ 20 (tested on 22/24)
- Docker Desktop (for Postgres + Redis), or a local PostgreSQL 16 + Redis 7
- npm 10+

## Quick start (local)

```bash
# 1. Install workspace dependencies
npm install

# 2. Create your environment file
cp .env.example .env          # then edit secrets

# 3. Start infrastructure (Postgres + Redis)
docker compose up -d postgres redis

# 4. Build shared package, generate Prisma client, migrate, seed
npm run build -w @gaap/shared
npm run db:migrate -w @gaap/api      # creates the schema
npm run db:seed   -w @gaap/api       # loads clearly-fake demo data

# 5. Run both apps
npm run dev
```

- Web: http://localhost:5173
- API: http://localhost:4000/api
- API docs (Swagger): http://localhost:4000/api/docs

### Run everything in Docker

```bash
cp .env.example .env
docker compose up -d            # postgres + redis + api
# then run the web app locally (npm run dev -w @gaap/web) or add a web service
```

### Run WITHOUT Docker (embedded PostgreSQL)

If Docker isn't installed, the API ships a self-contained PostgreSQL 18 (via the
`embedded-postgres` package — real PG binaries, no system install, no admin). It
listens on **5433** so it won't clash with any existing :5432 server.

```bash
# .env already points DATABASE_URL at 127.0.0.1:5433 for this mode
npm run db:embedded -w @gaap/api        # keep running (own terminal) — data in apps/api/.pgdata

# In a second terminal, with the same DB URL + pepper the API uses:
cd apps/api
export DATABASE_URL=$(grep '^DATABASE_URL=' ../../.env | cut -d= -f2-)
export PASSWORD_PEPPER=$(grep '^PASSWORD_PEPPER=' ../../.env | cut -d= -f2-)
npx prisma migrate dev --name init      # create + apply schema
npm run db:seed                          # clearly-fake demo data
```

> The `PASSWORD_PEPPER` must match the value the API runs with, or seeded
> passwords won't verify at login. Exporting it from the root `.env` (as above)
> guarantees they match.

## Seeded accounts (development only)

Password for all: `Password!2026`

| Role         | Email |
|--------------|-------|
| Super Admin  | superadmin@arbitration.example |
| Registrar    | registrar@arbitration.example |
| Council      | council@arbitration.example |
| Admin        | admin@arbitration.example |
| Lawyer       | lawyer1@firm.example |
| Client       | client1@example.example |
| Arbitrator   | arbitrator4@panel.example *(appointed to case GAAP-2026-000002)* |

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Run API + web concurrently |
| `npm run build` | Build shared, API, and web |
| `npm run typecheck` | Type-check all workspaces |
| `npm run lint` | Lint API + web |
| `npm test` | Run API (Jest) + web (Vitest) tests |
| `npm run db:migrate -w @gaap/api` | Apply Prisma migrations |
| `npm run db:seed -w @gaap/api` | Seed demo data |
| `npm run db:reset -w @gaap/api` | Drop, re-migrate, re-seed |

## Security & confidentiality model (summary)

- **Global roles** grant institution-wide capabilities (see `packages/shared/src/permissions.ts`).
- **Case-level membership** (`CaseTeamMember`) decides who can touch a specific case.
- **Tribunal deliberations** are readable *only* by appointed tribunal members of that case —
  never by parties, registrars, administrators, council, or super-admins. Enforced in
  `apps/api/src/authz/case-access.service.ts` and locked down by unit tests.
- **Documents** carry a `ConfidentialityLevel`; the opposing party cannot read another side's
  `PARTY_PRIVATE` material; confidential files are served only via signed, time-limited URLs.
- **Audit log** is append-only (no update/delete path in the API/UI).

See [`docs/SECURITY.md`](docs/SECURITY.md) and [`docs/ROLE_PERMISSION_MATRIX.md`](docs/ROLE_PERMISSION_MATRIX.md).

## Project phases

This repository is being built in phases (see the original specification):

- **Phase 1 — Foundation** ✅ monorepo, shared types, Prisma schema, NestJS bootstrap, Docker, design system, env examples.
- **Phase 2 — Auth & public site** ✅ auth (JWT + refresh), RBAC + case-based authz, registration, bilingual public website, design system, fee calculator, arbitrator directory.
- **Phase 3 — Complete (backend):** ✅ tribunal-appointment workflow (invite → conflict disclosure → accept → constitute; acceptance is what unlocks deliberation access), ✅ registrar case-administration queue + guarded stage transitions, ✅ party management + representatives + legal-team membership, ✅ lawyer profile + lawyer dashboard, ✅ arbitrator public profile pages.
- **Phase 4 — Complete (backend):** ✅ document repository (confidentiality-filtered listing, SHA-256 hashing, access-checked download, activity log), ✅ secure case messaging with **ex-parte guard** (a party's substantive message reaches all parties; `ADMIN_PRIVATE` is registry-only), ✅ procedural calendar (deadlines + personal aggregation), ✅ hearings with the video-provider abstraction (auto-provisions tribunal/party/witness/breakout rooms), ✅ fees & payments (invoices, allocations, "one party may pay another's share", balances). 52 API routes; all guarded and verified live.
- **Phase 3–4 frontend — Complete:** ✅ tabbed **case workspace** (Overview · Documents · Messages · Calendar · Finance · Deliberations) with real upload/download, messaging, deadline/hearing scheduling, and finance actions gated by permission; ✅ **role-aware dashboard** (registry queue, arbitrator appointment invitations with conflict-disclosure + accept, lawyer clients, personal calendar). The Deliberations tab appears only for appointed tribunal members.
- **Phase 5 — Complete (backend + frontend):** ✅ **awards lifecycle** — draft (tribunal-only) → sign → issue (auto-delivers to every party + notifications, advances the case) → party-requested correction/interpretation/additional award; draft awards are hidden from parties; careful enforcement wording attached. ✅ **content CMS** — guarded create/update/publish/archive for news, court highlights, and publications, feeding the public site. Awards tab in the case workspace + an admin "Manage content" page. 63 API routes.
- **Phase 6 — Complete:** ✅ security hardening — global rate-limit guard (`APP_GUARD` ThrottlerGuard) with stricter per-route limits on auth, a global exception filter that adds a correlation id and never leaks 5xx internals, and a hard upload size cap at the transport layer. ✅ **automated test matrix** — 27 unit tests + 11 end-to-end tests (auth, case access, tribunal-deliberation, document access, and the full appointment→conflict→accept→constitute→award critical flow), the e2e suite running against an isolated `e2e_test` Postgres schema.

### Testing

```bash
npm run test     -w @gaap/api      # 27 unit tests (no DB)
npm run test:e2e -w @gaap/api      # 11 e2e tests (needs the embedded/Docker Postgres running)
npm test         -w @gaap/web      # web unit tests
```

The e2e suite resets an isolated `e2e_test` schema, applies migrations, boots the Nest app in-process, and exercises the spec's critical flows and every confidentiality guarantee (including that a super-admin is denied tribunal deliberations and award drafting).

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full module map and roadmap.

## Legal positioning

The interface and content consistently separate **administration** (the company) from
**decision-making** (the tribunal). The platform does not interfere with arbitrator
independence or the merits, and does not claim awards are enforceable in every jurisdiction.
Model clauses and agreements carry a prominent disclaimer to obtain independent legal advice.
