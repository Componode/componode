# Bugfix Specification: SPA Direct Navigation & Initial CSRF Cookie

**Feature Branch**: `bugfix/009-spa-csrf`

**Created**: 2026-09-09

**Status**: Shipped

**Input**: During first-use smoke testing, the deployed Docker Compose stack returned 404 for direct browser access to `/login` and the first login attempt failed with `CSRF_TOKEN_MISMATCH` because the frontend had no CSRF cookie.

## User Scenarios & Testing

### User Story 1 — Direct Navigation to Frontend Routes

As a user, I want to open `http://localhost:3000/login` (or refresh any app route) and see the Componode login page so that I can bookmark and share URLs without being blocked by 404s.

**Independent Test**: A `GET /login` request from a browser is served the built `index.html` and the React Router SPA takes over.

**Acceptance Scenarios**:

1. **Given** the frontend is built and the backend is running in production mode, **When** a browser requests `GET /login`, **Then** the response is `200` `text/html` containing the Componode SPA markup.
2. **Given** an API client requests `GET /api/v1/unknown`, **When** the route does not exist, **Then** the response is still `404` `application/problem+json`.

### User Story 2 — First Login Works Without a Pre-Existing CSRF Cookie

As a user, I want to log in on a fresh browser session (no prior cookies) without manually refreshing the page or retrying, so that the first submit of the login form succeeds.

**Independent Test**: A fresh `GET /api/v1/health` (or any safe `GET`) sets the `componode_csrf` cookie; the subsequent `POST /api/v1/auth/login` with that cookie and matching header succeeds.

**Acceptance Scenarios**:

1. **Given** the browser has no `componode_csrf` cookie, **When** it makes a safe `GET` request, **Then** the response includes a fresh `componode_csrf` cookie.
2. **Given** the browser now has the `componode_csrf` cookie, **When** it submits the login form with the matching `x-csrf-token` header, **Then** the login succeeds with a session cookie.

## Requirements

### Functional Requirements

- **FR-001**: The backend MUST serve the built `index.html` for any `GET`/`HEAD` request that (a) does not match a static file or API route, (b) accepts `text/html`, `*/*`, or has no `Accept` header, and (c) is not under `/api/` or `/metrics`.
- **FR-002**: API and `/metrics` 404s MUST continue to return RFC 7807 `application/problem+json` documents.
- **FR-003**: The CSRF plugin MUST issue a `componode_csrf` cookie on safe `GET`/`HEAD` responses when the request does not already have one.
- **FR-004**: State-changing requests (`POST`/`PUT`/`PATCH`/`DELETE`) MUST still be rejected with `403 CSRF_TOKEN_MISMATCH` when the cookie and header do not match.

## Success Criteria

- **SC-001**: `GET /login`, `GET /components`, and other client-side routes return `200 text/html` on a fresh browser session.
- **SC-002**: `GET /api/v1/nonexistent` and `/metrics` with non-matching paths still return `404 application/problem+json`.
- **SC-003**: A fresh session can complete `POST /api/v1/auth/login` after a single safe `GET` request has set the CSRF cookie.
- **SC-004**: The existing CSRF protection tests continue to pass (mismatched cookie/header still blocked).

## Assumptions

- The backend is built with `NODE_ENV=production` so the built frontend static assets are served.
- The SPA uses React Router in `BrowserRouter` mode, so all routing decisions are client-side after `index.html` is loaded.
- `Secure` cookies are accepted by modern browsers on `http://localhost` (per RFC 6265bis and current browser behavior).
