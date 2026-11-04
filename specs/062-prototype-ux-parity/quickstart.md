# Quickstart: Prototype UX parity polish

## Prerequisites

- `pnpm install` at the repository root after `package.json` changes.
- Backend optional for unit tests; required only for manual API-backed checks.

## Verification commands

```powershell
cd packages/frontend
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Targeted tests while iterating:

```powershell
cd packages/frontend
pnpm test -- src/test/unit/theme-tokens.test.ts src/test/unit/use-validated-tab.test.tsx src/test/unit/ux-parity.test.tsx src/test/unit/product-map.test.tsx
```

## Manual validation

1. Start the frontend (`cd packages/frontend && pnpm dev`).
2. Open `/login` in light and dark themes.
   - Expected: Geist typography, same split-screen disposition, visible
     grid/canvas behind the showcase, token-colored pills.
3. Sign in and inspect the shell.
   - Expected: Geist typography across dashboard, lists, detail pages, forms,
     and dialogs; header shows real Help/docs, Notifications, and theme
     controls.
4. With pending suggestions or non-connected agents, inspect the sidebar.
   - Expected: numeric pills only on the relevant nav items; no badge when a
     count is zero or unavailable.
5. Open `/products/:slug?tab=map`.
   - Expected: Map tab is active and topology renders.
6. Switch to `/products/:slug?tab=dependencies`.
   - Expected: no topology card; edge authoring and relation lists remain.
7. Keyboard-check the shell, tab list, map nodes, and controls at 1280px and
   768px in both themes.
