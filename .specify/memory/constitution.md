# Componode Constitution

## Core Principles

### I. Single-Organization, Self-Hosted

Componode is a self-hosted, single-organization tool. One deployment = one
org/team. No multi-tenancy, no `Organization`/tenant layer, no
tenant-isolation-in-every-query. A hosted SaaS offering is a future open-core
possibility, not v1. Any spec that introduces tenant-scoping, per-tenant data
isolation, or multi-org partitioning violates this principle.

- **Forbids**: `Organization` entity, tenant columns on any table, per-tenant
  rate limits, per-tenant auth, "switch org" UI.
- **Permits**: RBAC (roles are org-global), OIDC (one IdP per deployment),
  multiple importer configs (one deployer's configs, not per-tenant).

### II. Importer-First

The headline value of Componode is importing assets from external sources
(GitHub, AWS, Azure, Kubernetes, web/API/MCP). Importers are pull-only
`AsyncGenerator<DiscoveredAsset>` — they yield normalized assets and never
touch the database. The core owns upsert, dedup, reconciliation, run history,
and lifecycle. Importers depend only on `packages/core`; they MUST NOT import
from `packages/backend` or each other. Any spec that has an importer write to
the DB, depend on backend internals, or push to external systems violates this
principle.

- **Forbids**: Importers writing SQL, importing `@componode/backend`, calling
  DB services, pushing to external APIs (webhooks, writes), depending on other
  importers.
- **Permits**: Importers reading from external APIs (pull), yielding
  `DiscoveredAsset` records, using `core`'s `Logger`/`Tracer`/
  `validateDiscoveredAsset`, declaring config schemas, the core resolving
  secrets and passing them to importers.

### III. Two-Level Taxonomy

Components are classified by a controlled `category` enum (25 values, including
`ACCOUNT` for provider-level billing/administrative containers) + a
controlled `provider` enum (with `OTHER` escape hatch) + a free-form
`resourceType` string carrying the provider-native type. A flat single-enum
classification is prohibited. New categories or providers require updating the
taxonomy research, the enum constants in `packages/core`, and the DB CHECK
constraints — not just adding a value. The `CONTAINER`/
`CONTAINER_ORCHESTRATION` split is intentional (workload vs. scope) and must
not be conflated.

- **Forbids**: Flat single-enum classification, adding categories/providers
  without the three-way update (research + `core` + migration), conflating
  `CONTAINER`/`CONTAINER_ORCHESTRATION`, removing the `OTHER` escape hatch on
  `provider`.
- **Permits**: Adding categories/providers via the documented process (research
  update → `core` constant → migration altering CHECK constraint), importers
  using `OTHER` for providers not yet in the enum, free-form `resourceType`
  values per importer.

### IV. Environment-as-Instance

When a single source asset has multiple environment-specific deployments (e.g.
one API Gateway with dev/staging/prod Stages), it is modeled as ONE `Component`
with multiple `ComponentInstance` records — never as an `environment` field on
`Component`. When multiple distinct source assets (e.g. three EC2 instances in
three accounts) are *considered* the same logical component by a human, they
are modeled as separate `Component` rows grouped under a `ComponentGroup` (a
first-class entity with its own name, slug, description, and owner).
`Component.lifecycle` (`ACTIVE`/`RETIRED`) is the logical lifecycle;
`ComponentInstance.status` (`RUNNING`/`STOPPED`/`ERROR`/`GONE`) is the
operational state. These must never be conflated. Any spec that adds an
`environment` field on `Component`, duplicates a component per environment
within a single source asset, or merges lifecycle and operational state
violates this principle.

- **Forbids**: `environment` column on `components`, duplicating components per
  env within a single source asset, conflating `lifecycle` and `status`,
  expanding the two-state lifecycle into a richer state machine without a spec
  decision.
- **Permits**: Multiple `ComponentInstance` rows per `Component`, env-specific
  `url`/`region`/`version`/`status` on instances, the `OTHER` environment for
  importers that can't determine env, default queries excluding `RETIRED`
  components and `GONE` instances, `ComponentGroup` for human-declared
  equivalence across distinct source assets.

### V. Factual vs. Meaning Layer

Importers populate the factual layer (components, instances, environments,
operational state) — what *exists*. Humans curate the meaning layer (digital
products, composition, consumption, ownership, platform promotion) — what it
*means*. The importer contract does not include product-hierarchy edges;
`DiscoveredAsset.relationships[]` is not part of the v1 contract. Any spec
that has importers declaring `COMPOSES`/`CONSUMES_FROM`/`OWNS` edges, or that
removes human curation from the product hierarchy, violates this principle.
Importer-declared candidate edges are a v2 feature (staged as candidates,
human-confirmed).

- **Forbids**: Importers yielding `COMPOSES`/`CONSUMES_FROM`/`OWNS`/
  `BELONGS_TO` edges, specs that auto-derive product hierarchy from importer
  data, removing the human authoring step from the hierarchy UI.
- **Permits**: Importers yielding `DEPENDS_ON`/`SOURCES_FROM`/`EXPOSES`
  component-to-component edges (reserved for v2 per ADR-019 and ADR-057, but the
  principle doesn't forbid the *concept* — it forbids importer-declared
  *product* edges in v1), humans authoring all product-level edges, the Platform
  Product
  workflow (ADR-017) as a human-guided action.

### VI. Test-First (NON-NEGOTIABLE)

Tests are written before implementation. The cycle is: write a failing test →
user approves the test → confirm it fails → implement until it passes →
refactor. The importer harness (`validateDiscoveredAsset` in `packages/core`)
is the enforceable contract — an importer that yields a malformed
`DiscoveredAsset` fails its tests and is rejected at runtime. Integration
tests (testcontainers Postgres) cover the core
upsert/dedup/reconciliation/edge-rewrite/hierarchy path. Any spec that ships
code without tests, or that bypasses the importer harness, violates this
principle.

- **Forbids**: Shipping implementation without tests, bypassing
  `validateDiscoveredAsset` in importer packages, skipping the harness in
  importer unit tests, merging PRs without integration tests for core-path
  changes.
- **Permits**: Unit tests for pure logic, the shared harness for importer
  contract validation, integration tests with testcontainers for DB-touching
  code, deferring E2E tests to post-v1 (per ADR-029).

### VII. Observability from Day One

Componode is instrumented for observability before features are built on top of
it. Pino structured logging (every request, importer run, auth event),
Prometheus metrics (`/metrics` endpoint with importer/HTTP/DB/auth metrics),
and OpenTelemetry tracing (importer runs → DB query spans) are present in the
foundation, not retrofitted. Importers receive a `Logger` and optional `Tracer`
via their run context; they do not import observability libraries directly.
Any spec that adds a runtime code path without structured logging, or that
defers instrumentation to "after the feature works," violates this principle.

- **Forbids**: `console.log` in production code paths, deferring
  logging/metrics/tracing to a later phase, importers importing `pino` or
  `@opentelemetry/api` directly (they use the `core` interfaces per ADR-067/
  ADR-068), uninstrumented importer runs.
- **Permits**: The abstracted `Logger`/`Tracer` interfaces in `core`, the
  `/metrics` endpoint being unauthenticated but network-policy-restricted, the
  run-level span as the baseline (importer child spans are opt-in).

## Additional Constraints

### Technology Stack (binding)

| Layer | Technology |
|---|---|
| Backend API | TypeScript 5, Fastify, Kysely (query builder) |
| Frontend | React 18, Vite, TanStack Query, React Router, Tailwind CSS, shadcn/ui |
| Database | PostgreSQL (CHECK constraints from `core` constants; no native ENUMs) |
| Migrations | Kysely built-in migration system (TS, schema-builder) |
| Monorepo | pnpm workspaces + Turborepo |
| Importer framework | In-tree packages, pull-only `AsyncGenerator<DiscoveredAsset>` |
| Auth | Built-in local (Argon2id via `@node-rs/argon2`, server-side sessions) + optional OIDC |
| Observability | Pino (logging) + Prometheus (metrics) + OpenTelemetry (tracing) |
| Deployment | Docker Compose (one container: backend serves frontend static) |
| CI/CD | GitHub Actions + changesets |
| License | Apache 2.0 |
| Identifiers | UUID v7 (native Postgres `uuid`); `slug` for human-readable refs |

### Spec-Driven Development Workflow

This project uses **spec-kit v0.12.11** for structured feature development.
The workflow is command-driven via spec-kit skills.

1. **`/speckit-constitution`** — Establish project principles (run once, first).
2. **`/speckit-specify`** — Create a feature branch and write `spec.md`.
3. **`/speckit-clarify`** (optional) — Resolve ambiguity via up to 5 questions.
4. **`/speckit-plan`** — Produce `plan.md`, `research.md`, `data-model.md`,
   `contracts/`, `quickstart.md`.
5. **`/speckit-tasks`** — Generate `tasks.md` organized by user story.
6. **`/speckit-implement`** — Execute tasks phase-by-phase.
7. **`/speckit-checklist`** — Generate requirements-quality checklists.
8. **`/speckit-analyze`** — Read-only cross-artifact consistency check.
9. **`/speckit-converge`** — Assess codebase vs spec, append remaining work.

### v1 Feature Breakdown

v1 is split into spec-kit features with an explicit dependency graph. The
authoritative list is the `specs/` directory; this section is amended when that
directory evolves:

1. **`001-foundation`** — `packages/core` contracts + DB schema + migrations +
   backend skeleton (Fastify, Kysely, auth middleware, error handling, session
   storage, RBAC enforcement, bootstrap admin, local auth, OIDC). Milestone:
   "deploy Componode, log in, see an empty dashboard."
2. **`002-importer-framework`** — run service, scheduler, registry,
   reconciliation, cancellation, observability for runs. Milestone: "configure
   an importer and run it."
3. **`003-component-catalog`** — component/instance services + UI (listing,
   filtering, grouping via `ComponentGroup`), the 7 v1 importers. Milestone:
   "dashboard shows real components."
4. **`004-ux-shell`** — sidebar shell, state matrix, dark-mode theming,
   health-and-attention dashboard, Ctrl+K global search. Milestone: "navigate
   and theme the dashboard."
5. **`005-product-hierarchy`** — products, edges, ownership, Platform Product
   workflow, hierarchy UI. Milestone: "model my products."
6. **`006-audit-settings`** — audit tables, activity feed, history, admin
   settings. Milestone: "observe changes and configure the system."
7. **`007-deployment-cicd-docs`** — Docker Compose packaging, CI/CD
   changesets, and generated docs. Milestone: "install, release, and document
   Componode."

Post-v1 work — Kubernetes/Helm packaging, runtime-loaded importer plugins,
E2E tests, RFC 7807 error wrapping, range/OR filters, invite-based
registration, per-env blast-radius traversal, and additional cloud providers
— will be tracked in the v1.1 Roadmap below.

Dependencies: 001 → 002 → 003 → 004 → 005 → 006 → 007.

## Governance

The Constitution supersedes all other practices. Amendments require
documentation, approval, and a migration plan. All PRs/reviews must verify
compliance with the seven principles. Complexity must be justified against the
principles (especially II, V, and VI). Use `researches/architecture-decisions.md`
(the ADR index) and `researches/adrs/` (individual ADR files) for runtime
development guidance and ADR history.

### Amendments

- **v1.0.1** (2026-09-08): v1 feature breakdown aligned with the `specs/`
  directory and `README.md`; `004-ux-shell` and `006-audit-settings`
  recognized, deployment/docs deferred to a future feature.
- **v1.0.2** (2026-09-08): `007-deployment-cicd-docs` added as the final v1
  feature; "Generated docs site" removed from the v1.1 roadmap because it is
  now part of `007`.
- **v1.0.3** (2026-09-09): `007-deployment-cicd-docs` marked complete; v1
  feature set is implemented and validated.

### v1.1 Roadmap (deferred from v1, queued for the next cycle)

- RFC 7807 wrapping for error responses (ADR-071).
- Range/OR filters on list endpoints (ADR-081).
- Invite-based registration (ADR-075).
- Runtime-loaded importer plugins (ADR-012).
- E2E tests (ADR-029).
- Per-env blast-radius traversal (ADR-015, Phase 4+).
- Kubernetes/Helm packaging (ADR-028, community-contributed).
- Remaining providers (GitLab, Bitbucket, Azure DevOps, Alibaba Cloud,
  Cloudflare, OpenShift, Docker/Podman) — contributor-welcome issues.
- Importer-declared candidate product edges (v2: staged, human-confirmed).

**Version**: 1.0.4 | **Ratified**: 2026-08-16 | **Last Amended**: 2026-09-16
