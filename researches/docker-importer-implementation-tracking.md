# Docker Importer — Implementation Tracking

**Status:** Unnumbered tracking document. This file sequences the approved
strategy across spec-kit sessions; it is not a spec, plan, or executable
`tasks.md`. Implementation authority always comes from the generated
`specs/{NNN-feature-name}/` artifacts, never from this file.

**Design inputs (approved):**

- [docker-importer-research.md](./docker-importer-research.md) — Docker API facts
- [docker-importer-plan.md](./docker-importer-plan.md) — confirmed decisions and contracts
- [docker-importer-scenarios.md](./docker-importer-scenarios.md) — verification scenarios
- [docker-importer-spec-waves.md](./docker-importer-spec-waves.md) — dependency-ordered waves A–E
- [docker-importer-hub-execution_research.md](./docker-importer-hub-execution_research.md) — accepted Hub execution design and primary-source analysis (grilling complete)

**Execution note:** each numbered spec below is intended to run through
`speckit-auto` end-to-end (specify → clarify → plan → tasks → implement →
converge → PR). Run one spec at a time; do not interleave waves.

---

## Phase 0 — ADR ratification (before any numbered spec)

**Status: shipped in spec `043-importer-source-adrs`** — ratified
2026-10-31. Precedes Wave A. Ratify in the same change set, per AGENTS.md
§ ADR fidelity — no contract surface may live only in a spec artifact.

- [x] New ADR for durable `ImporterSource` identity and lifecycle
      (`ACTIVE`/`UNMONITORED`/`RETIRED`, one active config per Source,
      explicit reversible retirement) — **ADR-119**.
- [x] Amend **ADR-036**: source-scoped Component/Instance reconciliation,
      durable source memberships, retirement transaction — Amendment 1;
      **ADR-037** gained a matching Amendment 1 (commit strategy
      unchanged).
- [x] Amend **ADR-056**: source identity reporting before asset yield
      (including empty inventories), target resolver, `targetRefKey` on
      `ImporterManifest` — Amendment 1.
- [x] Review/amend the ADR owning `ImportRun` history and config deletion:
      `ImportRun.sourceId` durable, `configId` nullable with
      `ON DELETE SET NULL` — **ADR-047** Amendment 1 + **ADR-077**
      Amendment 2.
- [x] Amend **ADR-116**: Agent-local target registry
      (`${SECRETS_DIR}/docker-targets.json`), allowlist preflight, typed
      target resolver, target security model — Amendment 5.
- [x] Amend **ADR-065**: importer package lockstep for the eventual
      `@componode/importer-docker` in hub and Agent — Amendment 1
      (contract-first).
- [x] Review **ADR-106** / **ADR-117** where Agent target egress and
      Agent-managed credential boundaries intersect — recorded "no change
      needed" in ADR-119; also ADR-038 reviewed, unchanged.
- [x] Update `researches/architecture-decisions.md` index and add
      `**Amended by ADR-XXX**` back-pointers on every amended ADR.

## Phase 1 — Generic ImporterSource core (Wave A)

- [ ] Numbered spec for: `ImporterSource` entity, source-identification
      callback, one-config-per-Source binding, `ImportRun.sourceId` +
      nullable `configId`, durable Source→Component/Instance memberships,
      source-scoped reconciliation and retirement, generic Agent target
      resolver/preflight contract, best-effort legacy handling.
- [ ] Verification: two-source shared Component, no cross-source GONE,
      retire-one vs retire-last, empty inventory registers Source, config
      deletion preserves Source + run history.

## Phase 2 — Staged migration of existing importers (Wave B)

- [x] Per-importer provider-native source identity keys documented and
      implemented in explicit waves.
- [x] `LEGACY_UNATTRIBUTED` preservation; no auto-split/merge/rekey.
- [x] Backfill source memberships only where run/config provenance is
      defensible.

## Phase 3 — Docker Engine workload inventory (Wave C)

- [x] `@componode/importer-docker` package; lockstep registration in
      core, backend, agent.
- [x] Target profiles: socket/named pipe, mutual-TLS TCP, pinned-host-key
      SSH, allowlisted named Docker Context.
