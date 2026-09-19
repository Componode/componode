# Tasks: App-Shell Chrome — Scrolling Sidebar, 768px Collision, No Auto-Collapse

**Input**: Design documents from `/specs/014-bugfix-app-shell/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, quickstart.md

**Bugfix workflow**: regression test FIRST per story (fails), then minimal fix
(AGENTS.md § Bugfix Spec Workflow; constitution VI).

**Organization**: Tasks grouped by user story (P1 → P3), independently testable.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: parallelizable (different files, no dependency on incomplete tasks)
- **[Story]**: US1/US2/US3 per spec.md; absent on Setup/Polish tasks

## Path Conventions

- Source: `packages/frontend/src/`
- Unit tests: `packages/frontend/src/test/unit/` (Vitest + Testing Library,
  jsdom; global stubs incl. `matchMedia`→`false` live in `src/test/setup.ts`)

---

## Phase 1: Setup

**Purpose**: Establish the green baseline the regression tests will hang off.

- [X] T001 Run `pnpm --filter @componode/frontend test` and confirm the
  existing unit suite is green before any change (baseline for the new
  regression tests); do not modify code

---

## Phase 2: Foundational

**Purpose**: Blocking prerequisites shared by all stories.

None — this bugfix has no shared infrastructure. All story work is
independent, file-level change; proceed directly to Phase 3.

---

## Phase 3: User Story 1 — Persistent app-shell chrome (P1) 🎯 MVP

**Goal**: Sidebar and top bar stay pinned while only `<main>` scrolls.

**Independent Test**: `app-shell.test.tsx` green + quickstart rows 1–2, 8
(scroll a long page at 1440×900 — chrome visible and clickable throughout;
nav scrolls internally when taller than the viewport).

### Tests for User Story 1

> Write FIRST; assert the DOM contract (jsdom cannot measure scroll — see
> research.md Decision 4). Must FAIL before T003/T004.

- [X] T002 [US1] Create `packages/frontend/src/test/unit/app-shell.test.tsx`:
  render `AppShell` inside `MemoryRouter`/`Routes` so `<Outlet/>` resolves
  (mock `@/api/hooks/auth` `useSession` per `sidebar.test.tsx` convention);
  assert `[data-testid="app-shell"]` carries `h-dvh` and `overflow-hidden`
  (not `min-h-screen`), and `<main>` carries `min-h-0` and `overflow-y-auto`

### Implementation for User Story 1

- [X] T003 [US1] In `packages/frontend/src/components/layout/app-shell.tsx`
  change the shell wrapper `flex min-h-screen` → `flex h-dvh overflow-hidden`
  and `<main>` `flex-1 overflow-y-auto` → `flex-1 min-h-0 overflow-y-auto`
  (the `min-h-0` is mandatory: without it `min-height:auto` keeps `main` at
  content height and `overflow-hidden` clips the page instead of scrolling)
- [X] T004 [P] [US1] In `packages/frontend/src/components/layout/sidebar.tsx`
  change the `<aside>` `h-screen` → `h-full` so it fills the bounded parent
  rather than re-measuring the viewport (same file T006 touches — land this
  first)

**Checkpoint**: Long page at 1440×900 — sidebar + top bar pinned; only
content scrolls (quickstart rows 1–2, 8).

---

## Phase 4: User Story 2 — Width-aware sidebar default (P2)

**Goal**: First load below `lg` opens the icon rail; any explicit stored
choice always wins; never re-derived on resize.

**Independent Test**: `sidebar.test.tsx` new cases green + quickstart rows
3–5 (fresh 768px session → rail; expand+reload → stays expanded; fresh
1024px → expanded).

### Tests for User Story 2

> Write FIRST; must FAIL before T006.

- [X] T005 [P] [US2] Extend `packages/frontend/src/test/unit/sidebar.test.tsx`
  — override `window.matchMedia` per test (the global stub in
  `src/test/setup.ts` always returns `matches:false`; reassign or
  `vi.stubGlobal`, restore in `afterEach`). Cover: (a) key absent + narrow
  (`max-width:1023.98px` matches) → `data-collapsed="true"`; (b) key absent +
  wide → `data-collapsed="false"`; (c) key `"false"` + narrow → expanded
  (explicit wins); (d) key `"true"` + wide → collapsed; (e) mount with key
  absent does NOT write `sidebar-collapsed` to sessionStorage (persistence
  only on explicit toggle)

### Implementation for User Story 2

- [X] T006 [US2] In `packages/frontend/src/components/layout/sidebar.tsx`:
  read `sessionStorage.getItem(STORAGE_KEY)` raw in the `useState`
  initializer — `null` → `window.matchMedia("(max-width: 1023.98px)").matches`,
  `"true"`/`"false"` → explicit value; move the `sessionStorage.setItem`
  write out of the mount `useEffect` into the collapse-toggle `onClick`
  (only explicit choices persist; the initializer never writes). Depends on
  T004 (same file)

**Checkpoint**: Fresh session at 768×1024 → icon rail; toggle persists
across reload and survives resize (quickstart rows 3–5).

---

## Phase 5: User Story 3 — Importer-status row truncation (P3)

**Goal**: At 768px the last-run label ellipsizes instead of colliding with
the status badge cluster.

**Independent Test**: `dashboard.test.tsx` regression case green +
quickstart row 3 (768×1024 — label ellipsizes, badge never overlaps).

### Tests for User Story 3

> Write FIRST; DOM-contract assertion (jsdom cannot measure overlap —
> research.md Decision 4). Must FAIL before T008.

- [X] T007 [P] [US3] Extend `packages/frontend/src/test/unit/dashboard.test.tsx`
  — in the last-runs list, assert the label wrapper (link + `importerName`)
  carries `min-w-0` and `truncate`, the `importerName` span carries `hidden`
  and `md:inline`, and the right cluster retains `shrink-0`

### Implementation for User Story 3

- [X] T008 [US3] In `packages/frontend/src/pages/dashboard.tsx` (last-runs
  `<li>`, ~L183–194): label span `min-w-0` → `min-w-0 truncate`; add
  `hidden md:inline` to the `importerName` span; leave the
  `shrink-0` status cluster unchanged

**Checkpoint**: 768×1024 dashboard — name ellipsizes cleanly against the
badge (quickstart row 3).

---

## Phase 6: Polish & Cross-Cutting

- [X] T009 Run `pnpm --filter @componode/frontend lint`,
  `pnpm --filter @componode/frontend typecheck`,
  `pnpm --filter @componode/frontend test` — all green
- [X] T010 Execute the full manual browser matrix in `quickstart.md`
  rows 1–8 (scroll-pin at 1440, fresh rail at 768, stored-pref precedence,
  1024 boundary, deep scroll, tabs/focus regression, nav-internal scroll)
- [X] T011 ADR review per AGENTS.md bugfix workflow: confirm the bounded
  `h-dvh` shell *conforms to* `docs/ux.md` §3 (persistent chrome) rather
  than amending a ratified decision — record the outcome in the PR body;
  add an ADR amendment only if the review finds a decision-level change

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: none — start immediately
- **Foundational (Phase 2)**: empty — no blocking prerequisites
- **US1 (Phase 3)**: after Setup; no dependency on US2/US3
- **US2 (Phase 4)**: after Setup; recommended after US1 because T006 edits
  the same file as T004 (`sidebar.tsx`)
- **US3 (Phase 5)**: after Setup; fully independent file (`dashboard.tsx`)
- **Polish (Phase 6)**: after all completed stories

### Within Each Story

- Test task MUST fail before its implementation task (T002→T003/T004,
  T005→T006, T007→T008)
- Story checkpoint met before moving to the next priority

### Parallel Opportunities

- T003 (app-shell.tsx) ∥ T004 (sidebar.tsx) — different files within US1
- T005 (sidebar.test.tsx) ∥ T007 (dashboard.test.tsx) — different files;
  can run concurrently with US1's test if staffed
- US1 ∥ US3 — disjoint files; could run in parallel, but priority order
  (P1→P3) is the default

---

## Parallel Example

```bash
# US1 implementation (different files, both after T002 fails):
Task: "app-shell.tsx — h-dvh overflow-hidden shell + min-h-0 main"
Task: "sidebar.tsx — aside h-screen → h-full"

