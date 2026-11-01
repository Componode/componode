# Research: Docker Source Health Observations and ImporterSource UI

**Feature**: `047-docker-source-health` | **Date**: 2026-11-01

Phase 0 research consolidating codebase findings and design decisions.
Anchors: ADR-112 (derived product health), ADR-119 (ImporterSource
identity/lifecycle), ADR-121 (Docker importer), ADR-104 (OpenAPI sync),
`researches/docker-importer-spec-waves.md` Wave D.

## R1 — `dockerObservation` payload shape

**Decision**: a self-contained, allowlisted object nested inside the
existing `component_instances.rawConfig` jsonb — no migration, no
contract change to `DiscoveredAssetInstance.rawConfig` (already
`Record<string, unknown>` and already persisted verbatim at
`import-run-service.ts:462`).

```text
rawConfig.dockerObservation = {
  state: string,                    // engine State.Status verbatim
  exitCode?: number,                // State.ExitCode when non-zero
  oomKilled?: boolean,              // State.OOMKilled when true
  restarting?: boolean,             // State.Restarting flag when true
  startedAt?: string | null,        // zero-time normalized like deployedAt
  finishedAt?: string | null,
  health: {                         // null when no healthcheck configured
    status: "healthy" | "unhealthy" | "starting",
    failingStreak?: number,         // State.Health.FailingStreak
  } | null,
}
```

**Rationale**: self-contained means the observation answers "why is this
failing?" without correlating sibling keys; explicit `health: null`
represents "no healthcheck" instead of a fabricated value (spec US2-2).
`State.Health.Log` is never read — it carries check output and the test
command, both on the exclusion list.

**Alternatives considered**: (a) flattening health fields into existing
top-level `rawConfig` — rejected: duplicates state/exitCode handling and
loses the named provenance boundary the wave mandates. (b) storing the
last-N health checks — rejected: "never live history" is explicit.

## R2 — Health-aware status table

**Decision**: engine state decides first, then OOM, then health degrade:

| `State.Status` | `OOMKilled` | `Health.Status` | `InstanceStatus` |
|---|---|---|---|
| running | — | healthy / starting / none | `RUNNING` |
| running | — | unhealthy | `ERROR` |
| running | true | any | `ERROR` |
| created / paused / exited | — | any | `STOPPED` |
| created / paused / exited | true | any | `ERROR` |
| dead / restarting / removing / unknown | any | any | `ERROR` |
| absent from completed run | — | — | `GONE` (existing reconciliation) |

**Rationale**: `starting` is inconclusive, not failure — the container is
running and the check is inside its start period. `OOMKilled` is a
failure signal regardless of the polite `exited` state Docker reports.
Everything else is the Wave C mapping carried forward (ADR-121 item 7);
`exited` non-zero exit codes stay `STOPPED` per Wave C semantics —
exit-code failure classification is not part of this wave.

**Contract impact**: replaces ADR-121 item 7's engine-state-only rule →
ADR-121 **Amendment 1** ratifies this table + the R1 allowlist in the
same change (ADR fidelity).

## R3 — ImporterSource UI placement

**Decision**: a `/sources` + `/sources/$id` route pair, added as a third
item under the existing **"Sources"** nav section
(`ux/lib/nav.ts:57-62`, which already groups Importers + Import agents),
mirroring the agents surface end-to-end: `agents/index.tsx` →
`agents-view` + `agents-table` (`ListToolbar` search + status filter,
clickable rows) and `agents/$id.tsx` → tabbed `agent-detail`.

**Rationale**: Source detail needs multiple panels (identity/bound
config, run history, memberships, audit activity, lifecycle actions) —
the tabbed detail pattern fits; `/sources` is deep-linkable and scales
past this wave (e.g. per-source membership drill-down). Reads are
`verifySession`-only (all roles); retire/reactivate buttons are gated
with `canAccess(role, "ADMIN")`.

**Alternatives considered**: a `?tab=sources` tab on the importers index
(suggestions.tsx precedent) — rejected: detail still needs its own
route+tabs anyway, and a buried tab hides provenance UI the wave calls
out as a first-class operations surface.

## R4 — Tag-suggestion derivation source

**Decision**: derive `compose:<project>` and `service:<project>.<service>`
candidates from `components.details` (`composeProject`/`composeService`,
written by `buildAsset` — `importer-docker/src/mapping.ts:187-197`),
surfaced through `ComponentWithInstances.details` → `mapComponent` →
view type. Candidates are filtered with core `tagSchema`
(`^[a-z0-9][a-z0-9._:-]{0,31}$`), deduped against existing tags, and
rendered as `Badge`+accept chips under `TagsInput` in the edit dialog —
confirmation-only, no auto-write, invalid values omitted.

**Rationale**: the component detail wire already carries `details`; the
frontend mapper just drops it today. Shared `details` is
last-writer-wins across Sources, but for *suggestions* a stale compose
value still yields a valid, user-confirmed tag — no correctness hazard.

**Alternatives considered**: reading `SourceComponentMembership.details`
per-source — rejected: requires a new component-scoped membership read
endpoint (contract surface + API work) for zero suggestion-quality gain.

## R5 — Observation rendering

**Decision**: extend the existing Instances table on
`UxComponentDetailPage` (`component-detail.tsx:64-107`) — each instance
row gets an expandable detail section rendering the allowlisted
`dockerObservation` fields via `DescriptionList`/`MonoValue`/`HealthBadge`
primitives. Requires adding `rawConfig` to
`api/types.ts ComponentInstance`, `view-types.ts`, and
`mapComponentInstance` — the wire already carries it (`selectAll` at
`component-catalog-service.ts:264-272`).

**Alternatives considered**: a dedicated per-instance page or a Docker
monitoring view — rejected explicitly by the spec/wave.

## R6 — OpenAPI/documentation sync

**Decision**: document the `instances` array + a `ComponentInstance`
schema (including `rawConfig`) on `GET /components/{id}` in
`docs/openapi.yaml` — the response already returns it undocumented; this
change makes the surface we now depend on honest (ADR-104 spirit).
No route/permission changes — the enforced contract-test surfaces
(route coverage, `x-permission`, `security`) are untouched.
`docs/importers/docker.md` gains the observation/status sections (FR-008).

## R7 — ADR fidelity scope

**Ratified in the same change** (ADR-121 Amendment 1): the R1
`dockerObservation` field allowlist and the R2 state×health→status
table — both replace/extend surfaces ADR-121 presents as closed
(items 7–9).

**Stays in plan** (inside ratified boundaries): Source UI layout,
tag-suggestion derivation and value grammar, observation rendering —
in-memory/presentation mechanics with no contract-surface change. No new
API endpoints, error codes, env vars, or permission sets are added.

## R8 — What does NOT change

- Backend services: `rawConfig` passthrough, source-scoped GONE
  reconciliation, ImporterSource API, RBAC — all already correct.
- `computeProductHealth` / `computeHealthForProducts` — consumes
  `component_instances.status` verbatim; a Docker `ERROR` flows through
  automatically (verified by a new backend integration test).
- Importer plumbing: inspect already fetches full `State` — only the
  `ContainerInspect` type and mapping need new fields.
- `packages/agent`: no protocol change — assets stream verbatim.