- [x] `CONTAINER` Component per logical workload; one Component Instance
      per concrete container; canonical project/service identity +
      `componode.component-id` override.
- [x] Redacted bind mounts, safe network/volume refs, image ref/digest.
- [x] User guide `docs/importers/docker.md` (index + sidebar links).

## Phase 4 — Docker observations and Source UI (Wave D) — SHIPPED (047)

- [x] `rawConfig.dockerObservation` allowlisted snapshot; `InstanceStatus`
      mapping per the plan's status table. (spec 047, ADR-121 Amendment 1)
- [x] Generic ImporterSource list/detail/lifecycle UI in Importers
      operations area. (`/sources` + `/sources/:id`, spec 047)
- [x] User-confirmed `compose:`/`service:` tag suggestions (32-char
      grammar; omit invalid, never truncate or auto-write). (spec 047)

## Phase 5 — Swarm inventory (Wave E) — SHIPPED (048)

- [x] Auto-discovery via `/info` + `ControlAvailable`; API v1.41+ with
      `/version` negotiation, `ServiceStatus` via `status=1`. (spec 048, ADR-121 Amendment 2)
- [x] `CONTAINER_ORCHESTRATION` per logical service + aggregate Instance;
      `COMPUTE` Nodes; metadata-only `SECRET` Secrets; Configs as
      references only.
- [x] Manager-reported counts only — no per-task health inference.

---

## Phase 6 — Hub execution and managed Docker targets (HANDOFF READY; NOT STARTED)

**Status:** The design was grilled and accepted on 2026-11-01. No spec,
ADR, schema, API, UI, or source implementation for this phase has been
created. This section is a handoff/tracking aid only; the generated
`specs/{NNN-feature-name}/tasks.md` remains the implementation authority.

**Design input:** [Hub execution research](./docker-importer-hub-execution_research.md)
contains the current architecture map and repository citations.

### Accepted design

- Hub and Import Agent execution both remain supported. Hub mode supports
  all four existing transports where its runtime permits them, and the full
  Wave C/D/E inventory. The default Compose deployment does not mount the
  host Docker socket. Docker no longer declares `requiresAgent`; preserve
  that generic manifest capability for importers that truly remain
  Agent-only.
- Hub target profiles are Docker-specific database records; Agent target
  profiles remain in the existing Agent-local file registry. Profiles use
  strict typed JSONB, contain no secret values, and are not sent over the
  Agent protocol. Importer scope carries only the selected `targetId`, never
  a raw endpoint or credential.
- A target row has a UUIDv7 database ID plus a separate, immutable,
  Hub-unique `targetId` string (1-200 characters). `label` and `description`
  are editable. Transport, endpoint, pin, and `*Key` reference changes
  require a new `targetId`.
- Hub credentials remain `STORED` and linked to each importer config;
  Agent credentials remain `AGENT_MANAGED`. Hub config save/update validates
  profile key coverage against linked stored credentials. Switching
  executor clears both target selection and credential selection.
- One importer config targets one Docker Engine. A target profile may be
  reused by multiple configs; the existing `ImporterSource` provider
  identity and rebind-on-report behavior remains authoritative.
- New Docker configs default to Hub. Existing Agent-bound configs stay
  Agent-bound. Hub configs select a target from the Admin-managed list;
  Agent configs retain the local `targetId` field.
- Targets have enabled/disabled lifecycle. Disabled targets remain visible,
  cannot be newly selected, tested, or run, and may not be deleted while any
  config references them. Unrelated edits to a config retaining a disabled
  target remain allowed; re-enabling restores its use.
- Config create or target-changing update to a disabled target returns
  `409 TARGET_DISABLED`. A run triggered for a target disabled after save
  is retained as `FAILED/TARGET_DISABLED`. Disabling requests cancellation
  of active Hub runs and tests; the disable response does not wait for
  in-flight Docker calls to drain.
- Target tests perform only Docker `/version` and use a selected Hub config
  as the stored-credential context. Disabled-target tests return a failed,
  audited result without network access.
