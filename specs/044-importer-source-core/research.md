# Phase 0 Research — ImporterSource Core

**Feature**: 044-importer-source-core | **Date**: 2026-10-31

The contract surface is already ratified (ADR-119 + amendments to
ADR-035/036/037/047/056/065/077/116). This document resolves the
*implementation-level* unknowns the ratified text leaves open, and flags
the enumerated surfaces that still need ratification in the same change
(spec FR-014 / AGENTS.md ADR-fidelity rule).

## Decision 1 — Config↔Source binding lives on the Source

**Decision**: `importer_sources.boundConfigId uuid NULL → importer_configs
ON DELETE SET NULL`. Rebind-on-report: when a run reports an identity whose
Source is unbound or bound to a different config, `boundConfigId` is updated
to the reporting config.

**Rationale**: "One active config binds one Source" is a property of the
Source — a single nullable column enforces it trivially, and `SET NULL`
gives free unbinding on config delete (the service transitions status to
`UNMONITORED` in the same transaction). Rebind-on-report implements
ADR-119's "replacing or recreating a config can reattach" without a
separate binding API.

**Alternatives considered**: `importer_configs.sourceId` — rejected: the
binding is only knowable after a run reports identity, and source-side
exclusivity would need a partial unique index plus a second write.

## Decision 2 — Identity uniqueness is scoped to the importer

**Decision**: `UNIQUE(importerName, externalIdentity)` on
`importer_sources`.

**Rationale**: Provider-native keys are only canonical within their
provider — two providers could produce identical strings (spec edge case).
The run's `importerName` is always known at report time, so scoping is
free.

## Decision 3 — Two membership tables, never polymorphic

**Decision**: `source_component_memberships` and
`source_instance_memberships`, each
`(id uuid PK, sourceId → importer_sources, entityId → entity ON DELETE
CASCADE, active bool, details jsonb NULL, firstSeenInRunId,
lastSeenInRunId, createdAt, updatedAt)` with
`UNIQUE(sourceId, entityId)`.

**Rationale**: ADR-048 — typed junction tables, no polymorphic edges.
`details jsonb` carries source-specific metadata (ADR-119 item 4); shared
canonical facts stay on `components.details`/`component_instances.rawConfig`
(the existing `processAsset` upsert fields are unchanged).

**Alternatives considered**: one `memberships` table with a discriminator —
rejected per ADR-048.

## Decision 4 — "Effective-active" membership = row active AND source not RETIRED

**Decision**: The sharing union is computed over
`membership.active = true AND source.status IN ('ACTIVE','UNMONITORED')`.
Explicit `RETIRED` removes the Source's claims from the union **without
deleting or flagging membership rows** — making retirement reversible with
zero data loss. The retire/reactivate transitions run the same entity
evaluation as reconciliation: entities with zero remaining effective-active
memberships retire (`Component.lifecycle=RETIRED`, non-`GONE` instances
`GONE`); reactivation restores the union and entities return only through
the normal report/upsert path (which already flips `lifecycle`/`status`
back on match — `processAsset` update branch).

`UNMONITORED` memberships keep counting: deleting a config must not mark
its last-known inventory gone.

**Rationale**: Directly satisfies "retire-one vs retire-last" verification
while keeping RETIRED fully reversible, per ADR-119 item 2.

**Ratification**: Refines ADR-119's lifecycle semantics → **ADR-119
Amendment 1**.

## Decision 5 — `LEGACY_UNATTRIBUTED` is `sourceId IS NULL`

**Decision**: Pre-feature and non-adopting runs keep `sourceId = NULL`;
read surfaces render null as legacy/unattributed provenance. No sentinel
row, no backfill.

**Rationale**: ADR-119 item 9 — never auto-assign on guesswork. A null FK
is unambiguous and costs nothing; a sentinel Source row would acquire
membership semantics it can't honor.

**Alternatives considered**: sentinel `LEGACY_UNATTRIBUTED` Source row —
rejected: fake provenance is worse than explicit absence.

## Decision 6 — Adoption is manifest-declared, enforced fail-closed

**Decision**: `ImporterManifest` gains optional
`reportsSourceIdentity?: boolean`. For flagged importers:
`context.reportSourceIdentity(identity)` must be invoked before the first
asset yield; an asset (or generator completion) arriving with no identity
reported fails the run with `errorType = CONTRACT_VIOLATION`. Unflagged
importers keep the legacy unattributed path untouched (Wave B sets the flag
per importer).

`reportSourceIdentity` and `resolveTarget` become **required** members of
`ImporterContext`; the ~10 test `makeContext` helpers get updated.

**Rationale**: A manifest flag is the only way to distinguish "adopting
importer that forgot" (contract violation) from "not-yet-migrated importer"
(legacy path) — required by spec FR-002/FR-013 edge case.

**Ratification**: New manifest surface → **ADR-056 Amendment 2**.

## Decision 7 — Remote identity transport is a new `source.identity` frame; protocol v3

**Decision**: New agent→hub job-stream frame
`source.identity { runId, externalIdentity, label? }` — emitted by the
agent-side `reportSourceIdentity` implementation. Hub handler
(`RemoteRunHandler.onSourceIdentity`) performs the same
register-or-match/bind/stamp work as the in-process callback. The agent
executor enforces ordering for flagged manifests (fail the job before any
`asset.batch` if the generator yields without reporting). Hub stamps
`import_runs.sourceId` on frame receipt.

`AGENT_PROTOCOL_VERSION` 2 → 3 (frame set is enumerated; hello parity makes
the bump the honest signal — agents are already rebuilt lockstep).

