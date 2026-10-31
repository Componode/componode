# AGENTS.md — Project Context for AI Coding Agents

> **Project**: Componode — open-source Digital Product Asset Management
> **License**: Apache 2.0
> **Repository**: https://github.com/Componode/componode
> **Primary language**: English (all documentation, specs, and comments)

---

## Project Overview

Componode is an **open-source, self-hosted Digital Product Asset Management
(DPAM)** tool — a single-organization, importer-first catalog. Users model
their **Digital Products** (applications, solutions) as compositions of
building-block **Components** imported from repository tools, cloud
environments, container orchestrators, and web/API/MCP endpoints.

The canonical architecture is the **Composable Product Model**: Lines of
Business own Business Capability Products that compose shared Platform Products,
and every product depends on Components.

Scope guardrails: no multi-tenancy/`Organization` layer, no hosted SaaS in v1,
and no security scanning (Risk entity and ASPM integration are deferred to a
later phase).

### Foundational documents (read these first)

| Document                               | Role                                                                                                         |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `.specify/memory/constitution.md`      | **7 binding principles that govern every spec**                                                              |
| `researches/architecture-decisions.md` | **ADR index**                                                                                                |
| `researches/adrs/ADR-XXX-*.md`         | **Individual ADRs for every rule in this file**                                                              |
| `CONTEXT.md`                           | **Domain vocabulary — canonical terms + `Avoid:` list; read before writing specs, UI copy, or entity names** |
| `specs/{NNN-feature-name}/spec.md`     | **Feature specifications (authoritative for current work)**                                                  |
| `specs/{NNN-feature-name}/plan.md`     | **Implementation plan for the current feature**                                                              |
| `specs/{NNN-feature-name}/tasks.md`    | **Executable tasks for the current feature**                                                                 |

Never implement from `.devin/plans`, one-off notes, or temporary locations.
Always implement from the generated `tasks.md` artifact under `specs/`.
If this file conflicts with an ADR, the constitution, or an active `specs/`
artifact, the more specific document wins.

---

## Technology Stack

Fastify + Kysely backend (TypeScript), React/Vite frontend (TanStack Query,
React Router, Tailwind, shadcn/ui), PostgreSQL (CHECK constraints from `core`
constants; no native ENUMs), pnpm workspaces + Turborepo, Kysely migrations,
Docker Compose deploy.

Exact dependency versions are pinned in each package's `package.json`. For the
full stack rationale, see `.specify/memory/constitution.md` § Additional
Constraints and the relevant ADRs.

---

## Project Structure

