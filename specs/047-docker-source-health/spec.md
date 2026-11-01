# Feature Specification: Docker Source Health Observations and ImporterSource UI — Wave D of the Docker importer program

**Feature Branch**: `047-docker-source-health`

**Created**: 2026-11-01

**Status**: Draft

**Input**: Phase 4 / Wave D of the Docker importer program (`researches/docker-importer-implementation-tracking.md`, `researches/docker-importer-spec-waves.md`): persist allowlisted Docker state and latest health-check facts under `ComponentInstance.rawConfig.dockerObservation`; map source status into the existing `InstanceStatus` enum with health-aware behavior (health, no health check, starting, exited, restarting, OOM, GONE) and verify the ADR-112 rollup on human-wired Products; reuse the existing Component Instance status badge and last-seen view — no Docker-specific monitoring page; add a generic ImporterSource list/detail and lifecycle controls in the Importers operations area (identity, bound config, last complete run, `UNMONITORED`/`RETIRED` state, reattach, explicit retire); and surface Compose project/service values as optional, user-confirmed `compose:`/`service:` tag suggestions in the Component edit flow (invalid/overlong suggestions omitted, never truncated or auto-written).

## Clarifications

### Session 2026-11-01

- Q: Should the allowlisted `dockerObservation` snapshot be rendered on the Component Instance detail view, or stored as API-only provenance? → A: Render on instance detail — show the allowlisted observation fields (engine state, health status/facts) on the existing detail view; no new page.
- Q: What value should user-confirmed `service:` tag suggestions carry — bare Compose service name or project-qualified? → A: Project-qualified — `service:<project>.<service>` so the tag uniquely identifies the Compose service.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Health-aware instance status for containerized workloads (Priority: P1)

An operator opens a containerized workload's Component Instance and sees an operational status that reflects what the Docker daemon actually reports — not just "the engine says it's running." A container whose health check is failing shows as failed/degraded; a container that is still starting shows as running but distinguishable in its observation; an exited container shows stopped; a restarting, dead, or OOM-killed container shows as failed; and a container absent from the next complete run retires to gone. Products a person wired to depend on that Component roll up degraded health the same way they do today.

**Why this priority**: This is the headline value of the wave — Wave C deliberately shipped engine-state-only status, so every unhealthy-but-running container in the catalog currently presents as healthy. Until this lands, the imported inventory misleads the people relying on it.

**Independent Test**: seed containers covering each state/health combination (healthy, unhealthy, starting, no health check, exited, restarting, OOM-killed, absent on next run) → the catalog shows the correct status for each, and a wired Product's health rollup degrades when an Instance goes unhealthy.

**Acceptance Scenarios**:

1. **Given** a running container with a passing health check, **When** it is imported, **Then** its Instance status is `RUNNING`.
2. **Given** a running container whose health check reports unhealthy, **When** it is imported, **Then** its Instance status is `ERROR` — not `RUNNING`.
3. **Given** a running container whose health check is still in its start period, **When** it is imported, **Then** its status reflects running-with-starting-health and is not reported as failed.
4. **Given** a running container with no configured health check, **When** it is imported, **Then** its status derives from engine state alone.
5. **Given** an exited, created, or paused container, **When** it is imported, **Then** its Instance status is `STOPPED`; **Given** a restarting, dead, removing, or OOM-killed container, **Then** its status is `ERROR`.
6. **Given** a container present in a prior run but absent from the next complete run, **When** reconciliation runs, **Then** the Instance is `GONE` for that Source only.
7. **Given** a human-declared `DEPENDS_ON` edge from a Product to a Component whose Instance turns unhealthy, **When** product health is computed, **Then** the rollup reflects the degraded status per the existing derived-rollup rules (ADR-112).

### User Story 2 - Allowlisted Docker observation snapshot as provenance (Priority: P1)

Every imported Instance carries a durable record of what the daemon last reported about it — engine state and the latest health-check facts — stored under `rawConfig.dockerObservation` and rendered on the existing Component Instance detail view, so an operator (or a future audit) can answer "why does the catalog say this is failing?" without shell access to the daemon. The snapshot is strictly allowlisted: never `/stats`, events, health-check output, health-check test commands, full inspect JSON, or live/history data.

**Why this priority**: Status without provenance is unanswerable — an `ERROR` badge with no recorded cause forces operators back to the daemon and erodes trust in the catalog. Equal priority with US1: the mapping and the observation are two halves of the same feature.

