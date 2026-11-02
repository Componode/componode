# Feature Specification: Audit & Settings

**Feature Branch**: `006-audit-settings`

**Created**: 2026-09-07

**Status**: Shipped

**Input**: User description: "the next spec" (resolved interactively to "Audit & settings" — the remaining v1 feature per the project roadmap: audit trail surface, complete audit coverage, and the admin settings area)

## Context

Earlier features already shipped the audit *write* path — append-only change
records for products, organization entities, and product edges — and the
settings *storage* plus an admin settings page (application settings, OIDC
configuration, user and session administration). What users still cannot do is
**see** the audit trail, and several consequential actions are not recorded at
all. Some configured settings are also stored but never enforced. This feature
delivers the read surface and closes the coverage and enforcement gaps so the
audit trail is trustworthy end to end.

## Clarifications

### Session 2026-09-07

- Q: Who can read the audit trail? → A: The global Activity feed is
  Admin-only; per-entity history is readable by all authenticated users.
- Q: Are authentication/security events in audit scope? → A: Yes — audit
  security-significant auth events (login success/failure, logout, password
  change, OIDC sign-in); routine session touches/renewals are not audited.
- Q: Who is the actor on importer-driven/system-caused audit entries? → A:
  The importer and originating run identity is recorded as the actor; human
  entries record the person.
- Q: Is audit export in scope for v1? → A: No — read surface only; export is
  explicitly deferred to a later feature.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Browse the activity trail (Priority: P1)

An **administrator** opens an **Activity** area and sees a chronological feed of every consequential
change in the system: who acted, what entity or edge was affected, what action
occurred, and when. They can filter the feed by entity type, action, actor, and
time range, and page through history.

**Why this priority**: The audit data is worthless while it is invisible. A
single global feed delivers the core compliance and operational value — "who
changed what and when" — independently of any other work in this feature.

**Independent Test**: Seed or perform a handful of known changes (e.g., rename
a product, add an edge, edit a component), open the Activity area, and confirm
each change appears with the correct actor, entity, action, and timestamp —
delivers full value even if no other story ships.

**Acceptance Scenarios**:

1. **Given** recorded changes exist, **When** an administrator opens the
   Activity area, **Then** they see a reverse-chronological feed showing actor
   name, action, affected entity (with a navigable reference), and timestamp.
2. **Given** the feed contains mixed change types, **When** the user filters by
   entity type (e.g., only products, or only edges) and/or a time range,
   **Then** only matching entries are shown.
3. **Given** an entry references an entity that still exists, **When** the user
   follows the reference, **Then** they land on that entity's detail view.
4. **Given** a signed-out visitor, **When** they attempt to reach the Activity
   feed, **Then** access is denied and they are redirected to sign in.
5. **Given** a signed-in non-administrator (Viewer or Editor), **When** they
   attempt to reach the global Activity feed, **Then** access is denied with a
   permission error; the feed's navigation entry is hidden from them.

---

### User Story 2 - Per-entity and per-run history (Priority: P2)

A user viewing a specific entity (product, component, component group, person,
team, or line of business) can open a history view showing only that entity's
change records. A user reviewing an import run can see which consequential
changes that run produced (newly discovered components, lifecycle/status
transitions) alongside the run's summary counts and recorded errors.

**Why this priority**: Global search is good for "what happened lately";
contextual history answers "what happened to *this* thing" — the more common
question during curation and incident review. It depends on the same read
surface as P1 but is independently shippable.

**Independent Test**: Perform two changes on one entity and one change on
another, open the first entity's history, and confirm exactly its two changes
appear, in order, with no cross-entity leakage.

**Acceptance Scenarios**:

1. **Given** an entity with recorded changes, **When** the user opens its
   history, **Then** they see all of that entity's change records in
   chronological order with actor, action, and field-level detail of what
   changed.
2. **Given** an entity with no recorded changes, **When** the user opens its
   history, **Then** they see a clear empty state (not an error).
3. **Given** a completed import run, **When** the user views the run detail,
   **Then** they can see the consequential changes attributed to that run
   (transitions and discoveries), the run's summary counts, and any recorded
   errors.
4. **Given** an entity whose change record references a since-deleted actor,
   **When** the history is viewed, **Then** the actor's recorded display name
   is still shown even though the actor account no longer exists.

---

### User Story 3 - Complete audit coverage and corrections (Priority: P2)

Every consequential human action in the system leaves an audit record —
including entity edits not yet covered today (component and component-group
edits, importer configuration changes, user administration actions, settings
changes, session revocation) — and every consequential importer transition is
recorded against its run. When a mistake needs correcting, an administrator
records a **correction entry** that references the original record rather than
editing it; the original entry remains untouched and visible.

**Why this priority**: A partial audit trail is misleading — absence of a
record stops meaning "it didn't happen." Closing coverage makes the feed from
P1 trustworthy. Equal priority with US2 because either delivers standalone
value; ordering within the phase is a planning decision.

**Independent Test**: Exercise each mutation surface (component edit, group
edit, importer config save, user role change, settings update, session
revocation), then confirm each produced a correctly attributed audit record.

