# UI Contract: Prototype UX parity polish

This feature changes presentation and local UI state only; HTTP contracts are
unchanged.

## Global visual contract

- `.ux-root` is applied to `body` and wraps the whole app, including portals and supplies the prototype token scope
  to `/login`, `/register`, `/auth/oidc/callback`, and every authenticated
  route.
- `--font-sans` resolves to `Geist Variable`; `--font-mono` resolves to
  `Geist Mono Variable`; both keep platform fallbacks.
- `bg-grid` is available to all routes and produces the auth showcase canvas.
- `tabular` and font feature settings apply inside the shared token scope.
- Dark mode continues to come from `next-themes` and the `.dark` token block.

## Shell controls and cues

- Header order: sidebar trigger, breadcrumb trail, flexible space, icon
  controls, theme toggle.
- Help/docs opens the published Componode documentation in a new tab.
- Notifications navigates to `/settings/notifications`; no unread dot is
  rendered until notification state exists.
- `NAV_SECTIONS` may mark a nav item with `badgeKey`:
  - `pendingSuggestions` → pending `SuggestionListResult.total`
  - `agentsAttention` → count of `ImportAgent.status` in `OFFLINE` or
    `NEVER_CONNECTED`
- Badge values are rendered only when positive and the current role can see
  the nav item.

## Product detail tabs

Canonical tab IDs, in display order:

1. `overview`
2. `map`
3. `components`
4. `dependencies`
5. `activity`

Rules:

- `?tab=map` resolves to the Map tab and renders `ProductMap`.
- Dependencies excludes `ProductMap` and preserves `EdgeAuthoring`, consumer
  list, and suggestion actions.
- Unknown/retired tabs fall back through `useValidatedTab` to `overview`.
- Map remains read-only; selection, inspection, expansion, keyboard traversal,
  and empty/partial states are unchanged.
