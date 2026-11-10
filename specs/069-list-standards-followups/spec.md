# Feature Specification: Spec-068 follow-ups — e2e spec debt and list-standards cleanup

**Feature Branch**: `069-list-standards-followups`

**Created**: 2026-11-09

**Status**: Draft

**Input**: User description: the full content of
`researches/list-standards-followups.md` — follow-up findings from the
spec-068 review and e2e workload run. Part A: ten reproducible Playwright
failures in `playwright/tests/journeys/product-map.spec.ts` (8) and
`playwright/tests/journeys/component-relationships.spec.ts` (2), all stale
test expectations vs. intentional UI changes that landed on `main` after the
specs were written — none are spec-068 regressions. Part B: eight
Standards-axis judgement calls from the spec-068 code review (B.1–B.8), each
needing a fix / codify / defer decision. The source document allows this to
ship as one spec ("test debt + UX cleanup") or two; this spec takes the
combined option — one feature per run.

## Clarifications

### Session 2026-11-09

- Q: Should this spec cover the full follow-up list — e2e spec debt plus
  all Part-B items including the heavier refactors (B.3, B.1, B.5) — or
  only the e2e debt plus the cheap unifications? → A: Everything — e2e
  debt + all of B.1–B.8 in this spec.
- Q: For the patterns-layer API-type imports (B.1), which resolution
  should the spec mandate? → A: Amend `docs/ux.md` §5 to carve out leaf
  display patterns / type-only entity imports — the flagged imports are
  all `import type` (no runtime coupling), and retrofitting mappers for
  org/docker-target/importer entities is deferred to its own spec.
- Q: For the dual-signature pagination-compat hooks (B.5), which
  resolution should the spec mandate? → A: Migrate remaining legacy
  callers to the `page`/`pageSize` contract and drop the dual signature —
  inventory found only 2 `useSuggestions` positional callers (both
  offset=0) and 1 `useEntityHistory` wrapper, so the silent-clamp shim
  is removed entirely.
- Q: Should the suggestions page's tab state driven by the `?status=`
  list filter (rather than `?tab=`/`useValidatedTab`) be confirmed as
  acceptable, or aligned to the `?tab=` convention? → A: Confirm
  `?status=` is acceptable — the convention rule scopes to detail pages,
  the suggestions "tabs" are a list filter, and URL-state spirit is
  preserved.

## Problem

**E2E signal is broken.** Two journey spec files encode pre-change UI
behavior and fail consistently (10 failures across chromium-desktop and
chromium-narrow), masking real regressions in every full `pnpm e2e` run:

- `product-map.spec.ts` still expects the product topology to render on the
  Dependencies tab and asserts the Map tab does not exist — but commit
  `2f77c56` (prototype visual baseline) added a dedicated Map tab
  (`overview | map | components | dependencies | activity`) and moved
  `<ProductMap>` there. `?tab=map` is now a valid deep link.
- `component-relationships.spec.ts` still expects all seven relationship
  lanes plus `'None'` empty states — but commit `7e33ef2` intentionally hides
  lanes with no data and keeps only the header of lanes whose relation kind
  failed to load.

**Standards debt is entrenched.** The spec-068 diff added or confirmed
several pre-existing patterns that now need a decision: direct API-type
imports in shared patterns (B.1), four spellings of the same 400-validation
failure (B.2), ~12 copies of sort-dispatch ternary chains (B.3), copy-pasted
`"all"`-sentinel → API-param adapters in frontend hooks (B.4), dual-signature
pagination-compat hooks with silent offset clamping (B.5), speculative
generality and an inconsistent type extension (B.6), and a hardcoded
entity-type label map duplicating domain vocabulary (B.7). B.8 (`?status=`
driving suggestions tabs instead of `?tab=`) is a convention question only.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A trustworthy e2e workload (Priority: P1)

