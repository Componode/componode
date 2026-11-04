# Data Model: Prototype UX parity polish

**Date**: 2026-11-03 | **Feature**: `062-prototype-ux-parity`

No database schema, API response, or durable preference changes are required.

## View entities

| Entity | Fields used | Source | Notes |
|---|---|---|---|
| `NavItem` | `title`, `href`, `icon`, `minRole`, optional `badgeKey` | `ux/lib/nav.ts` | `badgeKey` selects a live cue; it is not a static label. |
| `Context cue` | `pendingSuggestions`, `agentsAttention` | Existing `useSuggestions` and `useAgents` reads | Omitted while loading/erroring/zero; no fixture values. |
| `ProductTopology` | Existing relation families | Product detail read + mapper | Rendered by `ProductMap` unchanged. |
| `Product detail tab` | `overview`, `map`, `components`, `dependencies`, `activity` | URL `?tab=` + `useValidatedTab` | `map` is now valid; unknown values still fall back to `overview`. |
| `Visual token scope` | `.ux-root` class + shared CSS variables | `index.html`/`main.tsx`/`app.tsx`/`ux/styles.css` | Applies to public auth routes, authenticated shell routes, and portal chrome. |

## Validation rules

- Badge counts must be numbers returned by existing list reads; `undefined`,
  loading, error, and zero produce no badge.
- `?tab=map` must produce an active Map tab, not an alias to Dependencies.
- Dependencies must not render `ProductMap`; it keeps relation/edge-authoring
  controls.
- All color/status rendering remains token-driven (`--color-*`, domain META)
  with no hardcoded palette classes or hex literals.
- Auth pages must use the same `.ux-root` token scope as shell pages; no
  second visual theme is introduced.
