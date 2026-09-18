# Phase 0 — Research: App-Shell Chrome Bugfix

No NEEDS CLARIFICATION markers existed in the spec — every decision was
pre-resolved in `researches/app_shell_layout_research.md` (D1–D11). This file
records the remaining *technique* choices and the verification of the spec's
risk assumptions.

## Decision 1: Bounded-shell mechanism → `h-dvh` + `overflow-hidden` shell

- **Decision**: Change the shell wrapper in `app-shell.tsx` from
  `flex min-h-screen` to `flex h-dvh overflow-hidden`. The existing
  `flex-1 overflow-y-auto` on `<main>` then becomes the single scroll
  region; sidebar and top bar never participate in document scroll.
- **Rationale**: Matches the reference model literally (Linear/shadcn keep
  the chrome out of the scroll path). One attribute change owns the whole
  fix; `h-dvh` (100dvh) is Tailwind-v4-native and safe on the desktop-first
  target (`docs/ux.md` §9).
- **Alternatives considered**:
  - `sticky top-0 h-dvh self-start` on `<aside>` + `sticky` on `<header>` —
    same visual result but two pinned elements and the document still
    scrolls; rejected as more moving parts for identical behavior.
  - `position: fixed` chrome + margin offsets — rejected: requires manual
    width bookkeeping against the collapsible sidebar.
- **Verified risk check**: zero `scrollIntoView`, `window.scroll`,
  `IntersectionObserver`, or scroll listeners anywhere in
  `packages/frontend/src` — no consumer depends on the window being the
  scroll container. Spec assumption confirmed, not deferred.

## Decision 2: Auto-collapse → `matchMedia` in the `useState` initializer

- **Decision**: Read `sessionStorage["sidebar-collapsed"]` raw. When it is
  `null` (never toggled), the initial state is
  `window.matchMedia("(max-width: 1023.98px)").matches` (i.e. below `lg`).
  Any stored `"true"`/`"false"` wins. Evaluated **once**, on mount — never
  on resize.
- **Rationale**: `null` cleanly encodes "no preference" — no second storage
  key or sentinel flag needed. Computing the default in the state
  initializer avoids an effect, a flash of expanded sidebar, and a
  post-hydration write. A stored explicit choice already round-trips
  through the existing `useEffect` persister unchanged.
- **Alternatives considered**:
  - CSS-only auto-collapse (`lg:` variants hiding labels) — rejected:
    collapse is React state (labels, sections, footer text all change);
    duplicating it in CSS desynchronizes the toggle.
  - Re-evaluate on every resize — rejected (ratified D11): a default must
    not fight the user.
- **`max-width: 1023.98px`** mirrors Tailwind's own `max-lg` range; the
  legacy `max-width` form is used for broad engine support (the
  `(width < 1024px)` range syntax needs newer Safari).

## Decision 3: Importer-status row → truncate the label, demote the secondary name

- **Decision**: Give the left span a real shrink contract — `min-w-0
  truncate` on the label wrapper (link + `importerName` inside one
  truncating inline-block), and hide `importerName` below `md`
  (`hidden md:inline`). The right cluster stays `shrink-0`.
- **Rationale**: The collision happens because the label sub-tree can
  overflow its `min-w-0` parent — truncating the inner wrapper is the
  minimal fix; `importerName` is supplementary metadata and is the correct
  element to demote at the boundary.
- **Alternatives considered**:
  - Wrap the row to two lines — rejected: changes row-height rhythm the
    dashboard shares with the attention list.
  - Shrink the right cluster — rejected: badge/counts/timestamp are the
    semantic payload; the label is what can afford to lose characters.

## Decision 4: Regression-test surface → DOM contract, not layout measurement

- **Decision**: jsdom cannot measure real scrolling/overflow — the test
  asserts the shell's class/DOM contract (`h-dvh`/`overflow-hidden` shell,
  `overflow-y-auto` main, `data-collapsed` on the aside) plus collapse-state
  semantics with a mocked `matchMedia` and controlled `sessionStorage`.
- **Rationale**: Asserts the fix's *mechanism* (which is what regressed) in
  the package's existing Vitest + Testing Library setup; visual/scroll
  behavior is covered by the quickstart browser matrix.
- **Alternatives considered**: Playwright E2E — rejected for a bugfix
  (E2E is deferred per ADR-029); asserting `getComputedStyle` — jsdom
  doesn't run layout.

## Resolved unknowns → none outstanding

All Phase-0 items closed; ready for Phase 1 artifacts.