**Acceptance Scenarios**:

1. **Given** a user edits a component or component group through the normal
   UI/API, **When** the change is saved, **Then** an audit record is created
   capturing the actor, action, and changed fields.
2. **Given** an administrator changes a setting, **When** the change is saved,
   **Then** an audit record is created showing which setting changed (without
   recording secret values — e.g., an OIDC client secret is never written to
   the trail).
3. **Given** an administrator performs a user-administration action (create,
   role change, deactivate, password reset issuance, session revocation),
   **When** the action completes, **Then** an audit record exists.
4. **Given** a recorded audit entry, **When** anyone — including an
   administrator — attempts to modify or delete it through any path, **Then**
   the attempt fails and the entry is preserved.
5. **Given** an incorrect audit entry, **When** an administrator records a
   correction, **Then** a new entry marked as a correction appears referencing
   the original, and the original remains unchanged.
6. **Given** an importer run that discovered new components or flipped
   lifecycle/operational states, **When** the run completes, **Then** those
   transitions are attributable to that run; routine attribute re-upserts
   produce no audit noise.
7. **Given** a failed sign-in attempt, a successful sign-in (local or OIDC),
   a sign-out, or a password change, **When** the event occurs, **Then** an
   audit entry records the actor (or attempted identity), action, and
   timestamp — containing no credentials — while routine session touches
   produce no entry.
8. **Given** an importer-driven audit entry, **When** it is displayed in the
   feed or entity history, **Then** the actor shows the importer/run identity
   (not blank or a generic "system"), and filtering by that actor returns
   exactly the changes that run caused.

---

### User Story 4 - Operational settings take effect (Priority: P3)

An administrator changes operational settings — self-registration toggle,
session idle and absolute timeouts, default role for new users — and the system
actually behaves accordingly: sessions expire per the configured timeouts, the
registration page honors the toggle, and new accounts receive the configured
default role.

**Why this priority**: Settings that are stored but not enforced are worse than
missing settings — they create false confidence. Lower priority only because
the affected settings are few; the fix is independently testable and valuable.

**Independent Test**: Set a short session idle timeout, remain idle past it,
and confirm the next request requires re-authentication; toggle
self-registration off and confirm the registration route is closed.

**Acceptance Scenarios**:

1. **Given** a configured session idle timeout, **When** a session is idle
   longer than that duration, **Then** the next request is rejected as
   unauthenticated.
2. **Given** a configured absolute session timeout, **When** a session's age
   exceeds it regardless of activity, **Then** the session is invalidated.
3. **Given** self-registration is disabled, **When** a visitor reaches the
   registration flow, **Then** registration is refused; **When** it is enabled,
   **Then** a new account can be created and receives the configured default
   role.
4. **Given** settings were changed, **When** the change is saved, **Then** the
   new values take effect without requiring a deployment restart (for
   DB-backed operational settings).

---

### Edge Cases

- An audit entry references an entity that was later hard-deleted: the entry
  remains, showing the recorded display name/type snapshot; navigation to the
  entity is gracefully unavailable rather than broken.
- An actor (person) is hard-deleted: their historical entries retain the
  recorded name snapshot; the actor link is nulled.
- A correction references a non-existent or already-corrected entry: the
  correction is still recorded, referencing whatever identifier was provided,
  and appears in the feed.
- Very large audit volume: the feed paginates; filtering and paging remain
  responsive at hundreds of thousands of entries.
- Settings values that fail validation (e.g., a timeout below a safe minimum
  or above a safe maximum) are rejected with a clear error and the previous
  value is retained.
- An audit write must never be lost if the triggering mutation fails: a failed
  mutation leaves no orphaned audit entry, and a successful mutation always
  leaves its entry.
- Sensitive values (OIDC client secret, passwords, tokens) never appear in
  audit records, settings read responses beyond their defined masked form, or
  log output.
- Concurrent settings updates: the last accepted write wins and the stored
  result is internally consistent (no partial key updates on failure).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST provide a queryable, paginated, read-only view of
  entity change records filterable by entity type, action, actor, and time
  range, ordered reverse-chronologically by default.
- **FR-002**: The system MUST provide the same read-only view for edge change
  records (edge type, endpoints, action, optional reason), presented in the
  same activity surface or an equivalent unified feed.
- **FR-003**: The system MUST provide per-entity change history for every
  auditable entity type, accessible from that entity's detail view.
- **FR-004**: The system MUST present, for each import run, the consequential
  changes attributed to that run together with the run's summary counts and
  recorded errors.
- **FR-005**: The system MUST record an audit entry for every consequential
  human mutation, covering at minimum: product and organization-entity
  changes (already in place), component and component-instance curation edits,
  component-group changes, importer configuration changes, user administration
  actions, settings changes, and session revocation.
- **FR-005a**: The system MUST record an audit entry for security-significant
  authentication events: successful sign-in (local or OIDC), failed sign-in
  attempt, sign-out, and password change. These entries carry actor and
  action but no entity reference; routine session activity (token refresh,
  last-seen updates) MUST NOT be audited. Failed sign-ins record the
  attempted identity (not the password) as the actor name snapshot.
