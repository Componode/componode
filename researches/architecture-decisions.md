# Componode — Architecture Decisions Record

> **Sessions**: 2026-08-16 grilling sessions (Session 1: ADR-001–032,
> Session 2 Architecture: ADR-033–083, Session 2 Security: ADR-084–102)
> **Status**: Ratified — these decisions are the foundation for Componode v1.
> **How to use**: Each ADR is in its own file under `researches/adrs/`.
> Read the relevant ADRs before starting implementation work. Changes to any
> decision require a new grilling session or an explicit superseding ADR.

## Index

### Identity & Direction

| ADR | Title |
|---|---|
| [ADR-001](./adrs/ADR-001-deployment-model-self-hosted-single-organization-tool.md) | Deployment model: self-hosted single-organization tool |
| [ADR-002](./adrs/ADR-002-license-apache-2-0.md) | License: Apache 2.0 |
| [ADR-003](./adrs/ADR-003-project-name-componode.md) | Project name: Componode |
| [ADR-004](./adrs/ADR-004-greenfield-in-new-repo.md) | Greenfield in new repo |
| [ADR-005](./adrs/ADR-005-existing-assets-restructure-with-archive.md) | Existing assets: restructure with archive |

### Architecture & Data

| ADR | Title |
|---|---|
| [ADR-006](./adrs/ADR-006-database-postgresql.md) | Database: PostgreSQL |
| [ADR-007](./adrs/ADR-007-backend-framework-fastify.md) | Backend framework: Fastify (kept) |
| [ADR-008](./adrs/ADR-008-data-layer-kysely.md) | Data layer: Kysely |
| [ADR-009](./adrs/ADR-009-migrations-kysely-built-in.md) | Migrations: Kysely built-in |
| [ADR-010](./adrs/ADR-010-frontend-react-vite-tanstack-query-tailwind-shadcn-ui.md) | Frontend: React + Vite + TanStack Query + Tailwind (kept) + shadcn/ui |
| [ADR-011](./adrs/ADR-011-build-orchestration-pnpm-workspaces-turborepo.md) | Build orchestration: pnpm workspaces + Turborepo |
| [ADR-012](./adrs/ADR-012-repo-structure-pnpm-monorepo-with-workspaces.md) | Repo structure: pnpm monorepo with workspaces |

### Domain Model

| ADR | Title |
|---|---|
| [ADR-013](./adrs/ADR-013-component-taxonomy-24-categories-provider-resourcetype.md) | Component taxonomy: 25 categories + provider + resourceType |
| [ADR-014](./adrs/ADR-014-environment-separate-componentinstance-entity.md) | Environment: separate ComponentInstance entity |
| [ADR-015](./adrs/ADR-015-product-component-dependency-logical-env-agnostic.md) | Product→Component dependency: logical, env-agnostic |
| [ADR-016](./adrs/ADR-016-component-component-relationships.md) | Component→Component relationships |
| [ADR-017](./adrs/ADR-017-platform-product-workflow-full-guided-workflow-in-v1.md) | Platform Product workflow: full guided workflow in v1 |
| [ADR-018](./adrs/ADR-018-product-types-enum-with-enforced-composition-rules.md) | Product types: enum with enforced composition rules |
| [ADR-019](./adrs/ADR-019-hierarchy-authoring-manual-for-v1.md) | Hierarchy authoring: manual for v1 |
| [ADR-020](./adrs/ADR-020-ownership-lineofbusiness-team-person.md) | Ownership: LineOfBusiness + Team + Person |
| [ADR-021](./adrs/ADR-021-risk-deferred-entirely-from-v1.md) | Risk: deferred entirely from v1 |

### Importer Framework

| ADR | Title |
|---|---|
| [ADR-022](./adrs/ADR-022-importer-execution-scheduled-on-demand.md) | Importer execution: scheduled + on-demand |
| [ADR-023](./adrs/ADR-023-importer-credentials-external-secret-stores.md) | Importer credentials: external secret stores |
| [ADR-024](./adrs/ADR-024-importer-registry-in-tree-code-registered.md) | Importer registry: in-tree, code-registered |
| [ADR-025](./adrs/ADR-025-importer-interface-pull-only-asyncgenerator.md) | Importer interface: pull-only AsyncGenerator (superseded by ADR-056/057) |
| [ADR-026](./adrs/ADR-026-v1-importer-scope-7-importers.md) | v1 importer scope: 7 importers |

