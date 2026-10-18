# Bugfix Specification: First Login Attempt Bounces Back to /login

**Feature Branch**: `bugfix/016-login-redirect`

**Created**: 2026-10-18

**Status**: Draft

## Problem

The first sign-in attempt with valid credentials appears to fail: the user
lands back on `/login` even though `POST /api/v1/auth/login` returned 200
and the session cookie was set. Retrying immediately succeeds. Verified
against the container logs — every login POST returned 200 and subsequent
`/auth/session` checks returned 200, yet the UI redirected to `/login`.

## Root Cause

`packages/frontend/src/pages/login.tsx` posts credentials via the raw
`api()` client instead of the `useLogin()` mutation, so the
`["auth", "session"]` TanStack Query cache is never updated. The unauthenticated
page load beforehand has already cached `user = null` (the `useSession`
queryFn maps `AUTH_NO_SESSION` to `null`). When `navigate("/")` mounts
`AuthGuard`, `useSession()` returns the cached `null` — `isPending` is false,
`user` is null — so `AuthGuard` immediately renders `<Navigate to="/login">`.
The background refetch then populates the real session, which is why the
*second* attempt succeeds.

A second, related defect: `login.tsx` and `useOidcStatus` query
`GET /api/v1/settings/oidc/status`, which does not exist (404). The public
status endpoint lives at `GET /api/v1/auth/oidc/status`. The failure is
swallowed (`.catch(() => setOidcEnabled(false))`), so the OIDC sign-in
button never renders even when OIDC is enabled.

## Impacted User Scenarios

- Admin or any user signs in after an unauthenticated page load: first
  attempt silently bounces back to the login form. (Reproduced in container
  logs: login 200 → session 200 → bounce → second login 200 → dashboard 200.)
- Deployments with OIDC configured never show the "Login with OIDC" button
  on the login page.

## Acceptance Criteria

- A fresh browser session can sign in on the **first** attempt: after a
  successful `POST /auth/login`, `AuthGuard` sees the authenticated user
  without a stale-cache redirect.
- The session cache (`["auth", "session"]`) is populated with the user
  object returned by the login response on success.
- `login.tsx` and `useOidcStatus` query `GET /api/v1/auth/oidc/status`.
- Regression test covers the stale-`null`-cache login path.

## Affected Surface

- `packages/frontend/src/pages/login.tsx` — use `useLogin()`; fix OIDC path.
- `packages/frontend/src/api/hooks/auth.ts` — `useLogin` returns the session
  payload and seeds the `["auth", "session"]` cache via `setQueryData`.
- `packages/frontend/src/api/hooks/settings.ts` — `useOidcStatus` path fix.
- `packages/frontend/src/test/unit/` — new regression test.
