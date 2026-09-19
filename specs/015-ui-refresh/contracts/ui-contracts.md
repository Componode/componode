# UI Contracts — UI Refresh

Component-prop and design-token contracts other code consumes. Not API
contracts — the package has no new public interface; these pin the shapes
tasks/implementation must honor.

## New / changed components

### `NavDrawer` (`components/layout/nav-drawer.tsx`)

```ts
interface NavDrawerProps {
  open: boolean;
  onOpenChange(open: boolean): void;
}
```

- Renders `ui/sheet` `side="left"`; content + overlay carry `md:hidden`.
- Contains the same `nav-sections` source as the sidebar (single truth).
- Contract: Escape + scrim + explicit close control all call
  `onOpenChange(false)`; focus returns to the hamburger trigger.

### `useSidebarShortcut` (`lib/use-sidebar-shortcut.ts`)

```ts
useSidebarShortcut(opts: {
  isMobile: boolean;                 // matchMedia("(max-width: 767.98px)")
  onToggleMobile(): void;            // drawer
  onToggleDesktop(): void;           // sidebar collapse (existing)
}): void
```

- `Ctrl/Cmd+B`, `preventDefault`; global — NOT suppressed inside
  `input`/`textarea`/`[contenteditable]`, matching the existing `Ctrl+K`
  convention (spec edge case: "consistent with Ctrl+K: global, not
  suppressed").

### `FacetFilter` (`components/facet-filter.tsx`)

```ts
interface FacetFilterProps<T extends string> {
  title: string;                     // facet label, e.g. "Status"
  options: readonly { value: T; label: string; count?: number }[];
  selected: readonly T[];
  onChange(next: readonly T[]): void;
}
```

- Trigger button shows `title` + up to 2 value pills (overflow → `+N`);
  body = `ui/popover` + `ui/command` searchable checkbox list + "Clear".
- Removing a pill (× on pill) deselects that value.

### `ImporterRunChart` (`components/importer-run-chart.tsx`)

```ts
interface ImporterRunChartProps {
  configIds: readonly string[];      // visible configs
  maxRuns?: number;                  // default 20
}
```

- Stacked bars: segments `created` / `updated` (further `skipped`/
  `unchanged`/`failed` segments only if `ImportRun` carries them —
  otherwise created+updated). Empty/zero-runs → empty-state copy, not an
  empty axis. A sibling `<table>`/`<ul>` text equivalent (a11y).

### `StatusBadge` (`components/states/status-badge.tsx`) — CHANGED

- Same `StatusBadgeProps`/`statusColors` map; renders a leading
  `bg-current` dot inside the pill. No prop additions.

## Design tokens (`index.css` — contract for all consumers)

| Token | Light | Dark |
|---|---|---|
| `--color-primary` | `hsl(163 94% 24%)` | `hsl(158 64% 52%)` |
| `--color-primary-foreground` | white | dark bg |
| `--color-ring` | follows primary | follows primary |
| `--radius` | `0.625rem` | `0.625rem` |
| `--color-success*` | ~`hsl(142 …)` — unchanged | unchanged |

`icon-well` = `flex size-8 items-center justify-center rounded-md
bg-muted text-muted-foreground` (or equivalent single source).

## Invariants

- Drawer and sidebar chrome are mutually exclusive at any width.
- Filter pills and URL params are always in sync (URL is truth).
- `success` green never appears on brand/interactive elements.
