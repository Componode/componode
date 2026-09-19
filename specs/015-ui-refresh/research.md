# Phase 0 — Research: UI Refresh

No NEEDS CLARIFICATION in the spec — D1–D11 + round-2 defaults pre-resolved
every user-facing decision (`researches/app_shell_layout_research.md`).
This file records the remaining technique/dependency choices verified
against the actual codebase.

## Decision 1: Drawer → new `components/ui/sheet.tsx` over `@radix-ui/react-dialog`

- **Decision**: Add the shadcn `sheet.tsx` primitive (side-anchored Dialog)
  and build `NavDrawer` on it. `@radix-ui/react-dialog` is already a dep —
  zero new dependency for the drawer.
- **Rationale**: Sheet gives the off-canvas semantics spec'd (scrim, Escape,
  focus trap, aria labeling) while reusing the existing dialog primitive
  and the package's `components/ui` convention.
- **Alternatives**: raw `Dialog` restyled — same result but reinvents the
  side-anchored variant every consumer would duplicate; `vaul` — rejected,
  it's a bottom-sheet lib for mobile-app UX, not a nav drawer.

## Decision 2: Facet control → `@radix-ui/react-popover` + `cmdk`

- **Decision**: Add `@radix-ui/react-popover` + a thin `ui/popover.tsx`
  wrapper; the facet body composes `command.tsx` (cmdk — already a dep)
  for searchable lists. Facet pills render inside the trigger button
  (shadcn data-table convention: `Status: 2 selected` + pills).
- **Rationale**: Popover is non-modal anchored content — correct primitive
  for a filter pick-list; `DropdownMenu` (present) has menu/roving-tabindex
  semantics that fight multi-select checkboxes and embedded search.
- **Alternatives**: `DropdownMenu` + checkboxes — rejected (wrong ARIA
  semantics, no search field); headless custom popover — rejected
  (reinvents positioning/focus-dismiss).

## Decision 3: Multi-value wire format → comma-joined in existing params

- **Decision**: `ComponentListFilters` fields stay `string`; facet
  selections serialize comma-joined into the existing `category=`,
  `provider=`, `lifecycle=`, `status=`, `group=` params — which already
  URL-sync via `useSearchParams`.
- **Rationale**: backend `normalizeValues` accepts `string | string[]` and
  emits `IN` clauses — **zero API change**, verified
  (`component-catalog-service.ts`). URL-sync, shareable links, and the
  existing `filtersFromSearchParams` plumbing all keep working.
- **Alternatives**: repeated params (`category=a&category=b`) — also
  supported server-side, but the frontend's `URLSearchParams.set` shape
  makes comma-joining the smaller diff; new `filters` object param —
  rejected, gratuitous API surface change.

## Decision 4: Run-history chart → Recharts, aggregated via `useQueries`

- **Decision**: `pnpm add recharts` (frontend only, `^2.x`, ≥7-day-old
  release). Chart consumes the existing `useImporterRuns(configId)`
  endpoint per config — fanned out via `useQueries` over the current
  configs (bounded, e.g. latest ~10 runs × visible configs, then global
  recency-trim to ≤20 bars).
- **Rationale**: ratified D6 (Recharts). The series endpoint already
  exists per config — no API work. `useQueries` over `useImporterConfigs`
  + `useImporterRuns` composes a global "recent runs" series client-side.
- **Alternatives**: chart `lastRuns` (dashboard summary) — rejected:
  that's latest-*only* per config, one bar each, not a run history; new
  aggregate endpoint — rejected, unnecessary backend change.

## Decision 5: `Ctrl+B` → small `useSidebarShortcut` hook

- **Decision**: `useEffect` keydown listener mirroring
  `command-palette.tsx`'s `Ctrl+K` pattern (`e.ctrlKey||e.metaKey`,
  `key.toLowerCase()==="b"`, `preventDefault`), mounted in `AppShell`;
  routes to drawer toggle `<md` / sidebar collapse `≥md`.
- **Rationale**: ratified D11; identical registration convention to the
  existing global shortcut.
- **Alternatives**: keydown on sidebar only — rejected, not global;
  third-party hotkeys lib — rejected, one-line pattern exists in-repo.

## Decision 6: Token change set — `index.css` only

- **Decision**: Light theme: `--color-primary: hsl(163 94% 24%)`,
  `--color-primary-foreground: white`, `--color-ring` follows primary;
  hover variant token `hsl(163 94% 20%)`. Dark theme:
  `--color-primary: hsl(158 64% 52%)`. `--radius: 0.5rem → 0.625rem`.
  `success` (~142°) untouched — it is the status green.
- **Rationale**: ratified D2/D3/D7; single-file token swap, both themes,
  `next-themes` dark class already in place. AA contrast verified per
  FR-013 (deep emerald on white ≈7:1; dark emerald on dark bg adjusted).
- **Alternatives**: CSS-var alias indirection (e.g. `--color-brand`) —
  rejected for v1, extra indirection for one palette.

## Decision 7: Icon wells → `icon-well` utility on nav/stat icons

- **Decision**: A small shared treatment (rounded `bg-muted`/`bg-accent`
  padded box around the icon) applied to sidebar nav icons and dashboard
  stat icons — utility class or tiny wrapper, not a new component family.
- **Rationale**: ratified D7 micro-layer; cheapest consistent application.
- **Alternatives**: full `IconWell` component — overkill for a wrapper.

## Decision 8: Breakpoint handoff — drawer `<md`, sidebar `≥md`, mutually exclusive

- **Decision**: `hidden md:flex` on the sidebar aside and `md:hidden` on
  the hamburger/drawer — plus one `matchMedia("(min-width: 768px)")`
  listener whose only job is clearing the drawer's React open state on
  crossover (FR-009). Both layers, not either/or: CSS guarantees the
  visual dismissal, the listener keeps state honest.
- **Rationale**: CSS handles the mutual exclusion; the listener is a
  state reset, not a resize-derived layout decision — consistent with the
  014 "never re-derive on resize" rule.
- **Alternatives**: matchMedia-driven mount — rejected, JS for a CSS job;
  CSS-only with no listener — leaves stale open state if the drawer is
  open during crossover.

## Resolved unknowns → none outstanding

All Phase-0 items closed; ready for Phase 1 artifacts.
