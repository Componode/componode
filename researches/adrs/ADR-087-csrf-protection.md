### ADR-087 — CSRF protection

> **Status:** Ratified

**Context**: [ADR-086](./ADR-086-session-cookie-security-flags.md)'s `SameSite: Lax` blocks cross-site POST/PUT/DELETE on
modern browsers, but legacy browsers and subdomain attacks are gaps.

**Decision**: **Double-submit cookie pattern on all state-changing routes
(`POST`/`PUT`/`PATCH`/`DELETE`).** The backend sets a CSRF token cookie
(`componode_csrf`, `HttpOnly: false`, `SameSite: Lax`, `Secure` matches
session cookie), and the frontend sends the token as an `X-CSRF-Token`
header on every state-changing request. The backend's `preHandler` compares
cookie to header — mismatch = `403`. Universal (not conditional on
deployment type). GET routes MUST NOT have side effects ([ADR-094](./ADR-094-get-routes-must-not-have-side-effects.md)).

**Rationale**: Double-submit is stateless and simple (no server-side token
store). Layered with `SameSite: Lax` ([ADR-086](./ADR-086-session-cookie-security-flags.md)). Universal because the
complexity is the same either way, and a public-facing deployment
([ADR-075](./ADR-075-self-registration.md)) is a real CSRF target.

## Amendment 1 — Initial cookie issuance (2026-09-09)

**Context**: The frontend needs a CSRF token before its *first* state-changing
request. The original implementation only set the cookie in successful
login/register responses, which created a deadlock: the first login could not
succeed because the browser had no token yet.

**Refinement**: The backend MUST issue a fresh `componode_csrf` cookie on the
first safe `GET`/`HEAD` response when the request does not already have one.
This gives the frontend a token before any login attempt without changing the
double-submit verification on `POST`/`PUT`/`PATCH`/`DELETE`.

## Amendment 2 — Non-cookie-authenticated routes (2026-10-21, via ADR-116)

**Context**: `POST /api/v1/agent/enroll` (Import Agent enrollment,
ADR-116) is called by the agent process, which holds no cookie jar — the
universal check would 403 every legitimate enrollment.

**Refinement**: The double-submit requirement applies to routes that
authenticate via the session cookie. Routes under `/api/v1/agent/` —
authenticated by bearer credential (enrollment token or agent token),
never ambient cookies — are exempt by path prefix. CSRF's threat model
is ambient cookie auth; on bearer-authed machine endpoints the check has
no value. All session-authenticated state-changing routes remain covered
without exception.