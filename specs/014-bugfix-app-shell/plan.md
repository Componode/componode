# Implementation Plan: App-Shell Chrome — Scrolling Sidebar, 768px Collision, No Auto-Collapse

**Branch**: `bugfix/014-app-shell` | **Date**: 2026-09-18 | **Spec**: [spec.md](spec.md)

**Input**: Bugfix specification from `/specs/014-bugfix-app-shell/spec.md`

## Summary

Pin the app-shell chrome by bounding the shell to the viewport (`h-dvh` +
`overflow-hidden`) so `<main>`'s existing `overflow-y-auto` becomes the
single scroll region; default the sidebar to the icon rail below `lg`
(first load only — an explicit stored preference always wins); fix the
dashboard importer-status row truncation so the label ellipsis-collapses
instead of overlapping the badge. Frontend-only: three files plus one
regression test, no dependencies, no API change.

## Technical Context

**Language/Version**: TypeScript 5

**Primary Dependencies**: React 18, Vite, Tailwind CSS v4 (`@theme` tokens),
React Router 7, lucide-react — **no new dependencies**

**Storage**: `sessionStorage` only (existing `sidebar-collapsed` key — no
schema changes, no DB)

**Testing**: Vitest + Testing Library (`packages/frontend` unit suite);
manual browser verification at 1440/1280/768 (Playwright-assisted, per
researches audit method)

**Target Platform**: Web — desktop-first ≥768px per `docs/ux.md` §9

**Project Type**: web-service (frontend package of pnpm monorepo)

**Performance Goals**: N/A — pure layout/CSS + one `matchMedia` call on mount

**Constraints**: WCAG 2.1 AA preserved; `docs/ux.md` §9 (desktop-first);
`<768px` drawer explicitly out of scope (feature spec); no window-scroll
consumers may be broken (verified: none exist — grep for
`scrollIntoView`/`scroll` listeners returns zero hits in `src/`)

**Scale/Scope**: 3 source files (`app-shell.tsx`, `sidebar.tsx`,
`dashboard.tsx`) + 1 test file

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Note |
|---|---|---|
| I. Single-Organization | PASS | No tenancy surface touched |
| II. Importer-First | PASS | No importer code touched |
| III. Two-Level Taxonomy | PASS | No taxonomy change |
| IV. Environment-as-Instance | PASS | No data-model change |
| V. Factual vs Meaning | PASS | No edge/hierarchy change |
| VI. Test-First | PASS | Spec FR-007 mandates failing regression test first; bugfix workflow requires it |
| VII. Observability | PASS | No new runtime path; no logging surface |

**Gate result**: PASS — no violations, no complexity justification needed.

## Project Structure

### Documentation (this feature)

```text
specs/014-bugfix-app-shell/
├── spec.md              # Bugfix spec (written by /speckit-specify)
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output (minimal — no data changes)
├── quickstart.md        # Phase 1 output
├── checklists/
│   └── requirements.md  # Spec quality checklist
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

`contracts/` intentionally omitted — this bugfix exposes no external
interface (no API, schema, or component-contract change).

### Source Code (repository root)

```text
packages/frontend/src/
├── components/layout/
│   ├── app-shell.tsx        # CHANGED — bounded h-dvh shell
│   ├── sidebar.tsx          # CHANGED — width-aware collapse default
│   └── top-bar.tsx          # unchanged (scroll fix lands via shell)
├── pages/
│   └── dashboard.tsx        # CHANGED — importer-status row truncation
└── test/ (or colocated)     # NEW — shell regression test
```

**Structure Decision**: Existing `packages/frontend` layout — layout
components under `components/layout/`, page fix in `pages/dashboard.tsx`,
test colocated per the package's existing `test/` convention.

## Complexity Tracking

> No constitution violations — section intentionally empty.

## Phase 0 → Phase 1 trace

- `research.md` — resolves the remaining technique choices (bounded-shell
  mechanism, auto-collapse state semantics, truncation mechanics) with
  Decision/Rationale/Alternatives.
- `data-model.md` — documents the one piece of persisted UI state
  (`sessionStorage["sidebar-collapsed"]`) and confirms zero schema change.
- `quickstart.md` — runnable validation: dev-server setup, breakpoint matrix,
  and the regression-test command.
