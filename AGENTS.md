# AGENTS.md — Project Context for AI Coding Agents

> **Last updated**: 2026-09-21 (docs sync: 108 ADRs, per-spec data models,
> dead env vars removed, TLS/OIDC deployment docs)
> **Project**: Componode — open-source Digital Product Asset Management
> **License**: Apache 2.0
> **Repository**: https://github.com/Componode/componode
> **Primary language**: English (all documentation, specs, and comments)

---

## Project Overview

Componode is an **open-source, self-hosted Digital Product Asset Management
(DPAM)** tool. It lets users model their **Digital Products** (applications,
solutions) as compositions of building-block **Components** imported from
repository tools, cloud environments, container orchestrators, and web/API/MCP
endpoints.

The canonical architecture is the **Composable Product Model**: Lines of
Business own Business Capability Products that compose shared Platform Products,
and every product depends on Components.

### What Componode is

- A **single-organization** self-hosted tool (no multi-tenancy).
- An **importer-first** catalog: the headline value is importing assets from
  GitHub, AWS, Azure, Kubernetes, web/API/MCP endpoints.
- A human-curated catalog of digital products and their composition hierarchy,
  enriched by importers.

### What Componode is not

- Not a hosted SaaS (single-org only; hosted offering is a future open-core
  possibility, not v1).
- Not multi-tenant (no `Organization`/tenant layer).
- Not a security scanner (Risk entity and ASPM integration are deferred to a
  later phase).

### Foundational documents (read these first)

| Document | Role |
|---|---|
| `.specify/memory/constitution.md` | **7 binding principles that govern every spec** |
| `researches/architecture-decisions.md` | **ADR index — 108 ratified decisions** |
| `researches/adrs/ADR-XXX-*.md` | **Individual ADRs for every rule in this file** |
| `specs/{NNN-feature-name}/spec.md` | **Feature specifications (authoritative for current work)** |
| `specs/{NNN-feature-name}/plan.md` | **Implementation plan for the current feature** |
| `specs/{NNN-feature-name}/tasks.md` | **Executable tasks for the current feature** |

Never implement from `.devin/plans`, one-off notes, or temporary locations.
Always implement from the generated `tasks.md` artifact under `specs/`.

---

## Technology Stack

| Layer | Technology |
|---|---|
| Backend API | TypeScript 5, Fastify, Kysely |
| Frontend | React 18, Vite, TanStack Query, React Router, Tailwind CSS, shadcn/ui |
| Database | PostgreSQL (CHECK constraints from `core` constants; no native ENUMs) |
| Migrations | Kysely built-in migration system (TS, schema-builder) |
| Monorepo | pnpm workspaces + Turborepo |
| Importer framework | In-tree packages, pull-only `AsyncGenerator<DiscoveredAsset>` |
| Auth | Built-in local (Argon2id + server-side sessions) + optional OIDC |
| Observability | Pino (logging) + Prometheus (metrics) + OpenTelemetry (tracing) |
| Deployment | Docker Compose (one container: backend serves frontend static) |
| CI/CD | GitHub Actions + changesets |
| License | Apache 2.0 |
| Identifiers | UUID v7 for entities; `slug` for human-readable refs |
| API versioning | `/api/v1/...` prefix on all routes |

For the full stack rationale, see `.specify/memory/constitution.md` § Additional
Constraints and the relevant ADRs.

---

## Project Structure