- Run cancellation uses the existing `CANCELLED` state plus an optional
  controlled `cancelReason` (`USER_REQUESTED` or `TARGET_DISABLED`). The
  reason is part of the ImportRun API and renders as neutral cancellation
  text, not as a run error.
- Admin-only target CRUD, lifecycle, and test actions use dedicated
  `importer:target:*` permissions. Human changes and test outcomes are
  written to append-only `entity_changes`, with safe non-secret route
  details, and appear in the existing Activity feed.
- A Docker Engine ID remains the Source identity across executors. A
  different Engine ID yields a different Source; the previous Source
  becomes `UNMONITORED` and is not automatically retired.

### Speckit-auto handoff

Recommended unit of work: one end-to-end feature, candidate
`049-docker-hub-execution`. Hub target CRUD and Hub execution are coupled:
shipping the target manager without a working run path would be an unusable
partial feature. Confirm the next free sequential number and branch before
starting.

The next session should:

1. Confirm the next free feature number and candidate branch name from
   `specs/` and `.specify/init-options.json`; `049-docker-hub-execution` is
   the current candidate. Create/switch to that designated feature branch
   before making ADR changes, so no work lands on `main`.
2. Ratify the ADR change set and back-pointers on that branch before creating
   the feature spec, per AGENTS.md Research Workflow. If `speckit-auto` would
   select a different branch/number, stop and reconcile the sequence first.
3. Invoke `speckit-auto` for the single end-to-end feature, using this
   tracking phase and the research document as input. Its clarify stage
   should settle the listed contract details before plan/tasks are treated
   as final.

Do not use this tracking file or the research memo in place of generated
`specs/` artifacts. Implementation authority remains the feature's
`spec.md`, `plan.md`, and `tasks.md`; ADRs own the durable decisions.

**Suggested feature brief:** Enable the existing Docker importer to execute
on either the Hub or an Import Agent. Add Hub-managed Docker target records
and an ADMIN-only management UI/API, while leaving Agent profiles in their
local registry. Reuse the existing target profile and transport model; keep
one target per config and provider-native Docker Engine identity per Source.
Hub execution uses `STORED` credentials linked to the importer config;
Agent execution remains `AGENT_MANAGED`. Add Hub target selection and
save-time validation, disable/enable/delete-in-use behavior, target testing,
and disable-triggered cancellation with auditable reasons. Preserve full
container/image/health/Swarm inventory behavior and source-scoped
reconciliation. Do not mount the Docker socket by default. Update all
affected ADRs, OpenAPI/API docs, Docker setup/deployment docs, and tests.

### Proposed ADR change map

**Preferred ratification shape:** a new ADR (candidate **ADR-122**; verify
the next free ADR number) for the Hub-managed target boundary and dual
executor. It should list each amended ADR, add back-pointers, and update
`researches/architecture-decisions.md`. If planning determines an item is
only a refinement of an existing closed decision, append the appropriate
Amendment there instead; do not leave the contract solely in `research.md`,
`spec.md`, or `plan.md`.

| ADR | Handoff change |
|---|---|
| ADR-121 | Amend the Docker Agent-only rule to Hub-or-Agent execution; retain source/asset semantics and transport allowlists; add Hub target records, `TARGET_DISABLED`, and disabled-target cancellation. |
| ADR-056 | Replace the in-process `resolveTarget` stub for Hub-bound target importers; pass the preflight-resolved target to Hub `testSecrets`. Agent resolution remains unchanged. |
| ADR-116 | Add the Hub database-backed allowlist beside the existing Agent-local registry; clarify executor-local `targetId`; no Agent wire-protocol change. |
| ADR-119 | Amend the Agent-only target-profile statement to executor-local target routing; keep `ImporterSource` identity and source-scoped reconciliation unchanged. |
| ADR-058 | Add the optional `ImportRun.cancelReason` contract and target-disable cancellation behavior. Stamp `USER_REQUESTED` or `TARGET_DISABLED` with the cancellation request so recovery can preserve the reason; the Agent cancel frame stays unchanged. |
| ADR-052 | Add the `docker_target` audit entity and enumerated create/update/enable/disable/delete/test actions; record safe profile snapshots in the same transaction as mutations. |
| ADR-054 | Add `importer:target:read|create|update|delete|test`, all ADMIN by default. |
| ADR-071 | Add controlled HTTP error `TARGET_DISABLED` (409) for config assignment/update conflicts. Run `errorType` remains its existing free-form field. |
| ADR-077 | Add the `docker_targets` table/model (UUIDv7 row ID, unique immutable `targetId`, mutable display metadata, typed profile JSONB, enabled state, actor/timestamps). |
| ADR-104 | No ADR change; update `docs/openapi.yaml`, generated `docs/api.md`, and route/permission contract tests for every new endpoint. |
| ADR-098 | Resolve the existing `node:fs` import in Docker Context resolution before enabling it in the Hub. Prefer executor-side resolution that preserves the importer boundary; ratify a narrow exception only if the plan requires one. |