### Auth & Security

| ADR | Title |
|---|---|
| [ADR-027](./adrs/ADR-027-authentication-built-in-local-optional-oidc.md) | Authentication: built-in local + optional OIDC |

### Engineering & Ops

| ADR | Title |
|---|---|
| [ADR-028](./adrs/ADR-028-deployment-docker-compose-only-for-v1.md) | Deployment: Docker Compose only for v1 |
| [ADR-029](./adrs/ADR-029-testing-shared-importer-harness-integration-tests.md) | Testing: shared importer harness + integration tests |
| [ADR-030](./adrs/ADR-030-documentation-readme-docs-folder-markdown-only.md) | Documentation: README + docs/ folder, Markdown only |
| [ADR-031](./adrs/ADR-031-ci-cd-github-actions-changesets.md) | CI/CD: GitHub Actions + changesets |
| [ADR-032](./adrs/ADR-032-observability-full.md) | Observability: full (Pino + Prometheus + OpenTelemetry) |

### Session 2 — Architecture (Q1–Q51)

| ADR | Title |
|---|---|
| [ADR-033](./adrs/ADR-033-person-useraccount-unification.md) | Person/UserAccount unification |
| [ADR-034](./adrs/ADR-034-componentinstance-upsert-key.md) | ComponentInstance upsert key |
| [ADR-035](./adrs/ADR-035-instance-reconciliation-orphan-missing-instances.md) | Instance reconciliation: orphan missing instances |
| [ADR-036](./adrs/ADR-036-two-phase-reconciliation-scope.md) | Two-phase reconciliation scope |
| [ADR-037](./adrs/ADR-037-importer-run-commit-strategy.md) | Importer run commit strategy |
| [ADR-038](./adrs/ADR-038-importer-run-resume-strategy.md) | Importer run resume strategy |
| [ADR-039](./adrs/ADR-039-importer-trigger-auth-boundary.md) | Importer trigger auth boundary |
| [ADR-040](./adrs/ADR-040-importer-config-storage.md) | Importer config storage |
| [ADR-041](./adrs/ADR-041-importer-registry-discovery.md) | Importer registry discovery |
| [ADR-042](./adrs/ADR-042-frontend-importer-schema-delivery.md) | Frontend importer schema delivery |
| [ADR-043](./adrs/ADR-043-session-storage.md) | Session storage |
| [ADR-044](./adrs/ADR-044-password-hashing.md) | Password hashing |
| [ADR-045](./adrs/ADR-045-entity-identifier-format.md) | Entity identifier format |
| [ADR-046](./adrs/ADR-046-slug-generation-and-uniqueness.md) | Slug generation and uniqueness |
| [ADR-047](./adrs/ADR-047-deletion-model.md) | Deletion model |
| [ADR-048](./adrs/ADR-048-graph-relationship-persistence.md) | Graph relationship persistence |
| [ADR-049](./adrs/ADR-049-composes-hierarchy-dag-with-unlimited-depth.md) | COMPOSES hierarchy: DAG with unlimited depth |
| [ADR-050](./adrs/ADR-050-composes-cycle-detection-implementation.md) | COMPOSES cycle detection implementation |
| [ADR-051](./adrs/ADR-051-hierarchy-traversal-merged-cte-with-edge-types.md) | Hierarchy traversal: merged CTE with edge types |
| [ADR-052](./adrs/ADR-052-audit-model-three-tier.md) | Audit model: three-tier |
| [ADR-053](./adrs/ADR-053-api-authorization-layered-default-deny.md) | API authorization: layered default-deny |
| [ADR-054](./adrs/ADR-054-rbac-permission-matrix.md) | RBAC permission matrix |
| [ADR-055](./adrs/ADR-055-importer-secret-resolution.md) | Importer secret resolution |
| [ADR-056](./adrs/ADR-056-importer-interface-signature.md) | Importer interface signature (supersedes ADR-025) |
| [ADR-057](./adrs/ADR-057-discoveredasset-final-shape.md) | DiscoveredAsset final shape (supersedes ADR-025) |
| [ADR-058](./adrs/ADR-058-importer-cancellation.md) | Importer cancellation |
| [ADR-059](./adrs/ADR-059-importer-run-state-machine.md) | Importer run state machine |
| [ADR-060](./adrs/ADR-060-importer-run-coordination.md) | Importer run coordination |
| [ADR-061](./adrs/ADR-061-importer-queue-concurrency.md) | Importer queue concurrency |
| [ADR-062](./adrs/ADR-062-importer-run-progress-reporting.md) | Importer run progress reporting |
| [ADR-063](./adrs/ADR-063-importer-error-surfacing.md) | Importer error surfacing |
| [ADR-064](./adrs/ADR-064-importer-validation-harness.md) | Importer validation harness |
| [ADR-065](./adrs/ADR-065-package-dependency-graph.md) | Package dependency graph |
| [ADR-066](./adrs/ADR-066-bootstrap-admin.md) | Bootstrap admin |
| [ADR-067](./adrs/ADR-067-logger-abstraction.md) | Logger abstraction |
| [ADR-068](./adrs/ADR-068-opentelemetry-tracing-integration.md) | OpenTelemetry tracing integration |
| [ADR-069](./adrs/ADR-069-prometheus-metrics.md) | Prometheus metrics |
| [ADR-070](./adrs/ADR-070-api-versioning.md) | API versioning |
| [ADR-071](./adrs/ADR-071-api-error-response-format.md) | API error response format |
| [ADR-072](./adrs/ADR-072-frontend-error-handling.md) | Frontend error handling |
| [ADR-073](./adrs/ADR-073-oidc-configuration.md) | OIDC configuration |
| [ADR-074](./adrs/ADR-074-oidc-claim-to-role-mapping.md) | OIDC claim-to-role mapping |
| [ADR-075](./adrs/ADR-075-self-registration.md) | Self-registration |
| [ADR-076](./adrs/ADR-076-app-settings-storage.md) | App settings storage |
| [ADR-077](./adrs/ADR-077-v1-entity-schema.md) | v1 entity schema (consolidated) |
| [ADR-078](./adrs/ADR-078-database-migrations.md) | Database migrations |
| [ADR-079](./adrs/ADR-079-enum-constant-structure.md) | Enum constant structure |
| [ADR-080](./adrs/ADR-080-pagination-strategy.md) | Pagination strategy |
| [ADR-081](./adrs/ADR-081-filtering-and-sorting.md) | Filtering and sorting |
| [ADR-082](./adrs/ADR-082-componentgroup.md) | ComponentGroup (v1 inclusion) |
| [ADR-083](./adrs/ADR-083-v1-feature-breakdown.md) | v1 feature breakdown |