A maintainer or CI job runs the Playwright workload (`pnpm e2e`) and gets a
signal that reflects the current UI: the product-map and
component-relationships journeys pass because they assert what the app
actually renders today — topology on the Map tab, only populated
relationship lanes.

**Why this priority**: the failures are consistent, reproduce on `main`, and
train everyone to ignore red runs — the worst kind of test debt. Fixing them
is small and mechanical and restores a clean full-suite signal.

**Independent Test**: run `pnpm e2e` (or a targeted
`playwright test tests/journeys/product-map.spec.ts
tests/journeys/component-relationships.spec.ts`) — all tests pass on every
configured project.

**Acceptance Scenarios**:

1. **Given** a product with topology, **When** the product-map journey
   navigates to the product's Map tab (or `?tab=map`), **Then** the
   `Product topology` heading, all relation families, the inspection panel,
   `+N` expansion, and keyboard operation are asserted there.
2. **Given** the product detail page, **When** the journey checks tab state,
   **Then** the Map tab exists in the tab set and `?tab=map` selects it —
   no assertion that Map is absent or that `?tab=map` redirects to
   Dependencies.
3. **Given** an empty product, **When** the map journey runs, **Then** the
   map's empty state is asserted.
4. **Given** the component-relationships fixture, **When** the journey
   renders the relationships panel, **Then** only the populated lanes
   (`Product dependents` plus the nested Instances block — verified
   against `buildRelationshipFixture`, which populates no
   component-to-component junctions) are expected, the six no-data lanes
   (`Depended on by`, `Sourced by`, `Exposed by`, `Depends on`,
   `Sources from`, `Exposes`) are asserted absent, and no `'None'`
   empty-state text is expected inside hidden lanes.
5. **Given** provenance labels and nested instances, **When** the
   relationships journey runs, **Then** those assertions still pass
   unchanged.

---

### User Story 2 - Cheap unifications land (Priority: P2)

A backend maintainer gets one canonical way to reject invalid input; a
frontend maintainer gets one canonical way to map `"all"`-sentinel filter
values to API params and one debounced-filter hook; reviewers stop seeing
speculative type fields and a duplicated entity-label map.

**Why this priority**: these are small, mechanical, low-risk changes with
clear recommendations in the source document — they remove drift and
copy-paste without architectural risk.

**Independent Test**: each unification is verifiable by inspection +
existing tests — a single shared 400-validation helper used by all routes,
one facet-param helper consumed by all list hooks, one debounced-filter
hook, no speculative `SummaryRowMap` members, `completedAt` on the
`ImportRun` view type, and one entity-type label registry.

**Acceptance Scenarios**:

1. **Given** any backend route rejecting malformed query/body input,
   **When** it responds 400, **Then** the `{code, message, details}`
   envelope is produced by one shared helper with one canonical message —
   no hand-rolled variants remain.
2. **Given** a list page filter set to `"all"`, **When** hooks build API
   params, **Then** the sentinel→param mapping lives in exactly one helper
   used by components, products, activity, and audit hooks.
3. **Given** an activity/audit page needing debounced URL-synced filter
   input, **When** the component renders, **Then** a single shared hook
   provides the behavior.
4. **Given** `SummaryRowMap` and `ImportRun`, **When** the types are read,
   **Then** no speculative "forward-compat" members exist and
   `completedAt` is declared on the view type — no inline intersections at
   call sites.
5. **Given** the activity feed, **When** entity types render labels,
   **Then** labels come from one registry shared with the domain
   vocabulary, and `importer_config` reads consistently with sibling labels
   (e.g. "Importer config").

---

### User Story 3 - Heavier standards refactors (Priority: P3)

Backend services express sort whitelists as auditable data rather than
nested ternaries; shared UI patterns stop importing API contract types
directly; pagination-compat hooks either converge to one signature or keep
their dual signature with defined clamp behavior.

**Why this priority**: real readability and drift wins, but each touches
many files or an API-surface decision — they deserve their own scrutiny and
may reasonably be deferred to a follow-up spec.