```text
.
├── .changeset/                    # Changeset release notes
├── .devin/
│   └── skills/                    # spec-kit skills (speckit-*)
├── .specify/                      # spec-kit infrastructure
│   ├── memory/constitution.md     # Project constitution
│   └── workflows/                 # Workflow registry
├── packages/                      # pnpm workspace packages
│   ├── core/                      # Shared contracts and types
│   ├── backend/                   # Fastify API + Kysely services
│   ├── frontend/                  # React/Vite dashboard
│   ├── importer-api-url/
│   ├── importer-aws/
│   ├── importer-azure/
│   ├── importer-github/
│   ├── importer-kubernetes/
│   ├── importer-mcp-server/
│   └── importer-web-url/
├── researches/                    # Architecture research and decisions
│   ├── architecture-decisions.md  # ADR index
│   └── adrs/                      # 108 individual ADR files
├── specs/                         # DYNAMIC — created per feature
│   └── {NNN-feature-name}/        # spec.md, plan.md, tasks.md, ...
├── docs/                          # Source documentation
│   ├── api.md                     # API reference (human-readable)
│   ├── openapi.yaml               # API reference (OpenAPI 3.0)
│   ├── openapi-reference.md       # Interactive OpenAPI reference source
│   ├── importer-development.md    # Importer contributor contract
│   ├── ux.md                      # Normative UX/UI reference
│   ├── security/                  # Dated security assessment reports
│   ├── deployment.md              # Docker Compose self-hosting
│   ├── release.md                 # Changeset release process
│   └── index.md                   # Docs site landing page
├── docs-site/                     # VitePress configuration and output
│   └── .vitepress/                # VitePress theme and config
├── scripts/                       # Deployment and validation scripts
├── docker-compose.yml
├── CHANGELOG.md
├── AGENTS.md                      # This file
└── README.md
```

---

## Agent Boundaries & Non-Negotiables

These are the constraints every implementation must respect. They are not
detailed design documents; for detail, read the linked ADRs and the
constitution.

### Identity & data

- Use **UUID v7** for new entity records; pass the ID as a SQL parameter. See
  `ADR-045`.
- `DigitalProduct`, `Component`, `ComponentInstance`, `ComponentGroup`,
  `Person`, `Team`, and `LineOfBusiness` MUST have a unique `slug`. See
  `ADR-046`.
- No `Organization` or tenant layer. No multi-tenancy. See `constitution.md` I.

### Importer contract

- Importers are **pull-only** `AsyncGenerator<DiscoveredAsset>` and never touch
  the database. See `ADR-056`, `ADR-057`.
- Importer packages depend only on `packages/core`. They MUST NOT import from
  `packages/backend` or from other importers. See `ADR-065`.
- The core owns upsert, dedup, reconciliation, and run history. See
  `ADR-035`, `ADR-036`, `ADR-037`, `ADR-038`.

### Environment & lifecycle

- Environment is modeled as `ComponentInstance`, not a field on `Component`. See
  `ADR-014`, `ADR-034`.
- `Component.lifecycle` (`ACTIVE`/`RETIRED`) is the logical lifecycle;
  `ComponentInstance.status` (`RUNNING`/`STOPPED`/`ERROR`/`GONE`) is the
  operational state. Do not conflate them. See `constitution.md` IV.
- Default list/tree/dashboard queries exclude `RETIRED` records and `GONE`
  instances unless the caller explicitly requests them.

### Graph & hierarchy

- `COMPOSES` (product → product) is a DAG. Cycle detection returns `409 CYCLE`
  to the client. See `ADR-049`, `ADR-050`.
- `CONSUMES_FROM` target must be `PLATFORM`; `COMPOSES` parent must be
  `BUSINESS_CAPABILITY` or `CUSTOMER_FACING`. See `ADR-018`.
- 1-to-many relationships are foreign keys; many-to-many are typed junction
  tables. No polymorphic `edges` table. See `ADR-048`.

### Package dependencies

- `packages/core` is a leaf with zero `@componode/*` deps.
- `packages/backend` depends on `core` + all 7 importer packages (manifest
  import only).
- `packages/frontend` depends on `core` for types and calls the backend over
  HTTP. See `ADR-065`.

### Security (read ADR-084 through ADR-102 for full rules)

- No `sql.raw()` or `sql.fragment()` in application code; Kysely parameterized
  queries only. See `ADR-084`.
