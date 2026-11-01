# Implementation Plan: Importer Source Migration

**Branch**: `045-importer-source-migration` | **Date**: 2026-10-31 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/045-importer-source-migration/spec.md`

## Summary

Migrate all eight in-tree importers onto the `ImporterSource` provenance
model shipped in spec 044 (ADR-119): each importer declares
`reportsSourceIdentity`, acquires a provider-native identity before first
yield, and reports it via `context.reportSourceIdentity()`. Where a
provider-native asset identifier is not globally unique, emitted
`externalId`s gain a canonical source-identity qualifier, with an
executor-side legacy-format fallback match that adopts pre-migration rows
instead of duplicating them. `DiscoveredAsset` gains `sourceDetails` so
source-specific facts persist on Source memberships instead of
last-writer-wins on the shared row (Wave A follow-up). A data migration
backfills Sources and memberships only where config/run provenance is
defensible; everything else keeps `LEGACY_UNATTRIBUTED` provenance.
Contract surfaces are ratified in new ADR-120 in the same change.

## Technical Context

**Language/Version**: TypeScript 6 (strict), Node 24 runtime

**Primary Dependencies**: `@componode/core` contracts (`DiscoveredAsset`,
`ImporterContext.reportSourceIdentity`, `canonicalizeSourceIdentity`),
Fastify + Kysely backend, pnpm workspaces; importers depend only on `core`

**Storage**: PostgreSQL — existing `importer_sources`,
`source_component_memberships`, `source_instance_memberships`,
`import_runs.sourceId` (migration 022); new migration 023 for backfill

**Testing**: vitest — importer unit tests through `validateDiscoveredAsset`,
backend integration tests with testcontainers Postgres

**Target Platform**: Linux/Docker backend; same importer code runs
in-process (hub) and on Import Agents (protocol v3 `source.identity`
frame already exists)

**Project Type**: pnpm monorepo — `packages/core` (leaf),
`packages/backend`, `packages/agent`, `packages/importer-*` ×8,
`packages/frontend` (untouched)

**Performance Goals**: no new hot paths; identity acquisition is one extra
provider call per run (or zero where the identity comes from config)

**Constraints**: no `sql.raw` (ADR-084), Zod at config boundaries
(ADR-095), importer packages depend only on `core` (ADR-065), no
dependency additions for stub importers (identity comes from config, not
new SDKs), stored `externalId` rewrites only on live adoption — never
batch-rekey of ambiguous records

**Scale/Scope**: 8 importer packages + `packages/core` contract additions +
`packages/backend` upsert/migration + ADR-120 + 8 importer guides; no
frontend, no REST API surface changes

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Verdict | Notes |
|---|---|---|
| I. Single-Organization | PASS | `sourceKey` is a deployer-supplied config value, not tenancy |
| II. Importer-First | PASS | Importers stay pull-only generators; identity reporting uses the existing `ImporterContext` surface; no DB access, no backend imports |
| III. Two-Level Taxonomy | PASS | No category/provider/`resourceType` changes |
| IV. Environment-as-Instance | PASS | Instance model unchanged; `sourceDetails` is membership metadata, not an env field |
| V. Factual vs. Meaning | PASS | No importer-declared edges; `sourceDetails` is factual metadata |
| VI. Test-First | PASS | tasks.md orders failing tests before each implementation slice; `validateDiscoveredAsset` exercised per importer |
| VII. Observability | PASS | Reuses run logger; new events (source report, legacy adoption, backfill) logged through existing structured logging |

**Gate result: PASS — no violations, no complexity justifications needed.**

Post-design re-check: PASS — design introduces no new principle pressure;
`sourceDetails` remains factual metadata (V), identity acquisition stays
inside the pull-only generator contract (II).

## Project Structure

### Documentation (this feature)

```text
specs/045-importer-source-migration/
├── plan.md              # This file
├── research.md          # Phase 0 — decisions + alternatives
├── data-model.md        # Phase 1 — entities and migration semantics
├── contracts/           # Phase 1 — identity keys, asset contract, migration rules
│   ├── source-identity-keys.md
│   ├── asset-contract-changes.md
│   └── migration-rules.md
├── quickstart.md        # Phase 1 — validation scenarios
├── checklists/requirements.md
└── tasks.md             # Phase 2 — /speckit-tasks output
```

### Source Code (repository root)

```text
packages/
├── core/src/
│   ├── contracts/discovered-asset.ts     # + sourceDetails on asset + instance
│   ├── contracts/importer-source.ts      # unchanged (identity input exists)
│   ├── importer-registry.ts              # manifest docs only (flag exists)
│   ├── utils/source-identity.ts          # + qualifyExternalId / legacy variants
│   └── index.ts                          # export new utils/types
├── backend/src/
│   ├── services/import-run-service.ts    # legacy-fallback adopt match; membership.details wiring
│   ├── services/importer-source-service.ts # adoption/backfill helpers if needed
│   └── db/migrations/023_source_backfill.ts  # defensible Source+membership backfill
├── agent/src/executor.ts                 # no protocol change — verify report passthrough
└── importer-*/src/
    ├── config.ts                         # + optional sourceKey where needed (aws, k8s, mcp, azure)
    ├── importer.ts (and helpers)         # early identity acquisition + reportSourceIdentity + externalId qualification
    └── manifest.ts                       # reportsSourceIdentity: true

