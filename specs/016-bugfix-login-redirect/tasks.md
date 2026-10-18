# Tasks: First Login Attempt Bounces Back to /login

**Input**: spec.md + plan.md in `/specs/016-bugfix-login-redirect/`

**Bugfix workflow**: regression test FIRST (fails), then minimal fix.

- [X] T001 Baseline: `npx vitest run` in `packages/frontend` green (30 files)
- [X] T002 Regression test `src/test/unit/login-flow.test.tsx` — fails on
  current code: stale `null` session cache survives login; wrong OIDC path
- [X] T003 `useLogin` seeds `["auth","session"]` via `setQueryData` with the
  login response user (`api/hooks/auth.ts`)
- [X] T004 `login.tsx` submits via `useLogin().mutateAsync`; OIDC status
  fetch → `/auth/oidc/status`
- [X] T005 `useOidcStatus` queryFn path → `/auth/oidc/status`
  (`api/hooks/settings.ts`)
- [X] T006 Verify: new tests pass; `typecheck`, `lint`, full `vitest run`
  green
