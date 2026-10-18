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

## At a glance

- **Single-organization**: one deployment = one org/team. No multi-tenancy,
  no `Organization`/tenant layer.
- **Importer-first**: the headline value is importing assets — 7 built-in
  importers cover GitHub, AWS, Azure, Kubernetes, Web URL, API URL, and MCP
  Server sources.
- **Curated catalog**: a human-maintained product hierarchy enriched by
  imported facts, with audit history on every change.
- **Self-hosted monolith**: Fastify backend, React frontend, PostgreSQL —
  shipped as a single Docker Compose stack.
- **Not**: a hosted SaaS, multi-tenant, or a security scanner (risk scoring
  and ASPM integration are deferred to a later phase).

## Quick start (self-hosted)

```bash
git clone https://github.com/Componode/componode.git
cd componode
cp .env.example .env
# Edit .env: set COOKIE_SECRET and BOOTSTRAP_ADMIN_PASSWORD
docker compose up -d
```

Open `http://localhost:3000` and log in with your bootstrap admin
credentials. The backend runs migrations on first boot and serves the built
frontend. See [docs/deployment.md](docs/deployment.md) for external
databases, TLS, reverse proxies, and OIDC setup.

## Features

- **Component catalog**: components and instances with a two-level taxonomy
  (25 categories × 10 providers × free-form `resourceType`),
  environment-as-instance modeling, and component groups.
- **Product hierarchy**: typed product→product edges (`COMPOSES`,
  `CONSUMES_FROM`) and product→component dependencies, with DAG cycle
  detection and LOB/Team ownership.
- **Importer framework**: scheduled, pull-only importers with run history,
  reconciliation, and cancellation.
- **Credential store**: AES-256-GCM encrypted integration secrets, managed
  in-app with rotation, revocation, and a write-only API.
- **Auth & security**: local auth (Argon2id, server-side sessions) plus
  optional OIDC SSO, RBAC, CSRF protection, rate limiting, RFC 7807 error
  responses.
- **Observability**: structured Pino logs, Prometheus metrics, and
  OpenTelemetry tracing built in from the start.

## Documentation

| Document | Contents |
|---|---|
| [docs/deployment.md](docs/deployment.md) | Self-hosted install, env vars, TLS, OIDC, smoke test |
| [docs/api.md](docs/api.md) | Human-readable API reference (generated from OpenAPI) |
| [docs/openapi.yaml](docs/openapi.yaml) | Machine-readable OpenAPI 3.0 spec |
| [docs/importer-development.md](docs/importer-development.md) | How to write an importer |
| [docs/architecture.md](docs/architecture.md) | Architecture overview |
| [docs/ux.md](docs/ux.md) | UX/UI conventions and deferred UI work |
| [docs/release.md](docs/release.md) | Changesets and release process |
| [docs/roadmap.md](docs/roadmap.md) | Shipped features and what's next |
| [researches/architecture-decisions.md](researches/architecture-decisions.md) | ADR index — 100+ ratified decisions |

All API routes live under `/api/v1` (except `GET /metrics`). Authenticated
routes require a `componode_session` cookie; state-changing routes also
require the `componode_csrf` cookie plus an `x-csrf-token` header.

## Core concepts

- **Digital Product**: a logical product (application, platform, capability)
  composed of components and other products. Has a type
  (`BUSINESS_CAPABILITY`, `PLATFORM`, `CUSTOMER_FACING`) and lifecycle
  (`ACTIVE`/`RETIRED`).
- **Component**: a building-block asset classified by controlled `category`
  (`COMPUTE`, `DATABASE`, `REPOSITORY`, `ACCOUNT`, …), controlled `provider`
  (`GITHUB`, `AWS`, `AZURE`, `KUBERNETES`, …), and a free-form
  `resourceType` carrying the provider-native type (e.g. `ec2:instance`,
  `apps/v1:Deployment`).
- **Component Instance**: an environment-specific deployment of a component
  (`DEV`, `TEST`, `STAGING`, `DEMO`, `PRODUCTION`, `OTHER`) with its own
  operational status (`RUNNING`/`STOPPED`/`ERROR`/`GONE`).
- **Component Group**: a human-declared equivalence across distinct source
  assets (e.g. three EC2 instances in three accounts considered the same
  logical component).
- **Importer**: a pull-only `AsyncGenerator<DiscoveredAsset>` that reads an
  external source and yields normalized assets. Importers never touch the
  database — the core owns upsert, dedup, reconciliation, and run history.

## Technology stack