```text
.
├── packages/                      # pnpm workspace
│   ├── core/                      # Shared contracts and types (leaf — zero @componode/* deps)
│   ├── backend/                   # Fastify API + Kysely services
│   ├── frontend/                  # React/Vite dashboard
│   ├── agent/                     # Import Agent runtime (ADR-116 — enrolls, outbound WSS stream)
│   └── importer-*/                # 8 in-tree importers (alibaba-cloud, api-url, aws, azure, github, kubernetes, mcp-server, web-url)
├── researches/                    # Research docs ({topic}_research.md), adrs/, architecture-decisions.md index
├── specs/{NNN-feature-name}/      # DYNAMIC — spec.md, plan.md, tasks.md, created per feature/bugfix
├── docs/                          # Source documentation (see Key References)
├── .specify/                      # spec-kit: memory/constitution.md, workflows/, powershell helpers
├── .agents/skills/                # Canonical shared skills (pinned by skills-lock.json)
├── .devin/skills/                 # speckit-* only (spec-kit manifest-tracked)
├── .claude/skills/                # Claude Code skills (only place Claude reads them)
├── skills-lock.json               # Lockfile for installed skills (source + hash)
├── docs-site/                     # VitePress config and output
└── scripts/                       # Deployment and validation scripts

> Skills under `.agents/`, `.devin/`, and `.claude/` are **required project
> tooling** — tracked in git, and agents working in this repo must use them
> (e.g. `speckit-*` for feature work, `writing-for-agents` when editing
> agent-facing docs). Devin discovers `.agents/skills/` natively, so the
> shared set is NOT duplicated into `.devin/skills/`; Claude Code only reads
> `.claude/skills/`, so its copies are kept there.
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
  the database. They report their provider-native source identity via
  `context.reportSourceIdentity()` before the first yield — including empty
  inventories — and resolve remote access routes only through
  `context.resolveTarget()` when their manifest declares `targetRefKey`.
  (Ratified in `ADR-119`; implementation lands with the ImporterSource
  core spec.) See `ADR-056` (Amendment 1), `ADR-057`, `ADR-119`.
- Importer packages depend only on `packages/core`. They MUST NOT import from
  `packages/backend` or from other importers. See `ADR-065`.
- The core owns upsert, dedup, reconciliation, and run history.
  Reconciliation is **source-scoped**: durable `ImporterSource`→Component/
  ComponentInstance memberships are the unit — a completed run retires only
  its own Source's absent memberships, and a shared Component stays
  `ACTIVE` while any Source reports it. Deleting an `ImporterConfig`
  leaves its Source `UNMONITORED` and preserves run history
  (`import_runs.sourceId` durable, `configId` → `NULL`). See `ADR-035`,
  `ADR-036` (Amendment 1), `ADR-037`, `ADR-038`, `ADR-047` (Amendment 1),
  `ADR-119`.
- Every importer MUST have a user-facing setup guide at
  `docs/importers/<name>.md` covering: what it imports, what to set up in
  the **external tool** (accounts, services to enable, permissions/scopes),
  required/optional credentials, every config field, and common failures.
  Creating or changing an importer (config fields, secrets, capability
  behavior) without updating its guide leaves the work incomplete.

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
- `CONSUMES_FROM` target must be `PLATFORM` (see `ADR-018`); any product
  type may be a `COMPOSES` parent — the parent-type restriction was removed.
  See `ADR-109`.
- 1-to-many relationships are foreign keys; many-to-many are typed junction
  tables. No polymorphic `edges` table. See `ADR-048`.
- `DEPENDS_ON` may target a `ComponentGroup` (ADR-110); product health is a
  derived rollup over declared dep sources (ADR-112).
- Server-generated staged `DEPENDS_ON` candidates live in
  `edge_suggestions` and are decided by humans in the Suggestions queue —
  never auto-wired. Decided pairs (`ACCEPTED`/`DISMISSED`/`SUPERSEDED`) are
  terminal. See `ADR-113`.

### Package dependencies

- `packages/core` is a leaf with zero `@componode/*` deps.
- `packages/backend` depends on `core` + all 8 importer packages (manifest
  import only).
- `packages/agent` depends on `core` + all 8 importer packages (manifest
  import only) — the lockstep handshake requires the same importer set
  (ADR-116 amendment to ADR-065).
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

The interactive shell may be **PowerShell or Git Bash** depending on the host
— check which you have before quoting long commands. The speckit helpers are
PowerShell scripts under `.specify/scripts/powershell/` and require
PowerShell regardless of the interactive shell.

For any `git` or `gh` command that needs a long message (commit body, PR
body), write the text to a temporary file and pass it with the file flag —
this is reliable in both shells:

- `git commit -F <file>`
- `gh pr create --body-file <file>` / `gh pr edit --body-file <file>`

Delete the temporary file after the command succeeds.

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

`.specify/feature.json` is the machine-local pointer to the **current** feature
directory — `speckit-specify` rewrites it, and `speckit-plan`/`tasks`/etc.
resolve the feature from it. Keep it pointed at the in-flight spec (update it
when switching features); it is ignored by git on purpose.

**Roadmap sync**: when a spec completes (implementation + PR), update
`docs/roadmap.md` — mark the feature `NNN-name` complete under **Shipped**
and revise the **Next** entry so the roadmap always reflects the current
state.

**UX gap governance** (docs/ux.md §7): when the UX needs a backend
capability that does not exist, add a detailed entry to
`researches/ux-rewrite-gaps.md` (flagged surface, missing capability,
resolution plan) **and** a matching flag in
`packages/frontend/src/ux/lib/flags.ts` — never fake the interaction or
ship an undocumented stub. The flagged UI renders its defined fallback.
Gap entries become the next specs on the roadmap; flip the flag and mark
the entry resolved when the capability lands.

**ADR fidelity**: `specs/` artifacts are working documents; ADRs are the
durable decision record. During `speckit-plan` and `speckit-implement`,
whenever a design choice extends a surface an ADR presents as closed —
enumerated lists such as env vars, error codes, message/disconnect
reasons, endpoints, permission sets — or conflicts with ratified ADR
language, ratify it in the same change, not just in `research.md`/`plan.md`:

- Refinement of an existing ratified ADR → append `## Amendment N — …`
  to that ADR (precedent: ADR-087 Amendment 1).
- New ratified decision → new `ADR-NNN-{slug}.md` listing its
  "Amendments to earlier ADRs" (precedent: ADR-116).
- Either way, add a `---` + `**Amended by ADR-XXX**:` back-pointer to
  every ADR it amends, and keep each ADR's amends list in
  `researches/architecture-decisions.md` current.

Decisions inside ratified boundaries (library choices, in-memory
mechanics, naming) stay in `research.md`/`plan.md` — cite the anchor with
a `Ratified in:` line. Done means: no contract surface lives only in a
spec artifact, and every amended ADR points back.

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

## Research Workflow

Research workloads produce **documentation only** — no code changes, no
schema changes, no implementation. Findings land in `researches/` as
Markdown, following the existing `{topic}_research.md` convention (Purpose /
Scope header, claims cited to primary sources). Research documents are
informative, not authoritative: where a finding conflicts with a ratified
ADR, flag the conflict explicitly — never silently override it.

**Research → specification.** When the user asks to turn research into a
specification:

1. Run the `grilling` skill on the research document — grill the user on
   every open decision the research raises until the design tree is fully
   settled and shared understanding is confirmed.
2. Record ratified decisions as ADRs in the existing standard —
   `researches/adrs/ADR-NNN-{slug}.md` (next sequential number; Context,
   Decision, Consequences, Amendments to earlier ADRs, Rationale,
   Alternatives considered) — register each in the
   `researches/architecture-decisions.md` index under the right section,
   and add `**Amended by ADR-XXX**:` back-pointers to every ADR the new
   one amends (see **ADR fidelity** above).
3. Only then run the spec-kit flow (`speckit-specify` → `speckit-plan` →
   `speckit-tasks` → `speckit-implement`). Implementation is driven from
   `specs/{NNN-feature-name}/tasks.md`, never directly from the research
   document.

---

## Key References

| Document                                                                        | When to read it                                                                     |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `docs/importer-development.md`, `docs/importers/`                               | When building or editing an importer — dev guide + mandatory per-importer user docs |
| `docs/api.md`, `docs/openapi.yaml`, `docs/openapi-reference.md`                 | When adding, changing, or removing any API endpoint (ADR-104)                       |
| `docs/ux.md`                                                                    | Before writing or reviewing any frontend spec or UI code                            |
| `specs/{NNN-feature-name}/data-model.md`, `packages/backend/src/db/migrations/` | When changing schema or entities                                                    |
| `docs/deployment.md`                                                            | When changing Docker Compose or deployment                                          |
| `docs/release.md`                                                               | When changing the changeset or release process                                      |
