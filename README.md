# Componode

**Open-source, self-hosted Digital Product Asset Management (DPAM).**

Componode lets you model your **Digital Products** — applications, solutions,
platforms — as compositions of building-block **Components** imported from
repository tools, cloud environments, container orchestrators, and web/API/MCP
endpoints. A digital product can compose other digital products, and products
depend on components.

The canonical architecture is the **Composable Product Model**: Lines of
Business own Business Capability Products that compose shared Platform
Products. Importers pull the factual layer (what exists); humans curate the
meaning layer (what it means).

## What Componode is

- A **single-organization** self-hosted tool. One deployment = one org/team.
  No multi-tenancy.
- An **importer-first** tool: the headline value is importing assets from
  GitHub, AWS, Azure, Kubernetes, Docker, and web/API/MCP endpoints.
- A **catalog** of digital products and their composition hierarchy, curated
  by humans, enriched by importers.
- A **self-hostable** monolith: Fastify backend, React/Vite frontend,
  PostgreSQL database, deployed via Docker Compose.

## What Componode is not

- Not a hosted SaaS (single-org only; a hosted offering is a future open-core
  possibility, not v1).
- Not multi-tenant (no `Organization`/tenant layer).
- Not a security scanner (risk scoring and ASPM integration are deferred to a
  later phase).

## Quick start

Run Componode on your own server with Docker Compose:

```bash
git clone https://github.com/Componode/componode.git
cd componode
cp .env.example .env
# Edit .env and set COOKIE_SECRET and BOOTSTRAP_ADMIN_PASSWORD
docker compose up -d
```

Then open `http://localhost:3000` and log in with your bootstrap admin
credentials. See [docs/deployment.md](docs/deployment.md) for the full guide.

## Current status

The project is in active v1 development. The following capabilities are
implemented and tested:

- **Foundation**: shared `packages/core` contracts, a 24-table PostgreSQL schema
  with Kysely migrations, Fastify backend with local/OIDC auth, RBAC, CSRF,
  rate limiting, security headers, logging, metrics, and tracing; React/Vite
  frontend with auth, dashboard, and shadcn/ui components.
- **Importer framework**: scheduler, registry, import-run reconciliation, and the
  pull-only `AsyncGenerator<DiscoveredAsset>` contract.
- **Component catalog**: components and component groups (CRUD, listing,
  search/filter, pagination), lifecycle/operational-state defaults
  (`RETIRED`/`GONE` exclusion), and quickstart integration.
- **Importers**: GitHub, AWS, Azure, Kubernetes, Web URL, API URL, and MCP Server
  packages, all validating yielded assets through `validateDiscoveredAsset`.
- **Testing**: Vitest unit tests and testcontainer-backed integration tests,
  including catalog API and frontend table performance checks.

## Technology Stack

| Layer | Technology |
|---|---|
| Backend API | TypeScript 5, Fastify, Kysely (query builder), `pg` |
| Frontend | React 18, Vite, TanStack Query, React Router, Tailwind CSS v4, shadcn/ui |
| Database | PostgreSQL 14+ (CHECK constraints from `core` constants; no native ENUMs) |
| Migrations | Kysely built-in migration system |
| Monorepo | pnpm workspaces + Turborepo |
| Importer framework | In-tree packages, pull-only `AsyncGenerator<DiscoveredAsset>` |
| Auth | Built-in local (Argon2id via `@node-rs/argon2`, server-side sessions) + optional OIDC via `openid-client` |
| Observability | Pino (logging) + Prometheus (`prom-client`) + OpenTelemetry (`@opentelemetry/api`) |
| Deployment | Docker Compose (one container: backend serves frontend static) |
| Identifiers | UUID v7 (application-side generation) and URL-safe slugs |
| CI/CD | GitHub Actions + changesets (planned) |
| License | Apache 2.0 |

## Repository Structure