**Independent Test**: per-service `Record<SortKey, …>` ordering maps replace
the ternary chains; zero `@/api/types` imports remain in
`ux/components/patterns` (or `docs/ux.md` §5 carries an explicit carve-out);
compat-hook call sites are inventoried and either migrated or documented.

**Acceptance Scenarios**:

1. **Given** any migrated list service, **When** sort handling is read,
   **Then** allowed sort keys and their ordering expressions are declared
   in one map aligned with the endpoint's input whitelist — adding a sort
   key edits one declaration, not N ternary chains.
2. **Given** `title-with-summary.tsx`, `org-tables.tsx`, and
   `docker-targets/index.tsx`, **When** imports are inspected, **Then**
   `docs/ux.md` §5 documents the carve-out permitting type-only entity
   imports in leaf display patterns, and no runtime (value) import of
   `@/api/types` remains in shared pattern components.
3. **Given** `useSuggestions` / `useEntityHistory` compat signatures,
   **When** the remaining legacy callers are migrated, **Then** every
   caller uses the `page`/`pageSize` contract and the dual signature —
   including `normalizeFeedQuery`'s legacy `limit`/`offset` translation —
   is removed, eliminating silent offset clamping.

---

### Edge Cases

- **Map tab deep links**: `?tab=map` must select the Map tab; any legacy
  `?tab=` values must still resolve per the current validated-tab behavior.
- **Empty topology**: a product with no relationships must render the
  map's empty state — the journey asserts whatever `ProductMap` actually
  renders for empty input (verify copy exists before asserting).
- **Lanes whose relation kind failed to load**: per `7e33ef2`, these keep
  their header — the spec should not assert their absence, only that
  no-data lanes are hidden.
- **Compat-hook offset clamp**: resolved by B.5 — the dual signature is
  dropped, so non-aligned `offset`/`pageSize` inputs become a compile-time
  impossibility rather than a runtime clamp; migrated callers map
  `offset=0, limit=N` to `page=1, pageSize=N` with identical results.
- **Unknown sort keys**: endpoints must keep rejecting sort values outside
  the whitelist (the map refactor must not widen acceptance).
- **Rate-limit flakes (A.3)**: the two full-suite-only flakes
  (`github-reconciliation`, `docker-enrichment`) predate `retries: 1` and
  passed on targeted rerun — no new work unless they recur; the shared
  300 req/min per-user limit remains the mechanism.

## Requirements *(mandatory)*

### Functional Requirements

**E2E spec debt (Part A)**

- **FR-001**: `playwright/tests/journeys/product-map.spec.ts` MUST be
  updated so all topology assertions (heading, relation families,
  inspection panel, `+N` expansion, keyboard operation, responsive
  no-overflow, reduced motion) run against the dedicated Map tab via
  `?tab=map` or the Map tab trigger — not `?tab=dependencies`.
- **FR-002**: The same file MUST assert the current tab contract: the Map
  tab exists in the product-detail tab set and `?tab=map` selects it; no
  assertion may require Map's absence or a redirect to Dependencies.
- **FR-003**: The file MUST cover the empty-product map state.
- **FR-004**: `playwright/tests/journeys/component-relationships.spec.ts`
  MUST expect only populated lanes for its fixture, assert the no-data
  lanes absent, and drop `'None'` empty-state assertions inside hidden
  lanes; provenance-label and nested-instance assertions MUST be retained.
- **FR-005**: A targeted `pnpm e2e` run of both spec files MUST pass on
  every configured Playwright project.

**Cheap unifications (Part B)**

- **FR-006**: All backend routes that reject invalid input MUST produce the
  400 `{code, message, details}` envelope through one shared helper with a
  single canonical message; hand-rolled variants (`"Invalid query"`,
  `"Invalid query parameters"`, file-local `invalid()`) MUST be removed.
- **FR-007**: The `"all"`-sentinel → API-param mapping MUST exist in one
  shared helper consumed by the components, products, activity, and audit
  list hooks; the two debounced-filter hooks MUST be consolidated into one.
