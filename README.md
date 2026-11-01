# Componode

[![CI](https://github.com/Componode/componode/actions/workflows/ci.yml/badge.svg)](https://github.com/Componode/componode/actions/workflows/ci.yml)
[![Docs](https://github.com/Componode/componode/actions/workflows/docs.yml/badge.svg)](https://componode.github.io/componode/)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)

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

> **Documentation site:** <https://componode.github.io/componode/>

### About this project

Componode is a personal learning project. I built it to explore, hands-on,
how applications are developed today with AI coding assistants — the
tooling, the workflows (spec-driven development, ADRs, changesets), and the
architecture decisions that come with a real codebase. The spec-kit
workflow, constitution, and 120+ ADRs are part of the exercise: I'm
learning how structured process shapes AI-assisted work.

I'm not a professional developer, so expect rough edges — and this is
**not a production-grade solution**. If you spot something questionable —
a design choice, a doc, a security decision — that's the point: please
open an issue and tell me. That's how this project (and I) get better.

## At a glance

- **Single-organization**: one deployment = one org/team. No multi-tenancy,
  no `Organization`/tenant layer.
- **Importer-first**: the headline value is importing assets — nine in-tree
  importer packages: five with live discovery (GitHub, Alibaba Cloud,
  Docker, API URL, Web URL) and four scaffolds (AWS, Azure, Kubernetes,
  MCP Server) that exercise the pipeline end-to-end.
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

Open `https://localhost` (the bundled Caddy serves a self-signed
certificate — accept the browser warning) or `http://localhost:3000`, and
log in with your bootstrap admin credentials. The backend runs migrations
on first boot and serves the built frontend.

The [documentation site](https://componode.github.io/componode/) has a
guided [quickstart](https://componode.github.io/componode/quickstart) that
takes you from first login to your first imported asset and curated
product edge in about 15 minutes. For external databases, TLS, reverse
proxies, and OIDC see [docs/deployment.md](docs/deployment.md).

## Features

- **Component catalog**: components and instances with a two-level taxonomy
  (25 categories × 10 providers × free-form `resourceType`),
  environment-as-instance modeling, and component groups.
- **Product hierarchy**: typed product→product edges (`COMPOSES`,
  `CONSUMES_FROM`) and product→component dependencies — including
  component-group targets and bulk wiring — with DAG cycle detection and
  LOB/Team ownership.
- **Catalog curation**: YAML/JSON bootstrap import of existing app
  inventories, staged edge suggestions a human accepts or dismisses, and a
  guided promote-to-platform workflow — the meaning layer without the
  manual grind.
- **Coverage & health**: derived product health from instance status,
  dashboard coverage metrics with worklist filters, product completeness
  chips, and sunset-overdue attention.
- **Importer framework**: scheduled, pull-only importers with run history,
  reconciliation, and cancellation — in-process on the hub or remotely on
  Import Agents in networks the hub can't reach.
- **Credential store**: AES-256-GCM encrypted integration secrets, managed
  in-app with rotation, revocation, and a write-only API.
- **Auth & security**: local auth (Argon2id, server-side sessions) plus
  optional OIDC SSO, RBAC, CSRF protection, rate limiting, RFC 7807 error
  responses.
- **Observability**: structured Pino logs, Prometheus metrics, and
  OpenTelemetry tracing built in from the start.

## Documentation

The full documentation lives on the
[site](https://componode.github.io/componode/) and in [`docs/`](docs/).

| I want to… | Read |
|---|---|
| Try it in ~15 minutes | [docs/quickstart.md](docs/quickstart.md) |
| Deploy for real | [docs/deployment.md](docs/deployment.md) |
| Learn the model | [docs/digital-products.md](docs/digital-products.md) · [docs/vocabulary.md](docs/vocabulary.md) |
| Tour the app | [docs/using-the-catalog.md](docs/using-the-catalog.md) |
| Manage users & secrets | [docs/credentials-and-access.md](docs/credentials-and-access.md) |
| Connect a source | [docs/importers/](docs/importers/index.md) |
| Reach a private network | [docs/import-agents.md](docs/import-agents.md) · [docs/agent-protocol.md](docs/agent-protocol.md) |
| Call the API | [docs/api.md](docs/api.md) · [docs/openapi.yaml](docs/openapi.yaml) |
| Understand the build | [docs/architecture.md](docs/architecture.md) · [docs/contributing.md](docs/contributing.md) |
| Fix something | [docs/troubleshooting.md](docs/troubleshooting.md) |
| See what's next | [docs/roadmap.md](docs/roadmap.md) |

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

> **New to the model?** [docs/digital-products.md](docs/digital-products.md)
> walks through the product types, composition edges, and component
> inventories with plain-English scenarios — internet banking, ERP,
> e-commerce, and CRM — and diagrams for each.

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
├── agent/                 # Import Agent runtime (enrolls, outbound WSS stream)
└── importer-*/            # 9 pull-only importers (5 live, 4 scaffolds)
docs/                      # Source documentation (docs-site renders it to GitHub Pages)
docs-site/                 # VitePress site config + theme
researches/                # Research docs + ADRs (adrs/, architecture-decisions.md)
specs/                     # spec-kit feature specs (001-foundation … )
.specify/                  # spec-kit config, constitution, workflows
scripts/                   # Deployment and validation scripts
```

## Development

See **[docs/contributing.md](docs/contributing.md)** for the full setup:
prerequisites (Node 24, pnpm 9, Docker), the dev database, env vars, dev
servers, quality gates (`pnpm lint && pnpm typecheck && pnpm test &&
pnpm build`), and the spec-kit feature workflow.

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

Current and shipped work is tracked on the
[roadmap](docs/roadmap.md): the DPAM foundation and importer framework are
in place, the practical-curation stream (coverage, suggestions, product
health) shipped with v1.1, and the importer program keeps expanding —
live sources today, scaffold providers next.

## License

Apache 2.0