```text
packages/
├── core/                           # Shared contracts (zero runtime deps)
│   ├── src/contracts/              # DiscoveredAsset, Importer, entity types
│   ├── src/constants/              # 24 component categories, 10 providers,
│   │                               # roles, environments, lifecycle, etc.
│   ├── src/schemas/                # Zod validation schemas
│   ├── src/observability/          # Logger and Tracer interfaces
│   └── src/validation/             # validateDiscoveredAsset harness
├── backend/                        # Fastify API + Kysely services
│   ├── src/db/migrations/          # 001_initial_schema, 002_append_only_triggers,
│   │                               # 003_terminal_state_triggers
│   ├── src/plugins/                # helmet, cors, csrf, rate-limit, session,
│   │                               # rbac, logging, metrics, tracing
│   ├── src/routes/                 # auth, users, sessions, settings, health, metrics,
│   │                               # products (hierarchy + edges), org (lobs/teams),
│   │                               # components, groups, importers, dashboard, search
│   ├── src/services/               # auth, user, session, oidc, password-reset,
│   │                               # settings, bootstrap, product, product-edge,
│   │                               # org, audit, search, dashboard
│   └── test/                       # unit and integration (testcontainers) tests
└── frontend/                       # React/Vite dashboard
    ├── src/pages/                  # login, register, dashboard, products (tree),
    │                               # product-detail, lobs, teams, components,
    │                               # component-groups, importers, settings,
    │                               # sessions, users, oidc-callback, not-found
    ├── src/components/ui/          # shadcn/ui components
    ├── src/components/layout/      # auth-guard, nav
    └── src/api/                    # fetch client + TanStack Query hooks
researches/                         # Architecture Decision Records (ADRs)
├── architecture-decisions.md       # ADR index
├── component_taxonomy_research.md  # Taxonomy grounding research
└── adrs/                           # Individual ADR files
specs/                              # spec-kit feature specifications
└── 001-foundation/                 # spec.md, plan.md, tasks.md, contracts/
.specify/                           # spec-kit infrastructure
.devin/                             # Devin skills
```

## Core Concepts

- **Digital Product**: A logical product (application, platform, capability)
  composed of components and other products. Has a type
  (`BUSINESS_CAPABILITY`, `PLATFORM`, `CUSTOMER_FACING`) and lifecycle
  (`ACTIVE`/`RETIRED`).
- **Component**: A building-block asset with a two-level taxonomy:
  - `category`: one of 24 controlled values (`COMPUTE`, `STORAGE`, `DATABASE`,
    `CONTAINER`, `CONTAINER_ORCHESTRATION`, `API_GATEWAY`, `WEB_APP`, etc.)
  - `provider`: one of 10 controlled values (`GITHUB`, `AWS`, `AZURE`,
    `GOOGLE_CLOUD`, `KUBERNETES`, `DOCKER`, `WEB`, `API`, `MCP`, `OTHER`)
  - `resourceType`: free-form string carrying the provider-native type (e.g.
    `ec2:instance`, `apps/v1:Deployment`, `Microsoft.Compute/virtualMachines`)
- **Component Instance**: An environment-specific deployment of a component.
  One component can have instances across `DEV`, `TEST`, `STAGING`, `DEMO`,
  `PRODUCTION`, and `OTHER`.
- **Component Group**: A human-declared equivalence across distinct source
  assets (e.g. three EC2 instances in three accounts considered the same
  logical component).
- **Importer**: A pull-only `AsyncGenerator<DiscoveredAsset>` that reads from
  an external source and yields normalized assets. Importers never touch the
  database — `packages/core` owns upsert, dedup, reconciliation, and run
  history.
- **DiscoveredAsset**: The importer contract — a normalized asset record with
  category, provider, resourceType, name, externalId, environments (with
  url/region/status/version), and a details bag. `relationships[]` is **not**
  part of the v1 contract; importer-declared product edges are a v2 feature.

## API Surface

All routes live under `/api/v1` (except `GET /metrics`). Authenticated routes
require a `componode_session` cookie and the appropriate role; state-changing
routes require a matching `componode_csrf` cookie and `x-csrf-token` header.

