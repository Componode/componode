# Implementation Plan: UI Refresh — Emerald Identity, Mobile Drawer, Faceted Filters, Run Chart

**Branch**: `feature/015-ui-refresh` | **Date**: 2026-09-18 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/015-ui-refresh/spec.md`
(ratified decisions D1–D11 in `researches/app_shell_layout_research.md`)

## Summary

Land the ratified visual language (deep-emerald brand tokens, brand/status
green separation, `0.625rem` radius, icon wells, dot+label status badges,
decorative taxonomy pills), convert the five free-text component filters
into faceted multi-selects with removable pills (URL-synced, no API
change), add an off-canvas nav drawer below `md` with `Ctrl+B` and
ADR-108/ux.md-§9 ratification, and render a Recharts stacked-bar of recent
importer runs aggregated from the existing per-config runs endpoint.

## Technical Context

**Language/Version**: TypeScript 5

**Primary Dependencies**: React 18, Vite, Tailwind CSS v4 (`@theme` tokens),
React Router 7, TanStack Query, `cmdk` (present), `@radix-ui/react-dialog`
(present — the drawer's Sheet wraps it), `next-themes`, `lucide-react`.
**New deps**: `recharts` (^3.10.1, ≥7-day-old release), `@radix-ui/react-popover`
(facet control), `vaul` NOT needed (drawer is Dialog-based, not bottom-sheet).

**Storage**: `sessionStorage["sidebar-collapsed"]` (unchanged, from 014);
filter state lives in URL `searchParams` (existing); drawer state is
ephemeral React state. No DB changes.

**Testing**: Vitest + Testing Library (`src/test/unit/`); browser matrix via
Playwright at 1440/1280/768/390 incl. drawer, pills, chart, contrast.

**Target Platform**: Web — desktop-first ≥1280px per `docs/ux.md` §9;
drawer degrades <768px per ADR-108.

**Project Type**: web-service (frontend package of pnpm monorepo)

**Performance Goals**: Facet/filter re-render <100ms perceived (client-side
URL-sync only); chart renders ≤20 runs (bounded `useQueries` fan-out).

**Constraints**: WCAG 2.1 AA both themes; reduced-motion respected; no API/
schema/permission changes; `014-bugfix-app-shell` (PR #42) must merge first;
dependency policy (`^` ranges, ≥7-day-old, no `latest`).

**Scale/Scope**: ~4 user stories; ~10 touched/new files +
`index.css` tokens + ADR-108 + `docs/ux.md` §9 amendment.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Note |
|---|---|---|
| I. Single-Organization | PASS | No tenancy surface |
| II. Importer-First | PASS | Run-history chart surfaces importer value — aligned |
| III. Two-Level Taxonomy | PASS | Taxonomy pills are display-only; no taxonomy change |
| IV. Environment-as-Instance | PASS | Instance status facet reads existing enum — no model change |
| V. Factual vs Meaning | PASS | No edge/hierarchy change |
| VI. Test-First | PASS | Per-story failing tests precede implementation (tasks) |
| VII. Observability | PASS | No new runtime paths; chart/facet are render-only |

**Gate result**: PASS — no violations, no complexity justification needed.

## Project Structure

### Documentation (this feature)

```text
specs/015-ui-refresh/
├── spec.md              # Feature spec (written by /speckit-specify)
├── plan.md              # This file
├── research.md          # Phase 0 — technique/dependency decisions
├── data-model.md        # Phase 1 — filter-param wire format, UI state
├── contracts/
│   └── ui-contracts.md  # Phase 1 — component/token contracts
├── quickstart.md        # Phase 1 — validation matrix
├── checklists/
│   └── requirements.md  # Spec quality checklist
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
packages/frontend/src/
├── index.css                       # CHANGED — emerald tokens, radius
├── components/
│   ├── ui/
│   │   ├── sheet.tsx               # NEW — shadcn Sheet (wraps radix-dialog)
│   │   └── popover.tsx             # NEW — wraps @radix-ui/react-popover
│   ├── layout/
│   │   ├── sidebar.tsx             # CHANGED — sections extracted, Ctrl+B
│   │   ├── nav-sections.ts         # NEW — shared SECTIONS source
│   │   ├── nav-drawer.tsx          # NEW — <md Sheet drawer + hamburger
│   │   └── top-bar.tsx             # CHANGED — hamburger trigger (<md)
│   ├── states/status-badge.tsx     # CHANGED — add status dot
│   ├── component-filters.tsx       # CHANGED — faceted multi-selects
│   ├── facet-filter.tsx            # NEW — facet button + pills + list
│   └── importer-run-chart.tsx      # NEW — Recharts stacked bar
├── pages/
│   ├── dashboard.tsx               # CHANGED — chart in importer section
│   └── components.tsx              # CHANGED — pill cell treatments
├── lib/use-sidebar-shortcut.ts     # NEW — Ctrl+B listener (Ctrl+K pattern)
researches/adrs/ADR-108-*.md        # NEW — drawer exception
researches/architecture-decisions.md# CHANGED — index entry
docs/ux.md                          # CHANGED — §9 amendment cites ADR-108
packages/frontend/package.json      # CHANGED — recharts, react-popover
```

**Structure Decision**: Existing `components/ui` shadcn convention —
new primitives (`sheet`, `popover`) join it; feature-level components
(`nav-drawer`, `facet-filter`, `importer-run-chart`) sit beside their
consumers per the package's current layout.

## Complexity Tracking

> No constitution violations — section intentionally empty.

## Phase 0 → Phase 1 trace

- `research.md` — resolves: Sheet vs raw Dialog, Popover vs DropdownMenu
  for facets, multi-value wire format, chart data aggregation, `Ctrl+B`
  registration, token change set, drawer-vs-sidebar breakpoint handoff.
- `data-model.md` — filter-param serialization, persisted/ephemeral UI
  state inventory; confirms zero schema change.
- `contracts/ui-contracts.md` — prop shapes for `NavDrawer`,
  `FacetFilter`, `ImporterRunChart`, `StatusBadge` dot, theme-token list.
- `quickstart.md` — breakpoint + scenario validation matrix.
