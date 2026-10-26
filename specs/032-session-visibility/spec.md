# Feature Specification: Admin Session Visibility

**Feature Branch**: `032-session-visibility`

**Created**: 2026-10-24

**Status**: Draft

**Input**: User description: "Resolve ux-rewrite gap G2 — session
metadata. Sessions need `device` (user-agent parse), `location` (client
IP), the owning `userId` on the admin sessions list, and a `current`
marker identifying the caller's own session (for the 'This device' badge
and self-revoke suppression). Sessions records carry none of these
today. Flip sessionDevice/sessionLocation/sessionOwner/sessionCurrent."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - User sees which device each session is (Priority: P1)

A signed-in user opens `/ux/sessions` and sees per-session device and
location columns populated — one row carries a "This device" marker.

**Why this priority**: the core gap — session rows have no device/IP and
the caller can't tell sessions apart.

**Independent Test**: log in twice from different clients; GET
/sessions returns rows with device, ip, and exactly one `current: true`.

**Acceptance Scenarios**:

1. **Given** two live sessions for one user, **When** the caller lists
   own sessions, **Then** each row includes `device` and `ip`, and the
   caller's own session is marked `current`.
2. **Given** a session created before this feature (no captured UA/IP),
   **Then** its device/location render a defined empty value (null), not
   garbage.

---

### User Story 2 - Admin sees session ownership (Priority: P2)

An admin views a user's sessions (detail page tab) and each row names
its owning user — enabling the owner column and revoking the right row.

**Why this priority**: admin surface; lower blast radius but required
by the flag set.

**Independent Test**: admin GET /users/:id/sessions → rows include
`userId` + device/ip; owner column renders.

**Acceptance Scenarios**:

1. **Given** an admin requests another user's sessions, **Then** every
   row includes `userId`, `device`, `ip` — and non-admins still get 403.

---

### Edge Cases

- **Revoked sessions**: excluded from lists (unchanged behavior).
- **Missing UA/IP** (pre-feature rows, API-created): null fields.
- **Unparseable user-agent**: device falls back to a generic label,
  never an error.
- **current marker on admin view**: marking is caller-relative; the
  admin's own session may also be marked when it appears in the list.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Session records MUST capture `userAgent` and client `ip`
  at creation (login + OIDC callback + token refresh paths that mint
  sessions), via a nullable-column migration — existing rows unaffected.
- **FR-002**: `GET /sessions` rows MUST include `device` (parsed label),
  `ip`, and `current` (true on the row matching the caller's session).
- **FR-003**: Admin `GET /users/:id/sessions` rows MUST include `userId`,
  `device`, `ip` — same serializer shape as the self list.
- **FR-004**: No secret session identifiers leak — `id` stays the
  non-secret `publicId`; `userAgent`/`ip` are not secret-bearing.
- **FR-005**: All four flags flip; the sessions table and admin sessions
  tab render real columns; fallbacks retire.
- **FR-006**: openapi.yaml + regenerated api.md in the same change
  (ADR-104); G2 marked resolved.

## Success Criteria *(mandatory)*

- **SC-001**: 100% of new sessions persist UA+IP at creation.
- **SC-002**: Exactly one `current:true` row per self-list response.
- **SC-003**: Admin list returns `userId` on 100% of rows; non-admin
  callers cannot reach it.
- **SC-004**: No session token hash or secret field exposed (rows expose
  `publicId`-derived `id` only).

## Assumptions

- `location` means the client IP as recorded at login (geo lookup is a
  future enhancement, not required to flip the flag).
- `device` is a coarse parsed label ("Chrome · Windows"-style), derived
  server-side with a small mapper — no new dependency.
- `current` is derived by comparing the request's session hash against
  row ids inside the service — never exposed.