- **FR-005b**: Audit entries caused by a non-human actor MUST record that
  identity as the actor: importer-driven entries record the importer and
  originating run (e.g., "importer: github / run 42") so actor-based
  filtering and run attribution remain meaningful; human entries record the
  person.
- **FR-006**: The system MUST record consequential importer state transitions
  (lifecycle flips, operational status flips, new component discoveries)
  attributed to the run that caused them, and MUST NOT record routine
  attribute re-upserts.
- **FR-007**: Audit records MUST be immutable: no actor — including
  administrators — can modify or delete them through any exposed path.
- **FR-008**: The system MUST allow administrators to append correction
  entries that reference an original audit record, without altering the
  original.
- **FR-009**: Audit records MUST capture a display-name snapshot of the actor
  at write time so history remains readable after the actor is deleted.
- **FR-010**: Every audit write MUST occur atomically with the domain mutation
  it records (both succeed or neither persists).
- **FR-011**: Operational settings (self-registration toggle, session idle
  timeout, session absolute timeout, default user role) MUST be enforced at
  runtime — stored values actually govern session expiry, registration access,
  and new-user role assignment.
- **FR-012**: Settings changes MUST take effect without a service restart and
  MUST themselves produce audit records (with secret values never recorded).
- **FR-013**: All read and write surfaces added by this feature MUST require
  an authenticated session. The global activity feed (FR-001/FR-002) MUST
  additionally require the administrator role; per-entity history views
  (FR-003) MUST be readable by all authenticated roles. Administrative
  mutations (corrections, settings changes) MUST require the administrator
  role.
- **FR-014**: Audit entries MUST retain their recorded context (actor name
  snapshot, entity reference) even when the referenced entity or actor is
  later hard-deleted.
- **FR-015**: The activity feed and history views MUST follow the platform's
  established state matrix (loading, empty, error, populated) and remain
  accessible (keyboard navigable, screen-reader friendly).

### Key Entities *(include if feature involves data)*

- **EntityChange**: an append-only record of a consequential change to one
  entity — entity type, entity reference, action (created/updated/retired/
  transition/correction), changed-field detail, actor reference + name
  snapshot, timestamp, optional attribution to an import run. Security event
  entries (sign-in success/failure, sign-out, password change) use the same
  record with no entity reference.
- **EdgeChange**: an append-only record of a graph-edge mutation — edge type,
  source and target entity references, added/removed action, optional reason,
  actor + name snapshot, timestamp.
- **ImportRunError**: an append-only record of a per-asset failure during an
  import run, surfaced on the run's detail view.
- **ImportRun**: the run summary (counts, terminal status) — immutable once it
  reaches a terminal state; operator annotations are recorded as entity
  changes, not edits to the run.
- **AppSetting**: a named operational setting with a typed value (e.g.,
  self-registration toggle, session timeouts, default user role), distinct
  from infrastructure settings supplied by deployment configuration.
- **OidcConfig**: the structured single-row identity-provider configuration,
  administered through settings; its secret is stored by reference and never
  exposed in audit or read responses.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A signed-in user can answer "who changed X and when" for any
  entity in under 30 seconds using the activity feed or entity history.
- **SC-002**: 100% of the mutation surfaces enumerated in FR-005/FR-006 produce
  a correctly attributed audit record (verified by exercising each surface).
- **SC-003**: The activity feed returns filtered results within 2 seconds at
  100,000 recorded entries.
- **SC-004**: A settings change takes effect within one request cycle — the
  very next affected request observes the new value — with no restart.
- **SC-005**: Zero audit records can be modified or deleted through any
  exposed capability, verified by attempting mutation through every surface.
- **SC-006**: After an actor is deleted, 100% of their historical entries
  still display a human-readable actor name.
- **SC-007**: Audit history views and the activity feed pass the same
  accessibility bar as existing surfaces (full keyboard operation, correct
  announcements, visible focus).

## Assumptions

- **Audit read access**: per clarification, the global Activity feed is
  Admin-only; per-entity history is readable by all authenticated users. Only
  administrators may append corrections or change settings.
- **Scope**: this feature completes the audit *and* settings surfaces begun by
  earlier features. Storage, append-only integrity enforcement, the write
  path for products/organization/edges, the settings page, OIDC
  configuration, and user/session administration already exist and are not
  re-specified here — this feature extends and wires them.
- **No retention policy** in v1: audit records are retained indefinitely
  (consistent with ratified decisions).
- **Read-access auditing is out of scope**: viewing data is not itself an
  audited event in v1.
- **Import-run operator notes** are recorded as entity changes attributed to
  the run, not as edits to the run record.
- **Correction UX**: a correction is an explicit administrator action from the
  audit entry itself; no approval workflow is required in v1.
- **Out of scope (clarified)**: audit export (CSV/JSON or otherwise) is
  deferred to a later feature; the v1 surface is browse/filter only. Also out
  of scope per ratified decisions: audit retention policies and read-access
  auditing.