| Layer | Technology |
|---|---|
| Backend API | TypeScript 6, Fastify, Kysely (query builder), `pg` |
| Frontend | React 18, Vite, TanStack Query, React Router, Tailwind CSS v4, shadcn/ui |
| Database | PostgreSQL 14+ (CHECK constraints from `core` constants; no native ENUMs) |
| Monorepo | pnpm workspaces + Turborepo |
| Auth | Local (Argon2id via `@node-rs/argon2`, server-side sessions) + optional OIDC |
| Observability | Pino + Prometheus (`prom-client`) + OpenTelemetry (`@opentelemetry/api`) |
| Deployment | Docker Compose (one container: backend serves frontend static) |
| CI/CD | GitHub Actions + changesets |
| License | Apache 2.0 |

## Repository layout

```text
packages/
├── core/                  # Shared contracts, constants, Zod schemas (leaf — zero deps)
├── backend/               # Fastify API, Kysely services, migrations, plugins
├── frontend/              # React/Vite dashboard
└── importer-*/            # 7 pull-only importers: github, aws, azure,
                           # kubernetes, web-url, api-url, mcp-server
docs/                      # Source documentation (see table above)
docs-site/                 # VitePress documentation site
researches/                # Research docs + ADRs (adrs/, architecture-decisions.md)
specs/                     # spec-kit feature specs (001-foundation … 016-bugfix-login-redirect)
.specify/                  # spec-kit config, constitution, workflows
scripts/                   # Deployment and validation scripts
```

## Development

### Prerequisites

- Node.js 24+
- pnpm 9+
- Docker (for PostgreSQL and integration tests)

### Local setup

```bash
git clone https://github.com/Componode/componode.git
cd componode
pnpm install
```

Start a PostgreSQL instance with `pgcrypto` and publish it on localhost (the
bundled Compose Postgres is internal-only, so run a dev container instead):

```bash
docker run -d --name componode-db -p 5432:5432 \
  -e POSTGRES_PASSWORD=postgres \
  -v "$PWD/init-db.sql:/docker-entrypoint-initdb.d/init-db.sql:ro" \
  postgres:16-alpine
```

`init-db.sql` creates the `componode` database and a least-privilege user.
Then set env vars for the backend (`packages/backend/.env`, or export them —
the backend reads `process.env` directly):

```text
DATABASE_URL=postgres://componode:componode_pw@localhost:5432/componode
DATABASE_SSL_MODE=disable
COOKIE_SECRET=<openssl rand -base64 32>
BOOTSTRAP_ADMIN_USERNAME=admin
BOOTSTRAP_ADMIN_PASSWORD=<8+ chars>
```

Start the backend (migrations and bootstrap admin run on first boot) and, in
a second terminal, the frontend:

```bash
pnpm --filter @componode/backend dev
pnpm --filter @componode/frontend dev
```

The frontend runs at `http://localhost:5173` and proxies API requests to
`http://localhost:3000`.

### Commands

```bash
pnpm build             # Build all packages (Turborepo)
pnpm dev               # Start dev servers for all packages
pnpm test              # Run all tests
pnpm test:unit         # Unit tests only
pnpm test:integration  # Integration tests (requires Docker)
pnpm lint              # Lint all packages
pnpm typecheck         # Typecheck all packages
pnpm db:migrate        # Run database migrations
```

### Spec-driven development

Feature work follows the spec-kit workflow (installed version is tracked in
`.specify/integration.json`): each feature gets a
`specs/{NNN-feature-name}/` directory with `spec.md`, `plan.md`, and
`tasks.md`, produced and executed via the `/speckit-*` skills
(`speckit-specify` → `speckit-plan` → `speckit-tasks` → `speckit-implement` →
`speckit-analyze`/`speckit-converge`). Bugfixes use a lighter
`NNN-bugfix-*` variant that still requires a regression test.

The binding rules are `.specify/memory/constitution.md` (7 principles) and
the ADRs indexed in `researches/architecture-decisions.md`. See `AGENTS.md`
for the full contributor rules.

## Architecture principles

Componode is governed by seven constitution principles:

1. **Single-organization, self-hosted** — one deployment = one org.
2. **Importer-first** — importers are pull-only generators that never touch
   the DB; the core owns upsert, dedup, and reconciliation.
3. **Two-level taxonomy** — controlled `category` + controlled `provider` +
   free-form `resourceType`, not a flat enum.
4. **Environment-as-instance** — a component has many `ComponentInstance`
   records across environments, not an `environment` field.
5. **Factual vs. meaning layer** — importers populate what exists; humans
   curate what it means.
6. **Test-first** — failing test before implementation; testcontainers cover
   all DB-touching code.
7. **Observability from day one** — logging, metrics, and tracing are in the
   foundation, not retrofitted.

## Roadmap

Componode v1.0.0 shipped spec-kit features 001–016 (foundation, importer
framework, component catalog, UX shell, product hierarchy, audit, deployment,
plus post-v1 hardening and fixes). What's next lives in
[docs/roadmap.md](docs/roadmap.md).

## License

Apache 2.0