The full API is documented in:

- **[`docs/api.md`](docs/api.md)** — human-readable reference (every endpoint,
  request/response shapes, RBAC permissions, error codes).
- **[`docs/openapi.yaml`](docs/openapi.yaml)** — machine-readable OpenAPI 3.0
  specification covering the same surface.

## Architecture Principles

Componode is governed by seven constitution principles recorded in
`.specify/memory/constitution.md`:

1. **Single-Organization, Self-Hosted** — one deployment = one org. No
   multi-tenancy.
2. **Importer-First** — importers are pull-only generators that never touch
   the DB. `packages/core` owns upsert, dedup, and reconciliation.
3. **Two-Level Taxonomy** — components are classified by controlled `category`
   + controlled `provider` + free-form `resourceType`, not a flat single enum.
4. **Environment-as-Instance** — one component has many `ComponentInstance`
   records across environments, not an `environment` field on the component.
5. **Factual vs. Meaning Layer** — importers populate what exists; humans
   curate what it means. Importer-declared product edges are a v2 feature.
6. **Test-First** — tests are written before implementation. Integration tests
   with testcontainers cover all DB-touching code.
7. **Observability from Day One** — structured logging, Prometheus metrics,
   and OpenTelemetry tracing are in the foundation, not retrofitted.

## Quick Start

### Prerequisites

- Node.js 20+
- pnpm 9+
- Docker and Docker Compose (for PostgreSQL)

### Development

```bash
git clone https://github.com/Componode/componode.git
cd componode
pnpm install
cp .env.example .env
```

Edit `.env` — set `BOOTSTRAP_ADMIN_PASSWORD` (must be 8+ chars) and generate a
`COOKIE_SECRET`:

```bash
openssl rand -base64 32
```

Start PostgreSQL:

```bash
docker compose up -d postgres
```

This starts a PostgreSQL 16 container with `init-db.sql`, which creates the
`componode` database and a least-privilege user.

Start the backend (runs migrations and bootstrap on first boot):

```bash
pnpm --filter @componode/backend dev
```

In a separate terminal, start the frontend:

```bash
pnpm --filter @componode/frontend dev
```

The frontend runs at `http://localhost:5173` and proxies API requests to
`http://localhost:3000`. Log in with the bootstrap admin credentials from
`.env` and you will see the empty dashboard.

### Docker Compose (full stack)

```bash
docker compose up -d
```

The app is available at `http://localhost:3000`. The backend serves the built
frontend static assets in this mode. Migrations run automatically on first
boot, and a bootstrap admin is created from the `BOOTSTRAP_ADMIN_*`
environment variables.

## Development

### Commands

```bash
pnpm build          # Build all packages (Turborepo)
pnpm dev            # Start dev servers for all packages
pnpm test           # Run all tests
pnpm test:unit      # Run unit tests only
pnpm test:integration  # Run integration tests (requires Docker)
pnpm lint           # Lint all packages
pnpm typecheck      # Typecheck all packages
pnpm db:migrate     # Run database migrations
```

Per-package commands:

```bash
pnpm --filter @componode/backend test:integration  # Docker required
pnpm --filter @componode/frontend test             # jsdom-based
```

### Spec-Driven Development

This project uses spec-kit v0.12.11 for structured feature development. The
workflow is command-driven via `.devin/skills/speckit-*`:

1. `/speckit-constitution` — establish project principles
2. `/speckit-specify` — create feature branch and write `spec.md`
3. `/speckit-clarify` — resolve ambiguity
4. `/speckit-plan` — produce `plan.md`, `research.md`, `data-model.md`, `contracts/`
5. `/speckit-tasks` — generate `tasks.md`
6. `/speckit-implement` — execute tasks
7. `/speckit-checklist` — generate checklists
8. `/speckit-analyze` — cross-artifact consistency check
9. `/speckit-converge` — assess codebase vs spec

See `.specify/memory/constitution.md` for the full constitution and
`researches/architecture-decisions.md` for the ADR index.