### Session 2 — Secure Development

| ADR | Title |
|---|---|
| [ADR-084](./adrs/ADR-084-sql-injection-prevention.md) | SQL injection prevention |
| [ADR-085](./adrs/ADR-085-xss-prevention.md) | XSS prevention |
| [ADR-086](./adrs/ADR-086-session-cookie-security-flags.md) | Session cookie security flags |
| [ADR-087](./adrs/ADR-087-csrf-protection.md) | CSRF protection |
| [ADR-088](./adrs/ADR-088-cors-configuration.md) | CORS configuration |
| [ADR-089](./adrs/ADR-089-security-headers.md) | Security headers |
| [ADR-090](./adrs/ADR-090-no-secrets-in-logs.md) | No secrets in logs |
| [ADR-091](./adrs/ADR-091-no-secrets-in-commits.md) | No secrets in commits |
| [ADR-092](./adrs/ADR-092-dependency-scanning.md) | Dependency scanning |
| [ADR-093](./adrs/ADR-093-tls-https-for-production.md) | TLS / HTTPS for production |
| [ADR-094](./adrs/ADR-094-get-routes-must-not-have-side-effects.md) | GET routes must not have side effects |
| [ADR-095](./adrs/ADR-095-input-validation.md) | Input validation |
| [ADR-096](./adrs/ADR-096-error-responses-must-not-leak-internals.md) | Error responses must not leak internals |
| [ADR-097](./adrs/ADR-097-rate-limiting.md) | Rate limiting |
| [ADR-098](./adrs/ADR-098-importer-sandboxing.md) | Importer sandboxing |
| [ADR-099](./adrs/ADR-099-secure-password-and-credential-handling.md) | Secure password and credential handling |
| [ADR-100](./adrs/ADR-100-audit-log-integrity.md) | Audit log integrity |
| [ADR-101](./adrs/ADR-101-database-connection-security.md) | Database connection security |
| [ADR-102](./adrs/ADR-102-content-injection-in-jsonb-fields.md) | Content injection in JSONB fields |
| [ADR-103](./adrs/ADR-103-ux-ui-reference-adoption.md) | UX/UI reference adoption (`docs/ux.md` normative) |
| [ADR-104](./adrs/ADR-104-api-documentation-sync.md) | API documentation sync (`docs/openapi.yaml` + `docs/api.md` normative) |
| [ADR-106](./adrs/ADR-106-security-hardening-2026-09-assessment.md) | Security hardening from the 2026-09-10 assessment |
| [ADR-107](./adrs/ADR-107-credential-store.md) | Application credential store for integration secrets (supersedes ADR-023 no-secrets-at-rest clause) |
| [ADR-108](./adrs/ADR-108-mobile-nav-drawer.md) | Mobile navigation drawer below `md` (narrows `docs/ux.md` §9) |