docs/importers/<name>.md                  # ×8 — identity key + migration notes
researches/adrs/ADR-120-*.md              # new — Wave B contract ratification
researches/architecture-decisions.md      # index update + amends lists
researches/docker-importer-implementation-tracking.md  # Phase 2 checkboxes
docs/roadmap.md                           # Shipped + Next update
```

**Structure Decision**: existing pnpm-workspace layout; the feature touches
`core` (contract + utils), `backend` (upsert + one migration), and all 8
importer packages symmetrically. `packages/agent` needs no code change —
the protocol v3 `source.identity` frame from spec 044 already carries
remote reports; implementation verifies passthrough in tests.

## Phase 0 → research.md

Resolved decisions (full rationale + alternatives in `research.md`):

1. **Per-importer identity keys** — GitHub: canonical base URL + `org.id`
   (fetched at run start); AWS: `sourceKey` (stub — no SDK);
   Azure: `subscriptionId` else `sourceKey`; Alibaba: existing
   `getCallerIdentity().accountId`; Kubernetes: canonical `endpoint` else
   `sourceKey`; api-url/web-url: canonical `config.url`; MCP: canonical
   `endpoint` else `sourceKey`.
2. **`sourceKey`** — optional scope key added to the four config schemas
   that can lack derivable identity (aws, kubernetes, mcp-server, azure);
   generic contract, documented in ADR-120 and each guide.
3. **externalId qualification** — `{canonicalIdentity}::{nativeId}` prefix
   applied only where the native ID is not globally unique (aws, k8s,
   mcp-without-endpoint legacy form, azure `default:` case, GitHub GHES,
   Alibaba non-ARN fallback); globally-unique forms unchanged.
4. **Continuity = adopt-on-report** — executor falls back to the
   unqualified legacy form when the qualified lookup misses, matching
   only rows with no membership from the reporting Source; on match it
   updates `externalId` to the qualified form and creates the membership.
   Unreported rows are never rekeyed.
5. **Membership details** — `DiscoveredAsset.sourceDetails` →
   `source_component_memberships.details`;
   `DiscoveredAssetInstance.sourceDetails` →
   `source_instance_memberships.details`; `asset.details` keeps writing
   canonical `components.details`.
6. **Backfill** — migration 023 creates Sources + memberships for
   components/instances last seen by a live config whose identity is
   derivable from its scope (azure `subscriptionId`, api/web `url`,
   mcp `endpoint`, alibaba `endpoint`+`account`? — see migration-rules
   contract); historical `import_runs.sourceId` stays `NULL` (those runs
   never reported identity); ambiguous records stay
   `LEGACY_UNATTRIBUTED`.
7. **ADR fidelity** — new ADR-120 ratifies the per-importer identity-key
   table, `sourceKey`, the qualification format, adopt-on-report
   semantics, `sourceDetails`, and backfill defensibility rules;
   back-pointers added to ADR-056/ADR-119 where they present the asset
   contract/importer boundary as closed.
8. **No REST/agent-protocol changes** — existing `/importer-sources`
   endpoints and the protocol v3 frame cover the surface; `openapi.yaml`
   only changes if plan-stage review finds a needed endpoint (none
   expected).

## Phase 1 → data-model.md, contracts/, quickstart.md

- `data-model.md` — membership/details semantics, adoption lifecycle,
  backfill entity flow.
- `contracts/source-identity-keys.md` — the per-importer key table +
  canonicalization rules (ADR-120's contract text).
- `contracts/asset-contract-changes.md` — `sourceDetails` field,
  qualification format, adopt-on-report matching.
- `contracts/migration-rules.md` — defensible-backfill rules per importer.
- `quickstart.md` — runnable scenarios proving US1–US5.
