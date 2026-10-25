# Feature Specification: Importer Run Aggregates

**Feature Branch**: `031-importer-run-aggregates`

**Created**: 2026-10-24

**Status**: Draft

**Input**: User description: "Resolve ux-rewrite gap G1 — per-day importer
run aggregates. The importer card sparkline and importer-detail history
chart need counts of runs per day over a window. Today only the full run
list exists; client-side aggregation over it does not scale. Add a
per-config aggregates endpoint returning per-day buckets (runs by
terminal status, assets created/updated), wire both flagged surfaces,
flip historyAggregates on, and mark G1 resolved by this spec."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Operator sees run trends at a glance (Priority: P1)

An operator scanning the importers list or a config's detail page sees a
per-day bar chart of recent run outcomes and asset volume — without the
client downloading every run row. Days with no runs appear as zero-height
bars inside the window.

**Why this priority**: The flagged sparkline/detail chart is the entire
gap — it ships hidden today because the API offers no aggregate. This is
the MVP.

**Independent Test**: call the aggregates endpoint for a config with
several runs across multiple days and verify per-day counts match the
underlying run rows; render the card with the flag on and see bars.

**Acceptance Scenarios**:

1. **Given** a config with runs on multiple days, **When** the caller
   requests its aggregates for a window covering them, **Then** each day
   in the window returns run counts split by status plus asset
   created/updated totals matching the run rows.
2. **Given** a window boundary, **When** runs exist outside it, **Then**
   they are excluded from every bucket.
3. **Given** a config with no runs in the window, **When** aggregates are
   requested, **Then** the response is a valid empty series (not an
   error).
4. **Given** no session, **When** the endpoint is called, **Then** 401.

---

### User Story 2 - Both flagged surfaces render real data (Priority: P2)

The importer card sparkline (14 days) and the importer-detail history
chart render live aggregates instead of the "lands with the aggregates
endpoint" fallback.

**Why this priority**: Ships the visible value of P1; separable because
the endpoint alone already satisfies the API contract.

**Independent Test**: with the flag on, the card renders `RunHistory`
bars from live data and the detail page's history chart fills.

**Acceptance Scenarios**:

1. **Given** the flag on and a config with run history, **When** the
   importers list renders, **Then** the sparkline shows per-day bars and
   no fallback notice.
2. **Given** the importer detail page, **When** its history section
   loads, **Then** it renders the aggregates series rather than the
   hidden/fallback state.

---

### Edge Cases

- **Window param**: out-of-range or non-numeric `days` is clamped or
  rejected per validation rules; a documented default applies when
  omitted.
- **Timezone bucketing**: day buckets follow the run's stored ISO date
  (UTC day) — consistent with `createdAt` ordering used elsewhere.
- **In-flight statuses**: PENDING/RUNNING runs count in their own bucket
  key — they are not forced into terminal buckets.
- **Deleted/missing config**: the endpoint returns an empty series or
  404 consistent with sibling routes' conventions.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A read-only aggregates endpoint MUST return per-day
  buckets for one importer config over a caller-selected day window:
  run counts by status and summed `assetsCreated`/`assetsUpdated`.
- **FR-002**: The window MUST be bounded (e.g., `days` query param with
  a documented default and max) and exclude runs outside it.
- **FR-003**: Aggregation MUST happen server-side (SQL), not by fetching
  the full run list — per-row cost must not scale with history length.
- **FR-004**: The endpoint MUST be authenticated and consistent with
  sibling run routes' posture (verifySession, no new permission).
- **FR-005**: Both flagged surfaces (card sparkline, detail history
  chart) MUST consume the endpoint via a typed hook; `historyAggregates`
  flips on and fallbacks retire.
- **FR-006**: `docs/openapi.yaml` + regenerated `docs/api.md` in the same
  change (ADR-104); gap registry marks G1 resolved.

### Key Entities

- **ImportRun**: existing rows aggregated — `status`, `createdAt`,
  `assetsCreated`, `assetsUpdated` per `configId`. No schema change.

## Success Criteria *(mandatory)*

- **SC-001**: Aggregates for a seeded multi-day history match the run
  rows 100% (status counts + asset sums per day).
- **SC-002**: Response payload size is O(window days), not O(run rows) —
  a 30-day window over thousands of runs returns ≤31 buckets.
- **SC-003**: Zero client-side fetch of the full run list to render the
  chart (verified by hook path only).
- **SC-004**: 100% of unauthenticated calls rejected; no new permission
  introduced.

## Assumptions

- Day buckets are ISO/UTC calendar days — same convention as `createdAt`.
- Chart needs (from view-types): `{day, created, updated, failed}` — the
  endpoint returns richer buckets; the client maps them.
- `sql` template expressions for day-bucketing stay parameterized (ADR-084).