# Story tests across files (after Setup):
Task: "sidebar.test.tsx — matchMedia-driven collapse defaults"
Task: "dashboard.test.tsx — importer-row truncation contract"
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. T001 baseline green
2. T002 fails → T003 + T004 → T002 passes
3. Validate quickstart rows 1–2 — the headline scroll defect is gone
4. Ship as MVP if needed; US2/US3 are independent increments

### Incremental Delivery

1. US1 → pinned chrome (the verified scroll defect)
2. US2 → icon-rail default below `lg` (delivers `ux.md` §9's ~768px promise)
3. US3 → row truncation (polish defect, smallest scope)
4. Each story lands green without breaking the previous

---

## Notes

- [P] = different files, no dependency on incomplete tasks
- `data-testid="app-shell"` / `data-testid="sidebar"` / `data-collapsed`
  already exist — tests assert on them, no new test hooks needed
- `matchMedia` is globally stubbed in `src/test/setup.ts`; US2 tests must
  override per-test and restore
- The `<768px` drawer is deliberately out of scope (feature spec `015`)
- Verify tests fail before implementing; commit after each task or logical
  group

---

## Phase 7: Convergence

- [X] T012 Fall through to the width-based `matchMedia` default when
  `sessionStorage.getItem` throws (private mode) instead of returning
  `false`, and extend `packages/frontend/src/test/unit/sidebar.test.tsx`
  with a storage-throws case per spec Edge Cases + data-model.md (partial)
- [X] T013 Extend the browser matrix to verify scroll-pinning at 1280×800
  and 768×1024 per SC-001, plus detail-page tab navigation and dialog focus
  return per SC-005 / quickstart row 7 (partial)