- No `dangerouslySetInnerHTML` in v1; validate all URL `href`s with `safeUrl()`.
  See `ADR-085`.
- No secrets, credentials, or sensitive config in logs or commits. See
  `ADR-090`, `ADR-091`.
- Integration secrets (importer credentials, OIDC client secrets) live in the
  `credentials` table, AES-256-GCM encrypted, write-only over the API. Legacy
  `env`/`file` `secretRefs` are deprecated. Infrastructure-only secrets stay
  external. See `ADR-107`.
- `GET`/`HEAD` routes must be side-effect-free on domain state. See `ADR-094`.
- Validate all inputs with Zod at the route boundary; reject unknown fields.
  See `ADR-095`.
- Error responses must not leak stack traces, SQL, or internal paths. See
  `ADR-096`.
- All API routes are authenticated except public auth routes, `/metrics`, and
  `/api/v1/health` (unauthenticated so container health checks and smoke tests
  can verify readiness without a session). See `ADR-054`, `ADR-097`.
- Session IDs are cryptographically random, not UUID v7. See `ADR-099`.

### API & errors

- All routes under `/api/v1/...`. See `ADR-070`.
- Error responses: `{code, message, details?}`. Codes are controlled enums in
  `packages/core`. See `ADR-071`.
- Any change that adds, modifies, or removes an API endpoint MUST update
  `docs/openapi.yaml` in the same change; `docs/api.md` endpoint tables are
  generated from it (`docs:api`). Route coverage, `x-permission` vs
  `requireRole`, and `security: []` vs `verifySession` are enforced by a
  backend contract test — drift fails CI. See `ADR-104`.

### Dependency & supply chain

- Add dependencies with `pnpm add` inside the owning workspace package; use
  `^x.y.z` ranges, prefer releases published at least 7 days ago, and never
  use `latest`, `*`, or unbounded ranges.
- Commit `pnpm-lock.yaml` together with every manifest change, and run
  `pnpm lint && pnpm typecheck && pnpm test && pnpm build` before opening a
  PR that touches dependencies.
- `pnpm audit --prod --audit-level=high` must stay clean; CI enforces it.
- Ship major version upgrades in their own PR — never bundled into feature
  or bugfix work. Review the release notes' breaking changes against actual
  usage first (removed config keys, peer ranges, Node version floors).
- Dependabot and security-update PRs: read the advisory severity, verify CI,
  check peer compatibility, then merge or adapt. If the complete fix needs a
  major bump, merge the interim security patch and open a follow-up — do not
  dismiss a security alert without a documented reason.
- For transitive vulnerabilities, prefer upgrading the parent package; fall
  back to a `pnpm.overrides` entry and explain it in the PR body.
- CodeQL and dependency-review findings introduced by a change block that
  change. Never weaken audit levels, CodeQL, or review gates to make CI pass
  — escalate instead.

### Testing

- Test-first is non-negotiable: failing test → implement → refactor. See
  `constitution.md` VI.
- `validateDiscoveredAsset` in `packages/core` is the enforceable importer
  contract. Every importer unit test MUST exercise it.

---

## Shell Environment (Windows)

Commands run in **PowerShell**. For any `git` or `gh` command that needs a
long message (commit body, PR body), write the text to a temporary file and
pass it with the file flag:

- `git commit -F <file>`
- `gh pr create --body-file <file>` / `gh pr edit --body-file <file>`

Bash heredocs (`git commit -m "$(cat <<'EOF' ... EOF)"`) fail with parser
errors in PowerShell — always use the temp-file flag instead. Delete the
temporary file after the command succeeds.

---

## Spec-Kit Workflow

All feature work MUST follow the spec-kit workflow. The authoritative commands
and sequences are `.specify/memory/constitution.md` § Spec-Driven Development
Workflow and `.specify/workflows/workflow-registry.json`.

Required sequence for a feature:

