# Implementation Plan: First Login Attempt Bounces Back to /login

**Branch**: `bugfix/016-login-redirect` | **Spec**: [spec.md](./spec.md)

## Summary

Seed the `["auth", "session"]` TanStack Query cache with the user returned
by `POST /auth/login` (via `useLogin`), route the login page through that
mutation instead of the raw `api()` client, and point both OIDC-status
callers at the public `GET /auth/oidc/status` endpoint.

## Technical Context

- `useSession()` maps `AUTH_NO_SESSION` → `null` and caches it with a 30s
  `staleTime`. `AuthGuard` redirects to `/login` whenever `!isPending &&
  !user` — including while a stale `null` refetches in the background.
- `POST /auth/login` returns `{ user, csrfToken }` with the same `User`
  shape `useSession` produces, so `setQueryData` can seed the cache
  synchronously — no refetch window for the guard to bounce on.
- `GET /api/v1/auth/oidc/status` → `{ enabled }` (public). The
  `/settings/oidc/status` path never existed.

## Changes

| File | Change |
|---|---|
| `packages/frontend/src/api/hooks/auth.ts` | `useLogin` returns `LoginResponse`; `onSuccess` calls `qc.setQueryData(["auth","session"], data.user)` |
| `packages/frontend/src/pages/login.tsx` | submit via `useLogin().mutateAsync`; OIDC check calls `/auth/oidc/status` |
| `packages/frontend/src/api/hooks/settings.ts` | `useOidcStatus` queryFn path → `/auth/oidc/status` |
| `packages/frontend/src/test/unit/login-flow.test.tsx` | regression tests (new) |

## Verification

- New unit tests fail on the pre-fix code, pass after (verified).
- `pnpm --filter @componode/frontend typecheck` / `lint` / `vitest run` green
  (30/30 files).