**Independent Test**: import containers with and without health checks → each Instance's stored observation contains only allowlisted fields (state, health status/facts); excluded data (stats, events, output, test commands, inspect JSON, history) appears nowhere in stored data, logs, or API responses.

**Acceptance Scenarios**:

1. **Given** a container with a health check, **When** it is imported, **Then** `rawConfig.dockerObservation` records the engine state and the latest health-check facts (status and bounded metadata per the allowlist), and those fields are visible on the Instance detail view.
2. **Given** a container without a health check, **When** it is imported, **Then** the observation records engine state and explicitly represents the absence of health data — never a fabricated health value.
3. **Given** a container whose health check has output/logs and a configured test command, **When** it is imported, **Then** neither the output nor the command appears anywhere in stored data, logs, or API responses.
4. **Given** a rebuilt container producing a new Instance, **When** the next run completes, **Then** the new Instance carries its own observation and the retired Instance's observation is not carried forward.
5. **Given** a data-minimization audit of imported Instances, **When** stored rows, API payloads, and logs are inspected, **Then** zero `/stats` data, event data, health output, test commands, full inspect JSON, or live/history series appear.

### User Story 3 - ImporterSource visibility and lifecycle controls in the Importers area (Priority: P2)

An operator opens the Importers operations area and sees every registered ImporterSource — its provider-native identity, which importer produced it, the config currently bound to it, its lifecycle state (`ACTIVE`/`UNMONITORED`/`RETIRED`), and its last completed run. From a Source's detail they can inspect run history and membership counts, explicitly retire a Source that should stop contributing to the catalog, reactivate a retired one, and understand how an `UNMONITORED` Source gets fed again (a config reporting the same identity reattaches on its next run — rebind-on-report, never manual matching).

**Why this priority**: Sources are already durable, security-relevant provenance records with a complete API — but invisible. Retirement is an operator control over catalog content; making it reachable is the other half of this wave's value. P2 because it is operations-facing and the underlying API already exists and works.

**Independent Test**: with at least one `ACTIVE`, one `UNMONITORED`, and one `RETIRED` Source → the list renders all three with correct state; detail shows identity, bound config, last complete run, run history, and memberships; retire and reactivate round-trip through the existing API; an `UNMONITORED` Source becomes `ACTIVE` again when a config reporting the same identity completes a run.

**Acceptance Scenarios**:

1. **Given** registered ImporterSources in each lifecycle state, **When** the operator opens the Sources list, **Then** each row shows provider identity, importer, bound config (or unbound), lifecycle state, and last complete run.
2. **Given** a Source detail view, **When** it is opened, **Then** it shows identity details, the bound config, recent runs, and membership counts — with `UNMONITORED`/`RETIRED` state clearly explained.
3. **Given** a Source the operator wants to exclude, **When** they confirm retire, **Then** the Source becomes `RETIRED` and stops contributing to catalog queries per the existing source-lifecycle rules.
4. **Given** a `RETIRED` Source, **When** the operator reactivates it, **Then** it returns to `ACTIVE` (bound) or `UNMONITORED` (unbound) per its config binding.
5. **Given** an `UNMONITORED` Source and a config pointed at the same provider identity, **When** that config completes a run, **Then** the Source reattaches automatically and the UI reflects the restored binding — Sources are never matched by display name or manual selection.
6. **Given** a deployment with no registered Sources, **When** the list is opened, **Then** a clear empty state explains what Sources are and when they appear.

### User Story 4 - User-confirmed Compose tag suggestions in the Component edit flow (Priority: P2)

When an operator edits a Component that carries Compose project/service values from a Docker Source, the edit dialog offers them as optional tag suggestions (`compose:<project>`, `service:<project>.<service>` — project-qualified so the tag uniquely identifies the Compose service). Accepting a suggestion adds the tag to the Component's tag list; declining or ignoring it changes nothing. Suggestions that do not fit the tag grammar (invalid characters or too long) are simply never offered — never truncated to fit, never written without the user's confirmation.

**Why this priority**: Compose metadata is already imported as details; turning it into tags makes workloads filterable/groupable in the catalog with one click instead of manual retyping. P2 because it is a convenience layer on an already-working edit flow, and independent of the Source/health work.

**Independent Test**: import a Compose workload, open its Component in the edit dialog → `compose:`/`service:` suggestions appear; accept one → the tag is added; import a workload whose project name is tag-invalid or overlong → no suggestion appears and nothing is written.

**Acceptance Scenarios**:

1. **Given** a Component whose Source-reported details include Compose project/service values, **When** the operator opens the edit dialog, **Then** the corresponding `compose:<project>` and `service:<project>.<service>` tags appear as suggestions awaiting confirmation.
2. **Given** displayed suggestions, **When** the operator accepts one, **Then** it joins the Component's tag list and saves with the edit; **When** they decline or close without accepting, **Then** no tags change.
3. **Given** a Compose value that violates the tag grammar or exceeds its length limit, **When** suggestions are computed, **Then** that value produces no suggestion — it is never truncated or auto-written.
4. **Given** a Component already carrying an equivalent tag, **When** suggestions are computed, **Then** the already-present tag is not re-suggested.
5. **Given** a Component with no Compose metadata (standalone container, non-Docker source), **When** the edit dialog opens, **Then** no tag suggestions appear.

### User Story 5 - Operator documentation stays accurate (Priority: P3)

`docs/importers/docker.md` (and any related reference) reflects what the importer now persists — the `dockerObservation` snapshot, the health-aware status rules, and which fields are collected vs. excluded — and the Source UI's behavior (reattach-via-rebind, retire/reactivate) is documented where operators look for it.

**Why this priority**: AGENTS.md makes an importer change without a guide update incomplete — but it delivers no runtime behavior, so P3.

**Independent Test**: read the updated guide → the observation fields, status rules, and exclusion list match implemented behavior; Source lifecycle behavior is documented consistently with the UI.

**Acceptance Scenarios**:

1. **Given** the shipped guide, **When** an operator reads the observation/status sections, **Then** every documented field and rule matches the implementation.
2. **Given** the Source UI, **When** an operator checks the documented lifecycle behavior, **Then** reattach/rebind-on-report, retire, and reactivate behave as written.

---

### Edge Cases

- Health check `starting` → the container is running but health is inconclusive; the observation records the starting state and status is not failed for it — the exact mapping is ratified with the status table at plan.
- Health check present but reporting no checks yet (zero-count log) → treated as no usable health data; observation records the absence explicitly.
- Container states outside the enumerated set (e.g. `removing`, unknown future states) → fail closed to `ERROR`, matching the Wave C precedent.
- A Source whose bound config is deleted mid-view → next read shows `UNMONITORED`; the UI must not offer lifecycle actions that contradict the server's state.
- Retire while a run is in-flight on that Source → the existing source-lifecycle rules govern; the UI confirms the intent and reflects the resulting state on refresh.
- Two configs alternately reporting the same source identity → rebind-on-report means the latest reporter is bound; the UI shows the current binding, never invents a manual binding.
- Compose values that are valid strings but tag-invalid (uppercase, spaces) or that produce an overlong tag once prefixed/qualified (`compose:<project>` or `service:<project>.<service>` exceeding 32 chars) → silently omitted from suggestions.
- Compose values differing only in case vs. an existing tag → grammar already lowercases-rejects; no dedup collision.
- Component shared by a Docker Source and a non-Docker Source → suggestions derive only from the Docker-reported values.
- Observation payload growth → fields stay bounded per the allowlist; no time-series/history arrays accumulate across runs.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Each Docker-imported Component Instance MUST persist an allowlisted observation snapshot under `rawConfig.dockerObservation` containing the daemon-reported engine state and the latest health-check facts (health status plus bounded metadata per an explicit field allowlist decided at plan and ratified if it extends the contract surface), and the allowlisted fields MUST be rendered on the existing Component Instance detail view. The system MUST NOT persist or log `/stats` output, event streams, health-check output/logs, health-check test commands, full container inspect JSON, or any live/history series.
- **FR-002**: Instance status MUST be health-aware for Docker-sourced Instances: a failing health check MUST degrade the status to `ERROR`; starting-health MUST NOT be reported as failed; no-health-check MUST fall back to engine state alone; `exited`/`created`/`paused` map `STOPPED`; `restarting`/`dead`/OOM-killed and unrecognized states map `ERROR`; absence from a completed run maps `GONE` through source-scoped reconciliation. The exact state×health→status table is a plan artifact ratified per the ADR fidelity rule.
- **FR-003**: Health-aware status MUST flow through the existing presentation and derivation surfaces — the Component Instance status badge and last-seen view, and the ADR-112 derived health rollup on human-declared `DEPENDS_ON` edges. No Docker-specific monitoring page, dashboard, or status enum is added.
- **FR-004**: The Importers operations area MUST gain a generic ImporterSource list showing, per Source: provider-native identity, producing importer, bound config (or unbound), lifecycle state, and last completed run — covering all importers that report source identity, not only Docker.
- **FR-005**: A Source detail view MUST show identity details, the bound config, recent run history, membership counts, and lifecycle state with an explanation of `UNMONITORED`/`RETIRED`.
- **FR-006**: Source lifecycle controls MUST cover explicit retire (with confirmation) and reactivate via the existing API; `UNMONITORED` reattach MUST be surfaced as an explanation + config path (a config reporting the same identity rebinds on its next run) — no manual bind-by-name UI, and Sources are never matched by display name.
- **FR-007**: The Component edit flow MUST offer `compose:<project>` and `service:<project>.<service>` (project-qualified) tag suggestions derived from Source-reported Compose project/service values, gated on user confirmation; suggestions violating the tag grammar or length limit MUST be omitted entirely — never truncated, never auto-written; already-present tags MUST NOT be re-suggested.
- **FR-008**: `docs/importers/docker.md` MUST be updated to document the observation payload, the health-aware status rules, and the collected-vs-excluded field boundary; Source UI behavior (reattach, retire, reactivate) MUST be documented where importer/operations docs live.
- **FR-009**: Any contract surface touched beyond what ADR-035/036/037/047/056/065/112/113/116/117/119/120/121 and their amendments already ratify — observation field allowlist, status-mapping rules, tag-suggestion derivation source, any API change — MUST be ratified in the same change per the ADR fidelity rule; `docs/openapi.yaml` stays in sync wherever endpoints change (ADR-104).