1. `speckit-specify` — produce `specs/{NNN-feature-name}/spec.md`.
2. `speckit-plan` — produce `specs/{NNN-feature-name}/plan.md` (and optional
   `data-model.md`, `research.md`, `contracts/`, `quickstart.md`).
3. `speckit-tasks` — produce `specs/{NNN-feature-name}/tasks.md`.
4. `speckit-implement` — execute `tasks.md` phase by phase.
5. `speckit-analyze` / `speckit-converge` — before merge.

Branch naming is determined by `.specify/init-options.json`
(`feature_numbering: sequential`). When a valid `speckit-specify` command is
issued, the agent MUST work on the designated feature branch and never on `main`
or an unrelated branch.

**Roadmap sync**: when a spec completes (implementation + PR), update the
**Roadmap** section in `README.md` — mark the feature `NNN-name` complete and
revise the `Next` entry so the roadmap always reflects the current state.

## Bugfix Spec Workflow

Bugfixes are a lightweight variant of the feature spec workflow. They still live
under `specs/` and still require a regression test, but the scope is the
bug itself rather than new product functionality.

Required sequence for a bugfix:

1. `speckit-specify` (or manual creation) — produce
   `specs/{NNN}-bugfix-{short-name}/spec.md` with the problem, root cause,
   impacted user scenarios, and acceptance criteria.
2. `speckit-plan` — produce `specs/{NNN}-bugfix-{short-name}/plan.md` and any
   required `tasks.md`.
3. Regression test first — add a failing test that reproduces the bug.
4. Implement the minimal fix.
5. Update affected ADRs (Amendment section) or add a new ADR if the fix
   introduces/extends an architecture decision.
6. `speckit-analyze` / `speckit-converge` — before merge.

Branch naming for bugfixes: `bugfix/{NNN}-{short-name}` (or the feature branch
if the fix belongs to an in-flight feature). Never commit a bugfix to `main`
without a spec, a regression test, and an updated ADR where the fix touches an
architecture decision.

---

## What AGENTS.md Is

- A **starting map** for the project.
- A **guardrail list** of the most important non-negotiables.
- A **signpost** to the authoritative documents (constitution, ADRs, specs).

## What AGENTS.md Is NOT

- **Not the spec.** Authoritative feature requirements live in
  `specs/{NNN-feature-name}/`.
- **Not the architecture record.** Ratified decisions live in
  `researches/architecture-decisions.md` and `researches/adrs/`.
- **Not the constitution.** The 7 binding principles live in
  `.specify/memory/constitution.md`.
- **Not a security checklist.** The full 19 secure-development rules are in
  `ADR-084` through `ADR-102`.

If this file conflicts with an ADR, the constitution, or an active `specs/`
artifact, the more specific document wins.

---

## Key References

| Document | When to read it |
|---|---|
| `.specify/memory/constitution.md` | Before writing or reviewing any spec |
| `researches/architecture-decisions.md` | Before any implementation |
| `researches/adrs/ADR-XXX-*.md` | When the ADR index or `AGENTS.md` boundary points you to one |
| `specs/{NNN-feature-name}/spec.md` | When starting a feature |
| `specs/{NNN-feature-name}/plan.md` | Before `speckit-tasks` for that feature |
| `specs/{NNN-feature-name}/tasks.md` | During `speckit-implement` |
| `docs/importer-development.md` | When building or editing an importer |
| `docs/api.md`, `docs/openapi.yaml`, `docs/openapi-reference.md` | When adding, changing, or removing any API endpoint (ADR-104) |
| `docs/ux.md` | Before writing or reviewing any frontend spec or UI code |
| `specs/{NNN-feature-name}/data-model.md`, `packages/backend/src/db/migrations/` | When changing schema or entities |
| `docs/deployment.md` | When changing Docker Compose or deployment |
| `docs/release.md` | When changing the changeset or release process |