- **FR-008**: `SummaryRowMap` MUST contain only fields real payloads
  carry (populate or delete the speculative members), and
  `ImportRun.completedAt` MUST be declared on the `ImportRun` view type
  with call-site intersections removed.
- **FR-009**: Entity-type→label mapping MUST have a single registry
  consistent with domain vocabulary; the `importer_config` label MUST be
  consistent with sibling labels ("Importer config").

**Heavier refactors (Part B)**

- **FR-010**: Each migrated backend service's sort dispatch MUST be
  expressed as a per-service map keyed by the whitelisted sort field,
  replacing the nested ternary chains; unknown sort keys MUST still be
  rejected.
- **FR-011**: `docs/ux.md` §5 MUST be amended to document the carve-out
  permitting type-only (`import type`) entity imports in leaf display
  patterns; runtime value imports of `@/api/types` in shared pattern
  components remain forbidden.
- **FR-012**: All callers of `useSuggestions` and `useEntityHistory` MUST
  use the `page`/`pageSize` contract; the dual `offset`/`limit`
  signatures and `normalizeFeedQuery`'s legacy translation MUST be
  removed.
- **FR-013**: The suggestions-tabs convention is confirmed: `?status=`
  driving the suggestions list filter is acceptable — no `?tab=`
  alignment is required (B.8 resolved).

### Key Entities

- None — this spec changes tests, helpers, types, and docs conventions; it
  introduces no new domain entities or persisted data.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: `pnpm e2e` targeted run of `product-map.spec.ts` and
  `component-relationships.spec.ts` passes 100% of tests on every
  configured project (currently 10 consistent failures).
- **SC-002**: A full `pnpm e2e` workload run shows zero failures
  attributable to stale UI expectations in these two spec files.
- **SC-003**: Exactly one implementation produces the 400 invalid-input
  envelope across backend routes (grep-verifiable: no remaining
  hand-rolled `"Invalid query"` / `"Invalid query parameters"` /
  file-local `invalid()` variants).
- **SC-004**: The `"all"`-sentinel→param mapping and debounced-filter
  behavior each exist in exactly one place in the frontend.
- **SC-005**: Entity-type labels resolve from one registry; the activity
  feed renders `importer_config` consistently with sibling labels.
- **SC-006**: No `@/api/types` imports remain under the shared patterns
  layer, or `docs/ux.md` §5 documents the accepted exception.

## Assumptions

- "Hide lanes with no data" (commit `7e33ef2`) and the dedicated Map tab
  (commit `2f77c56`) are intended, shipped behavior — the specs are wrong,
  not the app.
- The two full-suite-only flakes (A.3) are load-related and already
  mitigated by `retries: 1`; no fixture-level retry work is planned unless
  they recur.
- B.8 (`?status=` driving suggestions tabs) is confirmed acceptable — the
  convention rule scopes to detail pages and URL-state spirit is
  preserved (clarified 2026-11-09).
- Reasonable defaults chosen where the source document recommended an
  option: B.2 unify (recommended), B.3 sort maps (recommended), B.4 shared
  helpers (recommended), B.6 populate-or-delete + proper view type
  (recommended), B.7 single label registry (recommended).
- Playwright coverage for the changed surface is satisfied by updating the
  two existing journey specs; no new spec files are required for the
  backend/frontend cleanups beyond the unit tests each change already
  carries or gains.

## Out of Scope

- Root-causing or reworking the shared per-user API rate limit (A.3
  mechanism) — monitoring only.
- Any change to importer packages, the importer contract, or the backend
  API surface (routes, envelopes, pagination contract) — B.5 affects
  frontend hook signatures only.
- Multi-tenancy, new entities, or domain-model changes.
- Deferring decisions the source document explicitly leaves open beyond
  the three clarification markers (B.1 approach, B.5 approach, overall
  scope of the heavier items).
