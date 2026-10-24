# Feature Specification: Self-Service Profile Update

**Feature Branch**: `030-self-service-profile`

**Created**: 2026-10-24

**Status**: Draft

**Input**: User description: "Resolve ux-rewrite gap G14 — self-service
profile update. Non-admin users currently cannot save their own profile:
updating a user requires the admin-only user-update permission, so saving
the profile settings page returns 403 for non-admins and the UI falls back
to a read-only form behind the profileSelfEdit flag. Add a self-service
update path so any authenticated user can update their own display name
and email, without gaining admin powers over other accounts or any
self-escalation path — role, active status, and team assignment stay
admin-only. Flip the profileSelfEdit flag on success and mark G14 resolved
by this spec per the gap-registry convention."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Member updates own profile (Priority: P1)

A non-admin user (EDITOR or VIEWER) opens their profile settings and edits
their display name and email. Today the save fails: the update path is
admin-only, so the UI renders a read-only form with a footer note instead
of a save that is guaranteed to fail. After this feature, the same user
edits and saves successfully, and the new values are reflected everywhere
their identity is displayed.

**Why this priority**: This is the entire gap — a whole class of users
cannot perform a routine self-service action that every comparable tool
allows, and the UI already ships the editable form waiting for the
capability. It is the MVP and the reason the spec exists.

**Independent Test**: Sign in as a non-admin user, change display name and
email on the profile settings page, save, and reload — the new values
persist and appear on the profile. Delivers value on its own with no
other story required.

**Acceptance Scenarios**:

1. **Given** a signed-in non-admin user, **When** they submit a valid
   display name and email on their own profile, **Then** the update
   succeeds and the stored record reflects both values.
2. **Given** a signed-in non-admin user, **When** they view their profile
   settings, **Then** the form is editable (no read-only fallback, no gap
   notice).
3. **Given** a signed-in user of any role, **When** they read their own
   profile after saving, **Then** it returns the updated values.
4. **Given** an admin user, **When** they update their own profile through
   the same self-service path, **Then** it succeeds identically — the
   self-service path is not admin-incompatible.

---

### User Story 2 - Self-edit cannot escalate privileges (Priority: P2)

A non-admin user attempts to modify privileged attributes — their own
role, their own active status, their team assignment, their username, or
another user's record — through the self-service update path. Every such
attempt is rejected or ignored, leaving privileged attributes unchanged.

**Why this priority**: The feature exists specifically to *not* grant
admin powers. A self-edit path that also lets users promote themselves to
admin, deactivate themselves out of an audit trail, or reassign their team
would be a privilege-escalation hole worse than the gap it closes. It is
P2 rather than P1 only because the safe default (reject unknown/privileged
fields) is the straightforward implementation of P1 — but it must be
tested explicitly.

**Independent Test**: Submit self-service update requests containing
privileged fields and verify they are rejected while legitimate fields
still save; confirm an unauthenticated request fails; confirm no user can
address another user's record through the self path.

**Acceptance Scenarios**:

1. **Given** a signed-in non-admin user, **When** their update request
   includes a role change, **Then** the request is rejected and their role
   is unchanged.
2. **Given** a signed-in non-admin user, **When** their update request
   includes active-status or team-assignment changes, **Then** the request
   is rejected and those attributes are unchanged.
3. **Given** a signed-in user, **When** they attempt to update another
   user's record through the self-service path, **Then** there is no way
   to address another record — the path is bound to the caller's identity.
4. **Given** no authenticated session, **When** a request reaches the
   self-service update path, **Then** it is rejected as unauthenticated.

---

### User Story 3 - Self-edits are audited like admin edits (Priority: P3)

When a user updates their own profile, an audit entry records the change
attributed to that user — indistinguishable in kind from an admin edit of
the same record — so the activity feed and entity history stay complete.

**Why this priority**: The audit pipeline already exists; self-edits
flowing through it is a consistency expectation rather than new value.
Listed last because it follows mechanically from routing the update
through the existing service.

**Independent Test**: Perform a self-service profile update and verify an
audit record names the caller as the actor with the changed fields.

**Acceptance Scenarios**:

1. **Given** a signed-in user, **When** they update their own profile,
   **Then** an audit entry attributes the change to them with the modified
   fields, matching the shape of admin-initiated user updates.

---

### Edge Cases

- **Invalid input**: malformed email or an over-length display name
  receives the same validation failure an admin edit would — no relaxed
  rules for the self path.
- **Clearing optional fields**: setting display name or email back to
  empty follows the same rules as the admin update path.
- **Username immutability**: usernames are identifiers; the self path
  cannot rename one, matching the admin path.
- **Password untouched**: password changes remain on the existing
  change-password flow — the self-service profile path never accepts
  credential material.
- **OIDC-authenticated users**: users who signed in via OIDC can edit the
  same local profile attributes; there is no IdP profile sync that would
  overwrite them.
- **Session continuity**: updating one's own profile does not invalidate
  the caller's session or require re-authentication.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Any authenticated user MUST be able to update their own
  display name and email through a self-service path bound to the caller's
  identity — no record identifier selects another user's record.
- **FR-002**: The self-service path MUST NOT accept changes to role,
  active status, team assignment, username, password, or any attribute
  beyond display name and email; requests carrying them MUST be rejected
  per the project's input-validation rules.
- **FR-003**: Validation rules for the self-service path MUST match the
  admin update path (email format, display-name length).
- **FR-004**: Successful self-service updates MUST produce audit records
  attributed to the calling user, consistent with admin-initiated updates.
- **FR-005**: The admin-only update path MUST remain functionally
  unchanged — admins keep their existing capabilities over any user
  record.
- **FR-006**: Unauthenticated requests to the self-service path MUST be
  rejected, consistent with the authenticated-route rule.
- **FR-007**: Non-admin users MUST be shown the editable profile form —
  the `profileSelfEdit` gap flag flips and the read-only fallback is
  retired for the self-edit case.
- **FR-008**: Any new or changed API surface MUST follow the project's
  API conventions (`/api/v1`, controlled error codes, `docs/openapi.yaml`
  updated in the same change per ADR-104).

### Key Entities

- **User**: the account record. Self-editable attributes: `displayName`,
  `email`. Admin-only attributes (unchanged by this feature): `role`,
  `isActive`, `teamId`, `username`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of authenticated non-admin users can save a valid
  display-name/email change on their own profile without admin
  involvement — previously 0%.
- **SC-002**: 100% of self-service update attempts carrying privileged or
  unknown fields are rejected with no partial application.
- **SC-003**: 100% of self-service profile changes appear in the audit
  trail attributed to the editing user.
- **SC-004**: Zero paths exist by which a non-admin can modify another
  user's record or their own privileged attributes through the
  self-service surface (verified by tests).
- **SC-005**: The profile-settings page for non-admins presents an
  editable, submittable form in all sessions — the flagged read-only
  fallback no longer renders.

## Assumptions

- A dedicated self-scoped update path (e.g., against the caller's own
  identity) is the expected shape; widening the admin-only `user:update`
  permission to cover self-edits is explicitly out of scope because it
  cannot express the restricted field set.
- Display name and email are local attributes: no OIDC/IdP profile sync
  exists in v1 that would overwrite them after a self-edit.
- Clearing optional fields behaves identically to the admin update path
  (same nullability rules).
- The profile-settings UI (editable form, flag fallback) already exists
  from spec 029 — this feature wires it, it does not redesign it.
- Password and credential changes stay on existing flows and are out of
  scope.
