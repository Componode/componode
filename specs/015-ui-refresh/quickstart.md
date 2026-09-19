# Quickstart — UI Refresh Validation

## Prerequisites

- `pnpm install` at repo root (installs `recharts`,
  `@radix-ui/react-popover` once added by tasks).
- Local stack running (backend + Vite dev server, or the docker compose
  stack serving the built frontend).

## Automated checks

```powershell
pnpm --filter frontend test          # vitest unit suite (incl. new drawer/facet/chart tests)
pnpm lint
pnpm typecheck
```

## Browser validation matrix

Run each row at the stated width × theme; row = scenario, cell = expected
result.

| # | Width | Theme | Scenario | Expected |
|---|---|---|---|---|
| 1 | 1440 | light | Any page | Emerald primary accents (not blue); radius visibly ~`0.625rem`; icon wells on nav/stat icons |
| 2 | 1440 | dark | Any page | Emerald primary (light variant), AA contrast, wells present |
| 3 | 1440 | both | Components page | Category/provider/lifecycle/status pills are decorative (not links); status badges show dot+label |
| 4 | 1440 | light | Filters | Each facet control opens a searchable multi-select listing **all** enum values + component groups; selections appear as removable pills in the button; URL params update; refresh keeps them |
| 5 | 1440 | light | Filters | Pill overflow: >2 selections collapse to `+N`; "Clear all" empties every facet + URL |
| 6 | 1440 | both | `Ctrl+B` | Sidebar toggles collapsed↔expanded; works with focus on body **and inside inputs** (same global rule as `Ctrl+K`) |
| 7 | 767 | both | Any page | No persistent sidebar; hamburger visible; opens left drawer w/ scrim; focus trapped; Esc + scrim + × all close; focus returns to hamburger |
| 8 | 767→1024 | both | Resize with drawer open | Drawer dismisses, persistent sidebar resumes — never both at once |
| 9 | 390 | both | Drawer nav | Drawer shows same nav sections/groups as desktop sidebar; section collapse optional |
| 10 | 1440 | both | Dashboard | Importer section renders stacked-bar chart of recent runs (created+updated+unchanged segments); empty/zero runs → empty state; adjacent text equivalent exists |
| 11 | any | both | Keyboard | All new controls reachable; visible `focus-visible` ring; chart/drawer/facets operable without mouse |
| 12 | any | both | A11y | Brand emerald never used for success/status; status remains color+label/dot (color-blind safe) |

## Scenario → spec mapping

- Rows 1–3 → US1 (emerald identity, radius, wells, pills, dots)
- Rows 4–5 → US2 (facets, pills-in-button, clear-all, URL sync)
- Rows 6–9 → US3 (`Ctrl+B`, drawer, crossover, section parity)
- Row 10 → US4 (chart, empty state, text equivalent)
- Rows 11–12 → NFRs (keyboard, focus, AA, color-blind)