### Key Entities

- **ComponentInstance (`dockerObservation`)** — one concrete container's durable observation: allowlisted engine state + latest health-check facts under `rawConfig`; feeds health-aware `InstanceStatus`.
- **ImporterSource** — durable provenance record (`ACTIVE`/`UNMONITORED`/`RETIRED`, `boundConfigId`, identity) already exposed over `/importer-sources*`; gains its operations UI.
- **ImportRun** — Source-attributed run history surfaced on Source detail (`sourceId` durable, `configId` nullable).
- **Source memberships** — durable Source→Component/Instance records; surfaced as counts on Source detail; unchanged as the reconciliation unit.
- **Component tags** — operator-curated `string[]` under the existing tag grammar (`^[a-z0-9][a-z0-9._:-]{0,31}$`, max 20); `compose:<project>` / `service:<project>.<service>` suggestions are proposed values, never silent writes.
- **Source membership details** — per-Source metadata (including Compose project/service values reported in Wave C) that feeds tag-suggestion derivation.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of the enumerated state×health combinations (healthy, unhealthy, starting, no health check, exited, restarting/dead/OOM, absent-on-next-run) produce the specified `InstanceStatus` — verified by tests exercising every row of the status table.
- **SC-002**: A human-wired Product's derived health degrades when a depended-on Component's Instance turns unhealthy — verified end-to-end through the existing rollup.
- **SC-003**: Zero excluded data (`/stats`, events, health output, test commands, full inspect JSON, history) appears in stored rows, API payloads, or logs — verified by a data-minimization audit of imported Instances.
- **SC-004**: An operator can complete all Source lifecycle operations from the UI — locate a Source by identity, inspect runs/memberships, retire, reactivate, and observe an automatic reattach — 100% of the four operations without touching the API directly.
- **SC-005**: 100% of tag writes originate from explicit user confirmation; zero invalid/overlong Compose values reach the tag list; zero suggestions are auto-applied — verified across valid, invalid, and duplicate-metadata cases.
- **SC-006**: Lint, typecheck, tests, and build are green across all changed packages; importer unit tests exercise `validateDiscoveredAsset`; `docs/openapi.yaml` stays in sync wherever contract surfaces change.

## Assumptions

- The ImporterSource API (list, detail, runs, memberships, retire, reactivate) shipped in spec 044 and is reused as-is; no new endpoints are expected — any addition updates `docs/openapi.yaml` in the same change.
- "Reattach" is realized through rebind-on-report (ADR-119): the UI explains it and links to the config path rather than offering a manual Source↔config bind; if plan finds that insufficient, it is ratified as a contract change.
- Compose project/service values are already available to the frontend via per-Source membership details populated in Wave C/045; suggestions derive from existing read surfaces rather than a new endpoint where possible.
- The exact `dockerObservation` field allowlist and the full state×health→status table are plan artifacts (ratified via ADR amendment if they extend the contract surface), not spec-level decisions.
- Swarm inventory remains Wave E; Swarm nodes/services are out of scope, and Docker Engine non-Swarm targets are the only emitters of `dockerObservation` in this wave.
- The legacy non-source reconciliation path is untouched; health-aware mapping applies to source-scoped Docker Instances.
