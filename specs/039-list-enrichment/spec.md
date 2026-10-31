# Feature Specification: List Enrichment — Component Health/Last-Seen + Team Member Counts

**Feature Branch**: `039-list-enrichment`

**Created**: 2026-10-31

**Status**: Draft

**Input**: Gap-registry items G21 and G22 (`researches/ux-rewrite-gaps.md`). The UX conformance pass (spec 038) shipped flag-gated columns that render nothing because the list endpoints omit the underlying data. This spec ships the backend capability so the flags can flip ON and the fallback copy comes down.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Components list shows real health and last-seen data (Priority: P1)

An operator scanning the components catalog sees a per-row `Health` badge (worst status across that component's instances) and a `Last seen` timestamp — the two columns the prototype designed and the spec-038 UI already renders behind `componentListHealth`/`componentListLastSeen`. Today both columns are flag-hidden because `GET /components` omits `instances` and `lastSeenAt`.

**Why this priority**: Health is the primary scanning value of the catalog list; a permanently dead column is worse than no column. The flag scaffolding is already in place — the missing piece is a per-row rollup in the list payload.

**Independent Test**: `GET /components` returns per-row `worstStatus` and `lastSeenAt` (computed from `component_instances.status`/`lastSeenAt`); the list renders real badges/timestamps with the flags ON and no "No data"/"—" for rows that have instances.

**Acceptance Scenarios**:

1. **Given** a component with instances in mixed states (RUNNING + ERROR), **When** the list renders, **Then** the Health cell shows the worst status (`ERROR`) with the correct tone.
2. **Given** a component with zero instances, **When** the list renders, **Then** the Health cell renders the defined empty fallback (not a fabricated badge).
3. **Given** a component whose newest `instance.lastSeenAt` is yesterday, **When** the list renders, **Then** the `Last seen` cell shows that timestamp via `RelativeTime`.
4. **Given** the flags ON, **When** `GET /components` is called, **Then** the response includes `worstStatus` and `lastSeenAt` per row without a second request per row (no N+1).

### User Story 2 - Teams list shows real member counts (Priority: P1)

An admin scanning the teams list sees a `Members` count per row — the column the spec-038 UI renders behind `teamMemberCounts`. The same count feeds the LOB detail teams table (`Team | Members | Components` columns).

**Why this priority**: Membership is the primary distinguishing data of a team row; a permanently "—" column is worse than no column. The gap-registry entry (G22) scopes the need to `memberCount` on `GET /teams` and LOB detail reads.

**Independent Test**: `GET /teams` returns `memberCount` per row (count of `team_members` rows for the team); the teams list and LOB detail teams table render real numbers with the flag ON.

**Acceptance Scenarios**:

1. **Given** a team with 4 members, **When** the teams list renders, **Then** the Members cell shows `4` (tabular, right-aligned per the spec-038 column).
2. **Given** a team with 0 members, **When** it renders, **Then** the cell shows `0` (a real zero, not the "—" flag-off fallback).
3. **Given** the LOB detail page, **When** its teams table renders, **Then** the `Members` column shows the same counts (no second per-row fetch).
4. **Given** the flags ON, **When** `GET /teams` is called, **Then** `memberCount` is present per row (single aggregate query, no N+1).

---

### Edge Cases

- A component with only `GONE` instances: `worstStatus` reports `GONE` (it's an observed status, not filtered out — the list opt-in already controls row visibility separately).
- A component with instances but all `lastSeenAt` null (e.g. agent-reported rows that never heartbeated): `Last seen` renders the empty fallback, never a fabricated timestamp.
- RETIRED components/teams still return the enrichment fields — filtering is orthogonal to the rollup.
- `worstStatus` ordering: `ERROR > GONE > STOPPED > RUNNING` (matching the health rollup semantics already used by `HealthBadge`/product health derivation — verify against `HEALTH_META` at plan time).
- The `componentCount` column the spec-038 LOB-teams table also flag-gates (`flags.teamMemberCounts`) is **not** in this spec's scope unless it falls out of the same query — if the teams payload gains `memberCount` only, the `Components` column stays flag-gated on the same flag (verify at plan time whether a cheap count is available).
- Importer `lastRun` is **already wired** from `DashboardSummary.lastRuns` (spec 038) — G21 covers it only if that join proves insufficient; verify at plan time and scope out if the existing wiring holds.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `GET /components` MUST return per-row `worstStatus` (the worst `component_instances.status` across that component's instances, using the documented severity order) and `lastSeenAt` (the max `component_instances.lastSeenAt`), computed in the same query (no per-row N+1).
- **FR-002**: A component with zero instances MUST return `worstStatus: null` and `lastSeenAt: null` — the frontend renders its defined empty fallback, never a fabricated badge.
- **FR-003**: `GET /teams` MUST return `memberCount` per row (count of `team_members` for the team), computed in the same query.
- **FR-004**: The LOB detail teams read MUST carry the same `memberCount` so the detail table shows real counts without a second fetch.
- **FR-005**: The frontend MUST flip `componentListHealth`, `componentListLastSeen`, and `teamMemberCounts` to `true` and remove the flag-off fallback rendering (empty cell/— for components with instances) — the columns then render real data for rows that have it and the honest empty state for rows that don't.
- **FR-006**: The two flag-gated component columns and the teams `Members` column MUST render the same data the v0 prototype designed (badge tone from `HEALTH_META`, `RelativeTime` for last-seen, tabular count) — no new presentation work beyond wiring the now-live fields.
- **FR-007**: The gap-registry entries G21 and G22 MUST be marked resolved (flag flipped, spec number recorded) per the gap-governance rule in `docs/ux.md` §7.

### Key Entities

- **`component_instances`**: source of `worstStatus` (worst of `status` across a component's instances) and `lastSeenAt` (max `lastSeenAt`).
- **`team_members`**: source of `memberCount` (count per `teamId`).
- **Flag off-ramps (removed)**: `componentListHealth`, `componentListLastSeen`, `teamMemberCounts` in `ux/lib/flags.ts` — flipped ON and their fallback rendering deleted, or the flags removed entirely if they were only ever the off-switch.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The components list renders a real `Health` badge and `Last seen` timestamp for every row that has instances — zero permanently-dead cells.
- **SC-002**: The teams list and LOB detail teams table render real `memberCount` — zero "—" for teams that have members.
- **SC-003**: `GET /components` and `GET /teams` each perform a single aggregate query (no per-row N+1) — verified by the list-endpoint integration test or query inspection.
- **SC-004**: G21 and G22 are closed in `researches/ux-rewrite-gaps.md` (flags flipped/removed, spec recorded); `flags.ts` has no new unconsumed keys.
- **SC-005**: Frontend and backend suites stay green; each shipped field has a regression/integration test.

## Assumptions

- The v0 prototype's list columns (`Health`, `Last seen`, `Members`) are the design target; `docs/ux.md` wins conflicts.
- The spec-038 UI code (columns + flag gates + badge/timestamp rendering) is the consumer — this spec is backend-data + flag-flip only, no new UX surface.
- The importer `lastRun` wiring shipped in spec 038 (from `DashboardSummary.lastRuns`) is assumed sufficient; G21 covers it only if plan-time verification proves otherwise.
- `worstStatus` severity order is the one already used by the health rollup (`HEALTH_META` / product-health derivation) — ratified order, not invented here.
