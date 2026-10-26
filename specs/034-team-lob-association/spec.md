# Feature Specification: Team ↔ LOB Association

**Feature Branch**: `034-team-lob-association`

**Created**: 2026-10-26

**Status**: Draft

**Input**: User description: "034 — team↔LOB (G12). Resolve ux-rewrite gap
G12: teams carry no LOB association today, so the product form shows every
team unfiltered ('Teams aren't linked to LOBs yet') and team detail cannot
say which Line of Business a team belongs to. Add a Team → LOB association:
teams may be assigned to at most one Line of Business, the association is
editable through org management, the product form's team picker filters by
the product's selected LOB, and team detail surfaces its LOB. Flagless —
the gap carries no flag."

## Clarifications

### Session 2026-10-26

- Q: When a product's LOB is selected in the product form, should teams
  with no LOB association remain selectable in the team picker alongside
  the selected LOB's teams? → A: LOB teams + explicit "other" group —
  show the LOB's teams first, then a visually separated group of all
  remaining teams; no team is hidden.
- Q: Should the LOB detail page also list its associated teams (the
  reverse direction), or is showing the LOB on the team's detail page
  sufficient for this spec? → A: Both directions — LOB detail also lists
  its associated teams.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Product form narrows teams to the selected LOB (Priority: P1)

A catalog editor creates or edits a Digital Product and picks its owning
Line of Business. The owning-team picker promotes that LOB's teams to the
top of the list, with every remaining team still reachable in a visually
separated group below — nothing is hidden. The "Unassigned" option stays
available, so ownership can always be expressed.

**Why this priority**: this is the gap's headline surface — the form
currently apologizes for showing all teams. It is the daily path for
recording product ownership correctly.

**Independent Test**: with two LOBs and teams distributed across them
plus at least one unassociated team, open the product form, select a LOB,
and confirm the team picker leads with that LOB's teams and offers all
remaining teams in a separate group; save and confirm the assignment
persists.

**Acceptance Scenarios**:

1. **Given** LOB "Retail" has teams A and B and LOB "Platform" has team C,
   **When** the editor selects "Retail" as the product's LOB, **Then**
   the team picker lists A and B first, with C and all unassociated teams
   reachable in a separate group alongside "Unassigned".
2. **Given** no LOB selected on the product form, **When** the editor
   opens the team picker, **Then** all teams are listed.
3. **Given** a product whose owning team belongs to a different LOB than
   the one just selected, **When** the editor changes the LOB, **Then**
   the already-chosen team is not silently cleared — it remains visible
   and selected until the editor changes it.

---

### User Story 2 - Teams record their LOB (Priority: P2)

An administrator creates or edits a Team and can assign it to a Line of
Business — or leave it unassociated. Team list and detail views surface
the association: the team's detail page names its LOB, and the LOB's
detail page lists its associated teams, so a user can navigate the
relationship in both directions. Removing the association later is a
normal edit, not a special operation.

**Why this priority**: the association is the data the P1 filter consumes;
without it nothing else works. It stands alone as an MVP — teams gain a
real attribute even before any filtering surface uses it.

**Independent Test**: create a team with a LOB, read it back on list and
detail, edit it to a different LOB, then clear it — each step reflected
in the API and UI.

**Acceptance Scenarios**:

1. **Given** an administrator on the team create/edit dialog, **When**
   they choose a LOB, **Then** the team persists the association and it
   is returned on team list and detail reads.
2. **Given** a team with a LOB, **When** a user opens the team detail
   page, **Then** the page displays the LOB by name.
3. **Given** a LOB with associated teams, **When** a user opens the LOB
   detail page, **Then** the page lists those teams; a LOB with no
   associated teams shows an empty state.
4. **Given** a team with a LOB, **When** the administrator clears the
   association, **Then** subsequent reads report no LOB for the team and
   the team no longer appears on the LOB's detail page.

---

### Edge Cases

- **LOB deleted**: teams associated with the deleted LOB remain; their
  association is cleared (set-null semantics, consistent with the other
  ownership references in the model). No cascade, no orphaned reference.
- **LOB renamed**: team detail and the product form show the LOB's
  current name — the association is by identity, not by name.
- **Product/team mismatch**: the association is *advisory* — the API does
  not reject a product whose owning team belongs to a different LOB (or
  no LOB). Cross-LOB staffing is legitimate; the filter guides, it does
  not police.
- **Existing data**: all pre-existing teams have no association; they
  behave as unassociated teams — visible under every LOB filter until an
  administrator assigns them.
- **Unknown LOB identifier** submitted on a team write is rejected with
  the standard error envelope — never silently stored or coerced.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A Team MUST carry an optional association to a single Line
  of Business. A team belongs to at most one LOB; a LOB may have many
  teams.
- **FR-002**: Team create and update operations MUST accept the
  association (set, change, or clear), validated against existing LOBs;
  an unknown LOB identifier MUST be rejected with the standard
  `{code, message}` error envelope.
- **FR-003**: Team list and detail reads MUST expose the association,
  including enough LOB identity for clients to render its display name.
- **FR-004**: The org-management team form MUST let an administrator
  assign, change, or clear a team's LOB; the team detail view MUST
  display the team's LOB by name, and the LOB detail view MUST list its
  associated teams (with an empty state when none).
- **FR-005**: The product form's team picker MUST group by the
  product's selected LOB: teams of that LOB are listed first, and every
  remaining team — other LOBs' teams and unassociated teams alike —
  stays reachable in a visually separated group; no team is hidden. When
  no LOB is selected all teams are offered ungrouped. A current
  selection is never silently cleared. The
  "Teams aren't linked to LOBs yet" notice is removed.
- **FR-006**: The association MUST NOT constrain other surfaces —
  product ownership writes accept any team regardless of LOB, persons
  gain no new LOB field (they inherit context through their team), and
  no junction or polymorphic edge table is introduced for this link.
- **FR-007**: Deleting a LOB MUST clear the association on its teams
  (set-null) while leaving the teams intact.
- **FR-008**: Changes to a team's LOB MUST appear in the team's entity
  history / audit surfaces like other team field changes.
- **FR-009**: `docs/openapi.yaml` and regenerated `docs/api.md` ship in
  the same change for any endpoint contract that changes (ADR-104); gap
  G12 is marked resolved in `researches/ux-rewrite-gaps.md`, and the
  roadmap entry is updated.

### Key Entities *(include if feature involves data)*

- **Team**: gains an optional LOB association — the new fact this
  feature introduces. Identity, slug, and lifecycle rules are unchanged.
- **Line of Business**: gains no new fields; it becomes reachable from
  teams and its detail view derives the list of its teams. Deletion
  clears associations on its teams.
- **Digital Product**: unchanged — its existing `lobOwnerId` /
  `teamOwnerId` pair is what the form filter relates.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: With a LOB selected, the product form's team picker leads
  with 100% of that LOB's teams and keeps 100% of remaining teams
  reachable in a separated group — no offered team is hidden.
- **SC-002**: 100% of team reads (list and detail) report the team's LOB
  association or its defined empty value, and the LOB detail view lists
  100% of its associated teams — no surface renders a raw unresolved
  identifier.
- **SC-003**: An administrator can assign, change, and clear a team's
  LOB in a single edit each, with the result visible on the team detail
  page without manual refresh beyond the app's normal query
  invalidation.
- **SC-004**: Deleting a LOB leaves 100% of its associated teams intact
  with the association cleared — verified by re-reading the teams.
- **SC-005**: The route-coverage contract test passes — every changed
  endpoint contract is declared in `openapi.yaml` with matching auth
  metadata.

## Assumptions

- The link is a **single optional association per team** (team → at most
  one LOB), matching the gap entry's "`lobId` on teams" phrasing and the
  catalog's other ownership references. A many-to-many membership model
  is out of scope.
- The filter is **advisory, not enforced** — the API accepts any
  team/LOB pairing on products. Consistency between a product's LOB and
  its team's LOB is the user's responsibility.
- The picker **groups, not filters** (clarified 2026-10-26): the
  selected LOB's teams lead the list; all other teams — other LOBs' and
  unassociated alike — remain selectable in a separate group.
- Whether grouping happens client-side (teams already carry the
  association) or via a `?lobId=` list parameter is a plan-level
  decision; the observable contract is the picker's behavior.
- Role requirements for editing the association match existing team
  create/update permissions — no new permission is introduced.
- Person records already reference their team (`persons.teamId`); a
  person's LOB context is derived through the team, not duplicated.
