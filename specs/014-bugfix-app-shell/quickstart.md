# Quickstart — Validation Guide: App-Shell Chrome Bugfix

Runnable proof that the three defects are fixed. Mirrors the audit method in
`researches/app_shell_layout_research.md` (appendix).

## Prerequisites

```powershell
docker compose up -d                       # postgres + backend on :3000
pnpm --filter @componode/frontend dev      # vite dev on :5173 (/api proxied)
# sign in at http://localhost:5173/login with the .env bootstrap admin
```

## Automated check (regression test)

```powershell
pnpm --filter @componode/frontend test     # vitest suite
pnpm --filter @componode/frontend lint
pnpm --filter @componode/frontend typecheck
```

Expected: the new shell/scroll + collapse-default tests pass; the suite is
green.

## Manual browser matrix

| # | Viewport | Page | Steps | Expected |
|---|---|---|---|---|
| 1 | 1440×900 | `/components` (or any long page) | Scroll to bottom | Sidebar nav + collapse button + top bar fully visible and clickable; only content scrolled |
| 2 | 1440×900 | `/` | Scroll | Same — no dead space below the sidebar |
| 3 | 768×1024 | `/` (fresh session — clear `sessionStorage` first) | Load | Sidebar renders as icon rail; content ≥70% width; importer-status label ellipsizes, badge never overlaps |
| 4 | 768×1024 | any | Expand sidebar, reload | Stays expanded — explicit choice wins over width default |
| 5 | 1024×768 | `/` (fresh session) | Load | Sidebar expanded — `lg` boundary correct; importer-status row renders fully (no truncation needed) |
| 6 | 1440×500 | `/components` | Mouse-wheel deep scroll | Reproduces the original defect condition — chrome now stays |
| 7 | 1440×900 | a detail page w/ tabs | Tab navigation + focus return | No scroll/focus regression under the new scroll container |
| 8 | 1440×400 | any (short viewport) | Scroll the sidebar nav itself | Nav scrolls internally; logo header + collapse footer stay pinned |

## Pass criteria

Every matrix row behaves as expected; `pnpm lint && pnpm typecheck &&
pnpm --filter @componode/frontend test` green; no console errors during
scroll or toggle.