**Expected no-change decisions:** ADR-022 (the in-process Hub worker already
exists), ADR-028 (no default socket mount), ADR-065 (Docker is already in the
Hub/Agent lockstep set), ADR-107/ADR-117 (credential kinds and secret
boundaries stay unchanged), ADR-120 (Docker identity is unchanged), and
ADR-090 (existing secret-redaction rules remain binding).

### Contract details for speckit-clarify / plan

These are implementation-contract choices not explicitly fixed by the
grilling; record their answers in the generated spec/contracts and ratify
any new closed surface before implementation:

- Exact API paths and request/response schemas for target list/detail/create,
  display-metadata update, enable/disable, test, and delete.
- The delete-in-use conflict code (recommend `TARGET_IN_USE`, HTTP 409),
  target-ID collision behavior, and whether target labels may be duplicated
  (recommend unique `targetId`; labels may duplicate and the UI shows both
  label and `targetId`).
- The target-test request's config selector (recommend required Hub config
  reference when the profile names secret keys; permit no-config tests only
  when no secret keys are needed).
- Whether Hub named Context resolution honors `DOCKER_CONFIG` or uses the
  current `~/.docker` convention, and how the executor resolves Context
  files without violating ADR-098.
- The exact disabled-target conflict behavior for test/run APIs and the
  typed `cancelReason` representation. Keep synchronous config writes at
  409 `TARGET_DISABLED`, run attempts in run history as
  `FAILED/TARGET_DISABLED`, and target tests as failed probe results.

### Verification plan

| Area | Required checks |
|---|---|
| Profile schema and persistence | Strict JSONB profile parsing for `socket`, mTLS `tcp`, pinned `ssh`, and named `context`; reject unknown/insecure fields; UUIDv7 row IDs; unique 1-200 character `targetId`; immutable route/key-reference fields; mutable label/description; profile contains no certificate/private-key values. |
| Target service and CRUD API | ADMIN-only list/read/create/update/enable/disable/test/delete; reject delete while any config references the target; audit every human mutation/test atomically; audit names resolve in the existing feed; OpenAPI permission and route contract tests stay green. |
| Config validation and form | Hub configs require an active target; reject Hub target key references not covered by linked `STORED` credentials; socket/context profiles work without a credential; Agent configs continue to use Agent-local IDs and `AGENT_MANAGED`; switching executor clears target and credential selections; unrelated edits to a config with a disabled target remain possible. |
| Hub run and credential test | Resolve profile before network access; use Hub `STORED` credentials; pass `resolvedTarget` into `testSecrets`; test calls only `/version`; missing/malformed/disabled target cannot issue Docker requests; missing profile key returns `CREDENTIAL_MISSING_KEY` at save time. |
| Disable and cancellation | Disable prevents new target selection, run, and test; a triggered run is recorded `FAILED/TARGET_DISABLED`; an in-flight Hub run is cancelled as `CANCELLED` with `cancelReason: TARGET_DISABLED` stamped at cancellation request; an in-flight test resolves as a failed `TARGET_DISABLED` probe; re-enable permits existing config to run again; manual Hub/Agent cancellation uses `USER_REQUESTED`; restart recovery preserves stored reasons. |
| Docker inventory parity | For each transport supported by the Hub runtime, verify Hub and Agent emit equivalent containers, opt-in images, `dockerObservation`, and Swarm surfaces; every importer asset still passes `validateDiscoveredAsset`; tests use mocked Dockerode/transport fixtures rather than external infrastructure. |
| Source/reconciliation | Same `/info.ID` through Hub and Agent maps to the same Source; no cross-source `GONE`; changing to a different Engine ID creates/rebinds the new Source while the old one becomes `UNMONITORED`, not implicitly retired; a failed or cancelled run performs no reconciliation retirement. |
| Frontend and docs | Test target manager, disabled-target state, Hub picker vs Agent text field, target-test config selection, neutral cancellation-reason text on run detail/history, and audit labels; update `docs/importers/docker.md`, `docs/deployment.md` if setup changes, `docs/openapi.yaml`, generated `docs/api.md`, importer index/sidebar, and UX docs as needed. |
| Deployment/security | Default Compose has no Docker socket mount; test documented opt-in socket access with non-root `componode`; verified mTLS, pinned SSH, Context restrictions, no endpoint fields in importer scope, and no secret values in audit/log/API output. |
| Regression | Existing Agent enrollment, Agent-local registry, credential tests, run cancellation, Docker Source lifecycle, health behavior, and Swarm behavior remain green; run backend audit-coverage, API-doc contract, source reconciliation, and frontend importer-form suites. |

