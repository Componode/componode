# Implementation Plan: Guided Docker importer setup

**Branch**: `063-docker-importer-onboarding` | **Date**: 2026-11-05 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/063-docker-importer-onboarding/spec.md`

## Summary

Add a guided, create-only wizard that takes an administrator from zero
Docker configuration to a running Hub-bound Docker import in one flow:
transport + route fields → secrets (canonical keys, inline or reused
credential) → identity → stateless connectivity probe → create target →
credential → importer config. The only backend change is a new
`POST /api/v1/docker-targets/probe` operation that verifies a route
profile plus secret material (inline `secrets` or an existing `STORED`
`credentialId`) without persisting anything. The generic importer form
gains an "Advanced" disclosure for Docker's three deepest scope fields,
and the Docker importer guide gains a five-minute quickstart.

## Technical Context

- **Language/Version**: TypeScript 6
- **Primary Dependencies**: Fastify, Kysely, Zod, React, Vite, TanStack Query, React Router, Tailwind, shadcn/ui
- **Storage**: PostgreSQL via Kysely — **no schema changes**; existing `docker_targets`, `credentials`, `importer_configs` tables only
- **Testing**: Vitest unit/integration tests (backend testcontainers + `app.inject`; frontend Testing Library), OpenAPI contract test (`api-docs-contract.test.ts`), generated-docs checks (`docs:api:check`, `docs:importers:check`, `docs:oracle:check`, `docs:sidebar:check`)
- **Target Platform**: Self-hosted Docker Compose deployment; Hub execution only — agent path untouched
- **Project Type**: pnpm monorepo web application (`packages/core`, `packages/backend`, `packages/frontend`)
- **Performance Goals**: Probe is a single `/version` call (same bound as existing target test); wizard makes ≤3 write calls + 1 probe per run
- **Constraints**: No new persistence paths; secret values write-only after credential creation; probe persists nothing and writes no audit; all wizard mutations ADMIN-only; no manifest/core contract changes beyond the probe schema in `packages/core`
- **Scale/Scope**: 1 new API operation, 1 new frontend route + wizard module, 1 frontend scope-renderer disclosure, 1 docs section, 1 ADR-122 amendment

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I — Single-Organization, Self-Hosted**: No tenant concepts; wizard is a single-org admin flow.
- **II — Importer-First**: Importer packages untouched; the probe reuses the importer's existing `testSecrets` contract. Importers remain pull-only and DB-free.
- **III — Two-Level Taxonomy**: No category/provider/resourceType changes.
- **IV — Environment-as-Instance**: No component/instance modeling changes; wizard defers environment mapping to the existing config fields.
- **V — Factual vs. Meaning Layer**: No edge or hierarchy changes.
- **VI — Test-First**: Probe endpoint gets failing integration tests first; wizard logic module gets unit tests first; scope-disclosure gets component tests first.
- **VII — Observability from Day One**: Probe is a normal Fastify route (request logging applies); no new runtime code path is added without the existing request log. No importer-run changes.

**Post-design gate**: PASS. The probe endpoint amends the ADR-122 API surface (recorded as an ADR-122 amendment + index back-pointer); no Constitution principle changes.

## Architecture and Data Flow

1. **Probe (new, stateless)**: `POST /api/v1/docker-targets/probe` →
   `probeDockerTargetSchema` (core) validates the envelope → service
   validates `profile` via the docker manifest's `targetProfileSchema`
   (same `validateProfile` helper as target create) → resolves secret
   material: inline `secrets` verbatim, or `credentialId` → load STORED
   credential + `decryptSecrets` (same keyring path as
   `testDockerTarget`) → coverage-check `profileSecretKeys(profile)` →
   `getImporter("docker").testSecrets(secrets, {}, profile)` →
   `{ok, error?}` sanitized by the existing `maskSecretValues` path.
   No DB writes, no audit.

2. **Wizard (new route `/importers/new/docker`, ADMIN)**: a stepper
   component (`DockerSetupWizard`) with pure logic extracted to
   `docker-setup-logic.ts` (transport→canonical-key map, profile builder,
   targetId suggester, credential-coverage predicate — all unit-testable
   without rendering). Steps:
   - **Route**: transport picker + per-transport fields reusing the
     `TRANSPORTS`/`TRANSPORT_FIELDS` metadata pattern from
     `docker-target-form.tsx` (minus `*Key` fields, which the wizard
     derives); socket step surfaces the compose socket-mount guidance.
   - **Secrets** (tcp/ssh only): "enter values" masked inputs OR "use
     existing credential" picker filtered to `STORED` +
     `status==="ACTIVE"` + `keyHints` covering required keys.
   - **Identity**: import label, target selector (auto-suggested slug,
     editable, uniqueness checked client-side against the targets list),
     schedule preset (reuse `SCHEDULES`), enabled toggle, optional
     description.
   - **Verify & create**: probe → on `ok:true` run the three creates in
     order (target → credential if new values → config with
     `scope:{targetId}`, `agentId:null`, `credentialIds:[…]`) → navigate
     to `/importers/:id`. Any failure stops the chain, names completed
     steps, and links to the created artifacts for manual completion.

3. **Progressive disclosure**: `ADVANCED_SCOPE_KEYS: Record<string,
   string[]>` frontend constant (`{ docker: ["environmentMap",
   "componentIdLabel", "sourceKey"] }`); the importer form partitions
   `renderedScopeFields` and renders the advanced subset inside the
   existing `Collapsible` UI primitive, collapsed by default. All
   seeding/validation/submit paths already operate on `scopeFields`
   wholesale — partitioning is render-only, so values round-trip
   unchanged.

4. **Docs**: `docs/importers/docker.md` gains a "Quickstart" section
   above the generated contract region (Hub + local socket, ~5 minutes,
   links to `deployment.md`/`import-agents.md`); `docs/deployment.md`'s
   Docker section links the guided setup. `docs:api` regenerates
   `docs/api.md` for the probe row.

## Project Structure

### Documentation (this feature)

```text
specs/063-docker-importer-onboarding/
├── plan.md              # This file
├── research.md          # Phase 0 — decisions & verified facts
├── data-model.md        # Phase 1 — entities (no schema changes)
├── contracts/
│   └── docker-target-probe-api.md   # probe operation + wizard deltas
├── quickstart.md        # Phase 1 — validation guide
├── checklists/
│   └── requirements.md  # spec quality checklist
└── tasks.md             # /speckit-tasks output (next stage)
```

### Source Code (repository root)

```text
packages/
├── core/src/
│   ├── schemas/docker-target.ts        # + probeDockerTargetSchema
│   └── index.ts                        # export schema + type
├── backend/src/
│   ├── routes/docker-targets.ts        # + POST /docker-targets/probe
│   └── services/docker-target-service.ts  # + probeDockerTarget()
├── backend/test/integration/docker-targets.test.ts  # + probe cases
├── frontend/src/
│   ├── api/hooks/docker-targets.ts     # + useProbeDockerTarget()
│   ├── ux/app/importers/docker-setup.tsx           # wizard page (new)
│   ├── ux/components/importers/
│   │   ├── docker-setup-wizard.tsx    # stepper component (new)
│   │   ├── docker-setup-logic.ts      # pure helpers (new)
│   │   └── importer-form.tsx          # advanced disclosure + wizard hint
│   ├── ux/app/importers/index.tsx     # guided-setup entry (ADMIN)
│   ├── routes.tsx                     # + importers/new/docker (ADMIN)
│   └── test/unit/                     # + wizard-logic + disclosure tests
docs/
├── openapi.yaml                       # + /docker-targets/probe
├── api.md                             # regenerated (docs:api)
├── importers/docker.md                # + quickstart section
└── deployment.md                      # link guided setup
researches/adrs/ADR-122-docker-hub-execution.md      # amendment
researches/architecture-decisions.md                # back-pointer (if indexed)
docs/roadmap.md                        # shipped entry (Stage 8)
```

**Structure Decision**: feature spans `core` (one schema), `backend` (one
route + one service function), and `frontend` (one route, one wizard
component tree, one renderer tweak) — matching the existing
`docker-targets` vertical. No new packages, no importer changes.

## Phase breakdown (for /speckit-tasks)

1. **Probe contract**: core schema → backend service + route →
   openapi.yaml → `docs:api` → integration tests (failing first).
2. **Wizard logic**: `docker-setup-logic.ts` pure module + unit tests.
3. **Wizard UI**: page + stepper + probe hook + entry points.
4. **Progressive disclosure**: `ADVANCED_SCOPE_KEYS` + Collapsible +
   tests + generic-form hint link.
5. **Docs & ADR**: docker.md quickstart, deployment.md link,
   ADR-122 amendment, contract-test green.

## Complexity Tracking

No constitution violations — table intentionally empty.