### Frontend & SPA

| ADR | Title |
|---|---|
| [ADR-105](./adrs/ADR-105-spa-fallback-for-direct-navigation.md) | SPA fallback for direct navigation |

---

## Relationship Type Set (v1)

| Relationship | From → To | Semantic | Cardinality |
|---|---|---|---|
| `COMPOSES` | DigitalProduct → DigitalProduct | Parent composes child (hierarchy) | **DAG**: child has many parents; parent has many children (ADR-049) |
| `CONSUMES_FROM` | DigitalProduct → DigitalProduct | Business product consumes shared platform product | Many consumers, one platform |
| `DEPENDS_ON` | DigitalProduct → Component | Product depends on component | Many-to-many |
| `DEPENDS_ON` | Component → Component | Component depends on component (shared deps) | Many-to-many |
| `SOURCES_FROM` | Component → Component | Code provenance (service → repository) | Many-to-many |
| `EXPOSES` | Component → Component | Service exposes an API | Many-to-many |
| `HAS_INSTANCE` | Component → ComponentInstance | Component deployed in an environment | One-to-many |
| `OWNS` | LineOfBusiness → DigitalProduct | LOB owns product | One-to-many |
| `OWNS` | Team → DigitalProduct / Component | Team owns product/component | One-to-many |
| `BELONGS_TO` | Person → Team | Person belongs to team | Many-to-one |

---


---

## v1 Scope Summary

**In scope:**
- pnpm + Turborepo monorepo (`packages/core`, `packages/backend`,
  `packages/frontend`, 7 importer packages)
- PostgreSQL + Kysely + Kysely migrations
- Fastify backend with RBAC, server-side sessions, login rate limiting
- Built-in local auth + optional OIDC (JIT provisioning, claim-based role mapping)
- React + Vite + TanStack Query + Tailwind + shadcn/ui frontend
- 25-category component taxonomy (incl. `ACCOUNT`) + provider enum + free-form `resourceType`
- `ComponentInstance` entity for environment-specific deployments
- Composable Product Model: `DigitalProduct` (BUSINESS_CAPABILITY / PLATFORM /
  CUSTOMER_FACING) with `COMPOSES` / `CONSUMES_FROM` / `DEPENDS_ON`
- Full guided Platform Product workflow (detect → promote → rewrite edges →
  assign owner)
- Ownership graph: `LineOfBusiness` + `Team` + `Person`
- Importer framework: in-tree, code-registered, pull-only `AsyncGenerator`,
  scheduled + on-demand, external secret stores
- 7 importers: GitHub, AWS, Azure, Kubernetes, Web URL, API URL, MCP server
- Docker Compose deployment
- Testing: shared importer harness + integration tests (testcontainers)
- Docs: README + `docs/` (importer-development, data-model, deployment) +
  generated docs site (feature `007-deployment-cicd-docs`)
- CI/CD: GitHub Actions + changesets
- Observability: Pino + Prometheus + OpenTelemetry

**Out of scope (deferred):**
- `Risk` entity and security-findings importers (later phase with ASPM)
- Scoring-engine fields (EPSS, KEV, CARS, SSVC, loss-model)
- Importer-declared candidate product edges (v2: staged, human-confirmed)
- Per-env blast-radius traversal (Phase 4+)
- Kubernetes/Helm packaging (community-contributed)
- E2e tests (post-v1)
- Runtime-loaded importer plugins (post-v1)
- Remaining providers (GitLab, Bitbucket, Azure DevOps, Alibaba Cloud,
  Cloudflare, OpenShift, Docker/Podman) = contributor-welcome issues

---


---
