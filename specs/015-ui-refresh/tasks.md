# Tasks: UI Refresh — Emerald Identity, Mobile Drawer, Faceted Filters, Run Chart

**Input**: Design documents from `/specs/015-ui-refresh/`
**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`,
`contracts/ui-contracts.md`, `quickstart.md`

**Tests**: Included — constitution VI (test-first) is non-negotiable and
SC-006 requires new coverage. Write each story's tests FIRST; they must
FAIL before implementation.

**Gate**: Implementation of any task assumes `014-bugfix-app-shell`
(PR #42) has merged — the bounded shell, tri-state collapse, and
`hidden md:` chrome conventions are the substrate. Planning/docs tasks
(T027, T028) may proceed regardless.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: parallelizable — different files, no dependency on incomplete tasks
- **[USn]**: user story from spec.md
- All paths are repo-relative; `fe/` below = `packages/frontend/src/`

---

## Phase 1: Setup

- [x] T001 `pnpm add` `@radix-ui/react-popover` + `recharts` in
  `packages/frontend` (`^` ranges, releases ≥7 days old, never `latest`);
  commit `pnpm-lock.yaml` with the manifest change

---

## Phase 2: Foundational (Blocking Prerequisites)

**⚠️ CRITICAL**: US1–US4 cannot start until these primitives exist.

- [x] T002 [P] Create `fe/components/ui/sheet.tsx` — shadcn Sheet
  primitive wrapping the already-installed `@radix-ui/react-dialog`
  (side-anchored variants incl. `side="left"`, overlay, close control,
  focus trap, aria labeling)
- [x] T003 [P] Create `fe/components/ui/popover.tsx` — thin wrapper over
  `@radix-ui/react-popover` (Root/Trigger/Content/Anchor, `cn` styling
  per existing `ui/` conventions)

**Checkpoint**: primitives compile; story work can begin.

---

## Phase 3: User Story 1 — Emerald visual language (Priority: P1) 🎯 MVP

**Goal**: Deep-emerald brand tokens applied everywhere, separated from
status greens, `0.625rem` radius, icon wells, dot+label statuses,
decorative taxonomy pills — system font untouched.

**Independent Test**: quickstart rows 1–3 — at 1440×900 both themes,
primary actions/links/rings are emerald, statuses a visibly different
green treatment, radius/wells present, no mixed greens.

### Tests for User Story 1 ⚠️ (write first — must FAIL)

- [x] T004 [P] [US1] Create `fe/test/unit/theme-tokens.test.ts` reading
  `fe/index.css` and asserting `--color-primary: hsl(163 94% 24%)` in the
  light block, `hsl(158 64% 52%)` in the dark block, `--radius: 0.625rem`,
  and that `--color-success` keeps its ~`hsl(142 …)` hue unchanged
- [x] T005 [P] [US1] Extend `fe/test/unit/` status-badge coverage (new
  `status-badge.test.tsx` or existing file) asserting every `StatusBadge`
  renders a leading dot element plus the status label, and that the
  existing enum→color mapping is preserved
- [x] T006 [P] [US1] Extend `fe/test/unit/components-page-states.test.tsx`
  (or new test) asserting taxonomy/category pills in table cells render
  as non-interactive elements (no `role="link"`/`button`, no `href`, no
  click handler)

### Implementation for User Story 1

- [x] T007 [US1] Update `fe/index.css`: light `--color-primary` →
  `hsl(163 94% 24%)`, `--color-primary-foreground` → white,
  `--color-ring` → follow primary, primary hover → `hsl(163 94% 20%)`;
  dark `--color-primary` → `hsl(158 64% 52%)` (+ matching foreground/
  ring); `--radius` `0.5rem` → `0.625rem`; leave `--color-success` and
  the system font stack unchanged
- [x] T008 [US1] Add the `icon-well` utility (single source in
  `fe/index.css` or shared class per `contracts/ui-contracts.md`) and
  apply it to sidebar nav icons in `fe/components/layout/sidebar.tsx`
- [x] T009 [US1] Apply the icon-well treatment to dashboard stat icons in
  `fe/pages/dashboard.tsx`
- [x] T010 [US1] Add the leading `bg-current` dot to every status in
  `fe/components/states/status-badge.tsx` (no prop changes; keep tinted
  pill mapping)
- [x] T011 [US1] Convert taxonomy/category pills in table cells to the
  decorative (non-interactive) pill treatment in `fe/pages/components.tsx`
  and any other enum-pill surface found
- [x] T012 [US1] Audit interactive surfaces for brand/status separation
  (FR-002): grep for `success`/`green` classes on interactive elements,
  verify primary buttons/links/focus rings consume the emerald tokens,
  verify active nav stays neutral — fix any stragglers

**Checkpoint**: US1 independently testable — rows 1–3 green.

---

## Phase 4: User Story 2 — Faceted filters with removable pills (Priority: P2)

**Goal**: Every enum-backed filter becomes a faceted multi-select showing
all enum values; component groups get a searchable combobox facet;
selections render as removable pills inside the control with +N overflow
and clear-all; all state URL-synced via comma-joined params; zero API
change.

**Independent Test**: quickstart rows 4–5 — on `/components`, select two
categories + a component group, see pills, remove one pill, list
re-filters without reload; refresh preserves state.

### Tests for User Story 2 ⚠️ (write first — must FAIL)

- [x] T013 [P] [US2] Create `fe/test/unit/facet-filter.test.tsx`:
  renders all provided options in a searchable list; multi-select emits
  `onChange` with the union; selected values render as pills inside the
  trigger capped at 2 with a `+N` overflow counter; pill × deselects
  that value; "Clear" empties selection
- [x] T014 [P] [US2] Extend `fe/test/unit/` components-page filter
  coverage asserting facet selections serialize comma-joined into
  `category`/`provider`/`lifecycle`/`status`/`group` search params,
  round-trip on reload, and a clear-all affordance empties every facet
  param
- [x] T015 [P] [US2] Test the component-groups facet populates from
  `useComponentGroups()` and its combobox filters a long list by
  typeahead (mock the hook; assert filtered option set)

### Implementation for User Story 2

- [x] T016 [US2] Create `fe/components/facet-filter.tsx` per
  `contracts/ui-contracts.md` — `ui/popover` + `ui/command` body,
  checkbox option list, pills-in-trigger (2 + `+N`), per-pill remove,
  "Clear" action
- [x] T017 [US2] Rewrite `fe/components/component-filters.tsx` to render
  five `FacetFilter`s fed by `COMPONENT_CATEGORIES`,
  `COMPONENT_PROVIDERS`, `COMPONENT_LIFECYCLE`, `INSTANCE_STATUS`, and
  `useComponentGroups()`; keep `filtersToSearchParams`/
  `filtersFromSearchParams` round-trip (values are comma-joined strings
  in the existing params); keep `page` reset to 1 on change
- [x] T018 [US2] Inventory every enum-backed filter surface in
  `fe/pages/` (product `type` select, instance `status` filter, any
  others) and convert each to `FacetFilter` per FR-006
- [x] T019 [US2] Add the clear-all affordance to the filter bar and wire
  the standard empty state's "Clear filters" primary action to it

**Checkpoint**: US2 independently testable — rows 4–5 green.

---

## Phase 5: User Story 3 — Mobile drawer + `Ctrl+B` (Priority: P3)

**Goal**: Below `md`, navigation is an off-canvas left drawer (same
grouped sections, admin gating) opened by a top-bar hamburger visible
only `<md`; `Ctrl+B` toggles drawer `<md` / sidebar `≥md`; ADR-108 +
`docs/ux.md` §9 ratify the exception.

**Independent Test**: quickstart rows 6–9 — at 390×844 hamburger opens
the drawer, all destinations reachable ≤2 interactions, Esc/scrim/close
work with focus return, crossover dismisses, desktop untouched.

### Tests for User Story 3 ⚠️ (write first — must FAIL)

- [x] T020 [P] [US3] Create `fe/test/unit/nav-drawer.test.tsx` (override
  `matchMedia` for `<768px` per the 014 sidebar-test pattern): hamburger
  visible only below `md`; open renders the same nav sections incl.
  admin-gated items; Escape, scrim click, and × each close; focus is
  trapped while open and returns to the hamburger on close; drawer is
  aria-labeled
- [x] T021 [P] [US3] Extend `fe/test/unit/sidebar.test.tsx` (or new
  `use-sidebar-shortcut.test.tsx`): `Ctrl+B` toggles drawer open below
  `md` and sidebar collapse at/above `md`; verify it fires globally —
  including from an input/textarea focus (spec edge case: global, not
  suppressed); verify it cleans up on unmount like the `Ctrl+K` listener
- [x] T022 [P] [US3] Test the crossover: with drawer open, switching
  `matchMedia` to `≥md` dismisses it and the persistent sidebar resumes —
  drawer and sidebar chrome never co-visible

### Implementation for User Story 3

- [x] T023 [US3] Extract nav sections from `fe/components/layout/
  sidebar.tsx` into `fe/components/layout/nav-sections.ts` (single
  source); refactor sidebar to consume it — no visual change at `≥md`
- [x] T024 [US3] Create `fe/components/layout/nav-drawer.tsx` —
  `ui/sheet` `side="left"` rendering `nav-sections`, overlay + content
  `md:hidden`, explicit close control, `aria-label`/`aria-labelledby`,
  close on destination select
- [x] T025 [US3] Add the hamburger trigger (`md:hidden`) to
  `fe/components/layout/top-bar.tsx` and own the drawer `open` state in
  `fe/components/layout/app-shell.tsx`; add a matchMedia
  `(min-width: 768px)` listener that clears `open` on crossover (visible
  dismissal is already guaranteed by `md:hidden` — this keeps state
  honest per FR-009)
- [x] T026 [US3] Create `fe/lib/use-sidebar-shortcut.ts` per
  `contracts/ui-contracts.md` — `Ctrl/Cmd+B`, `preventDefault`, global
  (not suppressed in inputs, matching `Ctrl+K`); routes to drawer
  `<md` / sidebar toggle `≥md`; mount it in `app-shell.tsx`
- [x] T027 [US3] Write `researches/adrs/ADR-108-*.md` ratifying the
  drawer-only mobile-navigation exception (context, decision,
  consequences, alternatives incl. full mobile redesign rejection) and
  add its index row to `researches/architecture-decisions.md`
- [x] T028 [US3] Amend `docs/ux.md` §9 to cite ADR-108 as the ratified
  mobile-nav exception (drawer-only; other sub-768px layout unchanged)

**Checkpoint**: US3 independently testable — rows 6–9 green.

---

## Phase 6: User Story 4 — Importer run-history chart (Priority: P4)

**Goal**: Dashboard importer section renders recent runs as a stacked bar
per run (created + updated + processed-unchanged segments), legend,
hover/focus values, text equivalent, standard empty state.

**Independent Test**: quickstart row 10 — chart visible with real runs,
empty state with zero runs, accessible text equivalent present.

### Tests for User Story 4 ⚠️ (write first — must FAIL)

- [x] T029 [P] [US4] Create `fe/test/unit/importer-run-chart.test.tsx`
  (mock `useImporterConfigs`/`useImporterRuns`): renders one stacked bar
  per run with correct segment values; zero runs → standard empty state;
  a text equivalent (table/list) reflects the same data

### Implementation for User Story 4

- [x] T030 [US4] Create `fe/components/importer-run-chart.tsx` per
  `contracts/ui-contracts.md` — `useQueries` fan-out over
  `useImporterRuns(configId)` for visible configs, global recency-trim to
  `maxRuns` (default 20), Recharts `BarChart` stacked `created`/
  `updated`/`processed-unchanged` segments, legend, tooltip on
  hover/focus, adjacent text-equivalent table, standard empty state,
  reduced-motion-safe
- [x] T031 [US4] Integrate the chart into the dashboard importer section
  in `fe/pages/dashboard.tsx` (above or beside the last-runs list; keep
  the 014 row-collision fix intact)

**Checkpoint**: US4 independently testable — row 10 green.

---

## Phase 7: Polish & Cross-Cutting

- [x] T032 [P] Verify `prefers-reduced-motion` disables drawer slide and
  chart animation/transitions (FR-013); adjust transition classes as
  needed
- [x] T033 README roadmap sync — mark `015-ui-refresh` complete, revise
  `Next` (README.md)
- [x] T034 Run `pnpm lint && pnpm typecheck && pnpm --filter frontend
  test` — all green
- [x] T035 Run the quickstart browser matrix rows 1–12 at
  1440/1280/768/390 × light/dark (incl. contrast spot-checks and
  keyboard-only pass) — record results

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)** → **Foundational (Phase 2)** → blocks all stories
- **US1 (P1)** → **US2 (P2)** → **US3 (P3)** → **US4 (P4)** → **Polish**
- Stories are independent; priority order is the recommended sequence

### User Story Dependencies

- **US1**: none (visual substrate — landing it first keeps later stories'
  pills/drawer/chart on final tokens; not a hard blocker)
- **US2**: none (uses only foundational `popover.tsx` + existing backend)
- **US3**: needs `sheet.tsx` (T002); sidebar refactor consumes 014's
  tri-state collapse — **hard dependency on PR #42 merging**
- **US4**: needs `recharts` (T001) only

### Within Each Story

- Tests first → must FAIL → implement → verify story checkpoint

### Parallel Opportunities

- T002 ∥ T003 (different primitive files)
- T004 ∥ T005 ∥ T006 (different test files)
- T013 ∥ T014 ∥ T015
- T020 ∥ T021 ∥ T022
- T027 ∥ T028 (ADR file vs ux.md — different files)

---

## Parallel Example: User Story 3

```text
# Launch all US3 tests together (all must fail first):
T020 nav-drawer.test.tsx
T021 sidebar.test.tsx / use-sidebar-shortcut.test.tsx
T022 crossover test in nav-drawer.test.tsx
```

---

## Implementation Strategy

### MVP First (US1 only)

1. Setup + Foundational
2. US1 complete → validate rows 1–3 → the visible identity ships alone

### Incremental Delivery

US1 (identity) → US2 (functional gap) → US3 (degradation path) →
US4 (signal) — each independently testable, each adds value without
breaking the previous.

---

## Notes

- `fe/` = `packages/frontend/src/`
- Comma-joined multi-value params already supported by backend
  `normalizeValues` — do NOT add repeated params or a new API shape
- `Ctrl+B` is GLOBAL (not suppressed in inputs) per spec edge case
- Drawer dismiss at `≥md`: `md:hidden` on sheet content + matchMedia
  state reset — both, not either/or
- Keep `docs/security/2026-09-13-security-assessment.md` untracked —
  unrelated to this feature

## Phase 8: Convergence

- [x] T036 Convert credential status and expiry pills in
  `packages/frontend/src/pages/credentials.tsx` to `StatusBadge` (extend
  `STATUS_STYLES` with `REVOKED`/`EXPIRED` and the expiring states) so no
  status renders as solid brand fill — per FR-002/FR-004/SC-001
  (contradicts)
- [x] T037 Convert the `kind` enum filter (`entity`/`edge`) in
  `packages/frontend/src/pages/activity.tsx` to `FacetFilter`
  `mode="single"` — per FR-006 (missing)