**Rationale**: The identity must travel independent of assets (empty
inventories) and land before membership stamping; piggybacking on
`asset.batch`/`run.complete` can't express "empty but reachable". A
dedicated frame is the minimal honest extension.

**Ratification**: New frame + version bump + NACK addition → **ADR-116
Amendment 6**.

## Decision 8 — Target registry: `<importerName>-targets.json`, envelope-validated

**Decision**: Agent loads `${SECRETS_DIR}/{importerName}-targets.json`
**fresh per `job.assign`** when the manifest declares `targetRefKey`.
Envelope: `{ "version": 1, "targets": { "<targetId>": { "transport": string,
...profileFields } } }`. Agent validates: file parses, `version === 1`,
`targets` is an object, requested `targetId` exists, profile is a
well-formed object. Transport-specific fields are validated by the importer
(the typed profile contract is per-adopter; Docker's is Wave C).

Failures NACK `job.ack{accepted:false, reason:"TARGET_RESOLUTION_FAILED:
…"}` — new `AGENT_NACK_TARGET_RESOLUTION_PREFIX`; hub maps it to run
`FAILED/TARGET_RESOLUTION_FAILED` (new branch in the NACK mapping, not the
`AGENT_INCOMPATIBLE` fallthrough). Missing/corrupt registry = empty
allowlist = fail closed; the Agent stays up.

`resolveTarget(targetId)` on the agent context returns the already-resolved
profile object (preflight resolved it before `job.ack`). The **in-process**
context provides a stub that throws — manifests declaring `targetRefKey`
are agent-bound by definition (Docker is agent-only), and ADR-116 Amendment
5 puts the registry on the Agent only.

`loadJob`/`jobGate` gains a hub-side fail-fast check: manifest declares
`targetRefKey` but `scope[targetRefKey]` is absent/not a non-empty string →
run fails `TARGET_RESOLUTION_FAILED` before enqueue (mirrors the
`missingSecretKeys` precedent).

**Ratification**: NACK prefix + registry convention + protocol bump →
**ADR-116 Amendment 6**; in-process stub behavior → **ADR-056 Amendment 2**.

## Decision 9 — Source-scoped reconciliation is a second path, not a rewrite

**Decision**: `processAsset` and `reconcileRetiredComponents` branch on
`run.sourceId`:

- **sourceId set (adopting run)** — upsert memberships on every processed
  asset (component + instance), `active=true`, `lastSeenInRunId=run`.
  Phase-1: deactivate this Source's absent *instance* memberships on the
  touched component, then recompute instance `GONE` over the
  effective-active union. Phase-2 (COMPLETED only): deactivate this
  Source's absent *component* memberships (+cascade instance memberships),
  recompute `RETIRED`/`GONE` per affected entity over the union. No
  early-return on empty yield — an empty adopting inventory deactivates all
  its memberships.
- **sourceId null (legacy run)** — byte-identical current behavior
  (config-scoped `lastSeenInRunId` subquery, empty-yield early return,
  per-component orphan sweep).

**Rationale**: FR-013's zero-drift guarantee is only credible if the legacy
path is literally the same code path; branching keeps it untouched.

## Decision 10 — Source API surface

**Decision**: `routes/importer-sources.ts` (per-domain file precedent):

| Route | Auth | Notes |
|---|---|---|
| `GET /importer-sources` | verifySession | list: identity, importerName, status, boundConfig summary, lastCompletedRunAt, active membership counts |
| `GET /importer-sources/:id` | verifySession | detail + bound config + last complete run |
| `GET /importer-sources/:id/runs` | verifySession | run history for the source — this is how orphan (configId NULL) runs stay reachable |
| `POST /importer-sources/:id/retire` | `importer:source:retire` (ADMIN) | sets RETIRED + retire-side entity evaluation + audit |
| `POST /importer-sources/:id/reactivate` | `importer:source:reactivate` (ADMIN) | clears RETIRED → ACTIVE if bound else UNMONITORED; audit |

New error codes: `SOURCE_NOT_FOUND` (404), `SOURCE_STATE_CONFLICT` (409 —
retire on RETIRED, reactivate on non-RETIRED). New permissions per
naming precedent `<domain>:<noun>:<verb>`.

**Ratification**: endpoints + error codes → **ADR-119 Amendment 1**;
permissions → **ADR-054 Amendment 2**.

## Decision 11 — History-survives reads get left joins

**Decision**: `agent-service.ts listAgentRuns` (config inner join for
`configLabel`) and `dashboard-service.ts` FAILED_RUN attention join become
`leftJoin` with null-tolerant labels. `ImportRun.configId: string | null`
in core contract + `api/types.ts` (frontend mapper already tolerates;
`view-types.ts` already optional). `useRunChanges`-style nested run routes
stay config-scoped — orphan runs are read via `/importer-sources/:id/runs`.

## Resolved NEEDS CLARIFICATION (from Technical Context)

- Language/Deps/Storage/Testing: TypeScript 6, Fastify + Kysely,
  PostgreSQL, Vitest + testcontainers — all existing stack, no additions.
- One new runtime dependency: **none** — registry loading is `fs` +
  `JSON.parse` + a core-side Zod envelope schema (node-only export path,
  precedent `@componode/core/secrets`).

## Docs touched (Phase-1+ obligations)

`docs/openapi.yaml` + `pnpm docs:api` (ADR-104), `docs/agent-protocol.md`,
`docs/agents.md` (registry provisioning under SECRETS_DIR),
`docs/deployment.md` (same), `docs/importer-development.md`
(`reportSourceIdentity`/`targetRefKey` contract for future importers),
`CONTEXT.md` if new canonical terms land (`LEGACY_UNATTRIBUTED` already
exists — verify).