Useful existing suites include `packages/backend/test/integration/docker-import.test.ts`,
`config-agent-binding.test.ts`, `credential-kind-binding.test.ts`,
`credential-test-endpoint.test.ts`, `credential-test-remote.test.ts`,
`audit-coverage.test.ts`, `audit-feed-names.test.ts`,
`importer-sources.test.ts`, and `source-reconciliation.test.ts`;
`packages/backend/test/unit/api-docs-contract.test.ts`;
`packages/importer-docker/test/{importer,context-store,transport,swarm}.test.ts`;
`packages/agent/test/{executor,credential-test}.test.ts`; and
`packages/frontend/src/test/unit/importer-form-scope.test.tsx`.

### Phase 6 completion gate

- The designated spec's `tasks.md` implements the complete Hub path without
  changing the Agent-local target contract or default Compose socket access.
- All ADR amendments/new ADR, architecture index entries, and back-pointers
  are committed with the implementation.
- OpenAPI, generated API docs, Docker setup guide, audit labels, roadmap, and
  required user-facing setup instructions are current.
- Backend, importer, Agent regression, and frontend verification pass; no
  profile secret material appears in logs, audit details, or API responses.
- `speckit-converge` reports no missing tasks; the review loop is clean.

---

## Numbering and housekeeping

- Spec numbers are sequential (`.specify/init-options.json`); the highest
  current feature spec is `048-docker-swarm-inventory`, so `049` is the
  candidate next number — but confirm the next free number from `specs/`,
  `.specify/init-options.json`, and `.specify/feature.json` when starting.
- **Never reuse `038`.** `038-ux-11-conformance` owns that number; the
  empty `specs/038-docker-importer/` directory is left intentionally
  and may be removed separately.
- `.specify/feature.json` currently points at
  `specs/048-docker-swarm-inventory`; it is machine-local and ignored.
  `speckit-specify` repoints it per feature — keep it on the in-flight spec.
- On each spec's completion, update `docs/roadmap.md` (**Shipped** +
  revised **Next**) per AGENTS.md roadmap sync.
- Each wave follows `docs/importer-development.md` requirements:
  core-only importer deps, manifest/config schema, `testSecrets`,
  AbortSignal, `validateDiscoveredAsset` tests, backend integration
  tests, OpenAPI sync for any route/contract change.

> **Wave A follow-up (from spec-044 review)**: ~~FR-006's per-source
> `details` columns exist but are written `null`; `asset.details` still
> last-writer-wins shared `components.details`. Wave B must split
> asset-supplied details into canonical vs per-source fields and populate
> membership `details`~~ — **resolved in spec 045**: `sourceDetails` on
> `DiscoveredAsset`/`DiscoveredAssetInstance` now populate
> `source_component_memberships.details`/`source_instance_memberships.details`
> (alibaba-cloud is the reference emitter); canonical `details` stays shared
> (ADR-120 item 4).
