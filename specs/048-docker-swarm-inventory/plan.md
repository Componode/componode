# Implementation Plan: Docker Swarm inventory (Wave E)

**Branch**: `048-docker-swarm-inventory` | **Spec**: `specs/048-docker-swarm-inventory/spec.md` | **Status**: Ready for tasks

## Summary

Extend `@componode/importer-docker` (Wave C/D surfaces already shipped)
to auto-discover Swarm on manager endpoints and emit three new asset
surfaces — `CONTAINER_ORCHESTRATION` services (one aggregate Instance
with replica-derived status + `swarmObservation`), `COMPUTE` nodes
(status-bearing Instance), and metadata-only `SECRET` secrets — gated
entirely on the already-fetched `docker.info()` response and the
existing agent-bound `resolveTarget` path. No new endpoints, no new UI,
no schema changes; ADR-121 gains Amendment 2 ratifying the mappings,
status tables, observation allowlist, and the v1.41 API floor.

## Technical Context

**Language/Version**: TypeScript (pnpm workspaces, lockstep `@componode/*`)
**Primary Dependencies**: dockerode (`@types/dockerode@4.0.2`), `@componode/core` only — importer boundary (ADR-065)
**Storage**: existing `rawConfig`/`details`/`sourceDetails` fields — no migration
**Testing**: Vitest unit (mocked `dockerode` class — extend with `listServices`/`listNodes`/`listSecrets`) + backend integration (`getImporter` mock pattern)
**Target Platform**: agent-side execution via `resolveTarget`/`buildDockerOptions` — unchanged
**Project Type**: single-package importer extension

**Performance Goal**: one extra `listServices`/`listNodes`/`listSecrets`/`version` call per Swarm run (sequential, bounded); zero extra calls on non-Swarm endpoints
**Constraints**: manager-report only — never per-task inspect; strict allowlists per Wave C/D minimization precedent
**Scale/Scope**: single source per run; Swarm sizes bounded by manager list calls

## Constitution Check

| Principle | Gate | Status |
|---|---|---|
| Test-first (VI) | mapping/status tests before impl per story | PASS — planned |
| Importer deps (ADR-065) | core-only imports | PASS — dockerode + core only |
| ADR fidelity | new contract surfaces (swarm entities, status table, observation, API floor) ratified in ADR-121 Amendment 2 | PASS — planned |
| Minimization (Wave C/D posture) | allowlisted observation; no task inspect/logs/contents | PASS — contract enforced |
| Source-scoped reconciliation | reuse existing engine source (`docker-engine:{ID}`) | PASS |
| Side-effect-free GETs / no new endpoints | none added | PASS |

## Project Structure

### Documentation (this feature)

```text
specs/048-docker-swarm-inventory/
├── spec.md              # 10 FRs, 5 stories, edge cases (done)
├── plan.md              # this file
├── research.md          # Phase 0 — API floor, dockerode surface, design decisions
├── data-model.md        # Phase 1 — entity mappings + identity formats
├── contracts/
│   └── swarm-inventory.md # Phase 1 — allowlists, status tables, discovery contract
└── quickstart.md        # Phase 1 — validation guide
```

### Source Code (repository root)

```text
packages/importer-docker/src/
├── importer.ts          # swarm gate after reportSourceIdentity; /version floor check;
│                        # listServices/listNodes/listSecrets → map → yield
├── swarm.ts             # NEW — SwarmService/Node/Secret types + mappers (mirrors mapping.ts)
├── mapping.ts           # unchanged (container surfaces)
└── types/types stay local (dockerode Swarm responses are `any`)
test/                    # importer.test.ts + new swarm.test.ts; dockerode mock extended

packages/backend/test/integration/docker-import.test.ts
                        # + swarm asset persistence/status/rollup cases

researches/adrs/ADR-121-docker-importer.md   # Amendment 2
docs/importers/docker.md                     # Swarm sections
researches/docker-importer-implementation-tracking.md  # Phase 5 → [x]
docs/roadmap.md                              # Shipped + Next
```

## Phase 0 — Research (`research.md`)

Resolved unknowns: Docker API Swarm surface (v1.24 services / v1.30
secrets / v1.41 `status=1`), dockerode typings, node-status table,
identity formats, gate semantics, global-mode counts.

## Phase 1 — Design (`data-model.md`, `contracts/`, `quickstart.md`)

Key decisions:

1. **Gate = info only.** `docker.info()` is already fetched for engine
   identity; extend the cast with `Swarm.{LocalNodeState,ControlAvailable}`.
   Swarm surfaces run iff `LocalNodeState==="active" && ControlAvailable===true`.
   Non-Swarm endpoints make zero additional calls.
2. **Version floor v1.41** (`status=1` → `ServiceStatus`), checked via
   `docker.version()` only when Swarm detected; below floor → coded
   error, run fails visibly (fail-before-network precedent).
3. **Separate `swarm.ts` mapper module** mirroring `mapping.ts`
   conventions — local response interfaces (dockerode returns `any`),
   `swarmObservation` key (distinct from `dockerObservation` — different
   schema, different producer surface).
4. **Service identity** = source + service `Spec.Name` (already
   `stackname_servicename` for stacks → namespace distinctness free);
   instance externalId = source + service `ID` (survives rename → new
   component, preserves no-edge-transfer rule).
5. **Replica status table** (replicated + global alike):
   `desired>0 && running===desired → RUNNING`; `desired>0 && running<desired → ERROR`;
   `desired===0 → STOPPED`; absent → `GONE` (existing reconciliation).
6. **Node status table**: `ready` + `active` → RUNNING;
   `drain`/`pause` availability → STOPPED (intentional);
   `down`/`disconnected`/unreachable/unknown → ERROR; removed → `GONE`.
7. **Secrets**: `SECRET` component, `instances: []`, bounded metadata
   (`Version.Index` = revision) — contents never touched.
8. **Secrets/config references** on service details: bounded
   `{id,name}` pairs only.

## Complexity Tracking

No constitution violations — nothing to track.