## Roadmap

Development proceeds as sequential spec-kit features (v1 = 001–007;
008–015 are post-v1 fixes and enhancements):

1. **`001-foundation`** ✅ — core contracts, DB schema, backend skeleton,
   auth, RBAC, observability, empty dashboard.
2. **`002-importer-framework`** ✅ — run service, scheduler, registry,
   reconciliation, cancellation, run observability.
3. **`003-component-catalog`** ✅ — component/instance services + UI, the
   7 v1 importers.
4. **`004-ux-shell`** ✅ — sidebar shell, state matrix, dark-mode theming,
   health-and-attention dashboard, Ctrl+K global search.
5. **`005-product-hierarchy`** ✅ — product tree UI, typed edges
   (COMPOSES/CONSUMES_FROM/DEPENDS_ON_COMPONENT), LOB/Team ownership, audit
   records.
6. **`006-audit-settings`** ✅ — audit tables, activity feed, history,
   admin settings.
7. **`007-deployment-cicd-docs`** ✅ — Docker Compose packaging, CI/CD
   changesets, generated docs.
8. **`008-rfc-7807-errors`** ✅ — RFC 7807 Problem Details for all API
   errors, `application/problem+json` responses, backward-compatible
   `code`/`message`/`details`, `invalid-params` for validation, OpenAPI and
   docs updates.
9. **`009-bugfix-spa-csrf`** ✅ — SPA fallback for direct navigation + CSRF
   double-submit protection.
10. **`010-security-hardening`** ✅ — consolidated fixes for all critical,
    high, and medium findings from the 2026-09-10 security assessment:
    verified OIDC login, hashed session tokens, session-revocation ownership,
    proxy trust, importer SSRF guard, secret masking, DB TLS defaults, Node
    24 + PostgreSQL 14+ floor (ADR-106).
11. **`011-github-importer-expansion`** ✅ — GitHub org `ACCOUNT` component,
    billing/usage snapshot with per-repo attribution, mapping-classified branch
    + deployment-environment instances, optional workflows/runners/packages,
    GHES `baseUrl` support, new `ACCOUNT` taxonomy category (ADR-013 amendment).
12. **`012-bugfix-empty-body-content-type`** ✅ — `apiFetch` omits
    `Content-Type` on body-less requests, fixing `400`
    (`FST_ERR_CTP_EMPTY_JSON_BODY`) rejections on trigger/run calls.
13. **`013-credential-store`** ✅ — application-managed credential store for
    integration secrets: AES-256-GCM encrypted credential bundles, managed
    master key with dual-key rotation, write-only API, lifecycle (rotate /
    revoke / delete with dependent protection), importer credential
    resolution + manifest `secrets` declarations, credential testing,
    OIDC client-secret migration, deprecated env/file ref conversion
    (ADR-107).
14. **`014-bugfix-app-shell`** ✅ — pinned app-shell chrome (bounded `h-dvh`
    shell, single `<main>` scroll region), width-aware sidebar default
    (icon rail below `lg`, explicit choice wins), importer-status row
    truncation at 768px.
15. **`015-ui-refresh`** ✅ — emerald brand palette (radius + icon wells),
    faceted multi-value filters with removable pills, mobile nav drawer
    below `md` + `Ctrl+B` toggle (ADR-108), importer run-history stacked
    chart on the dashboard.
16. **Next** — v1.1 (see `.specify/memory/constitution.md` § v1.1
    Roadmap): runtime-loaded importer plugins, invite-based registration,
    E2E tests, per-env blast-radius traversal, Kubernetes/Helm packaging,
    remaining providers, and range filters (multi-value enum filters
    shipped in 015). Deferred UI work includes the product-graph canvas
    and custom importer-form widgets (`docs/ux.md` §11).

Dependencies: 001 → 002 → 003 → 004 → 005 → 006 → 007; later features build on
the hierarchy and org-level entities (`Person`, `Team`, `LineOfBusiness`).

## License

Apache 2.0
