# Feature Specification: Detail Reads + Feed Names

**Feature Branch**: `033-detail-reads-feed-names`

**Created**: 2026-10-26

**Status**: Draft

**Input**: User description: "Resolve ux-rewrite gaps G7, G8, G9, and G11
— detail reads + feed names. Team and LOB detail endpoints do not exist
(`GET /teams/:id`, `GET /lobs/:id`); component-group detail is addressed
by id while the UX routes carry a slug; and audit feed items carry
`entityType:entityId` pairs with no display name, so every activity
surface renders raw identifiers. Ship direct detail reads and named feed
rows. No flags — all four gaps resolve unflagged."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Activity feed rows name what changed (Priority: P1)

A signed-in user opens the dashboard, the activity page, or an entity's
history tab. Every feed row reads as a sentence — "<actor> updated
component **payments-db**" — never "`digital_product:0194…`". Rows whose
target entity can no longer be resolved render a defined fallback instead
of a raw identifier pair.

**Why this priority**: the most visible of the four gaps — every audit
surface (dashboard recent activity, `/ux/activity`, per-entity history
tabs, run-detail changes) currently exposes internal identifiers to users.

**Independent Test**: seed changes on named entities; feed rows render the
entity's display name; hard-delete an entity and its history rows still
render a clean fallback, never `type:id`.

**Acceptance Scenarios**:

1. **Given** an entity change on a named Component, **When** the feed
   renders, **Then** the row shows the component's display name.
2. **Given** an edge change between two named entities, **When** the feed
   renders, **Then** both endpoints appear by name, not id.
3. **Given** a change whose entity has been deleted (or whose `entityId`
   is null, e.g. settings/auth events), **Then** the row renders the
   defined fallback gracefully.

---

### User Story 2 - Detail pages read a single entity directly (Priority: P2)

A user navigates to a Team, Line of Business, or Component Group detail
page — by URL or deep link. The page resolves the entity with one direct
read; it does not fetch the full list and match client-side.

**Why this priority**: detail pages work today only because the
list-and-match fallback happens to hold. It breaks under pagination,
scales with catalog size, and cannot distinguish "not found" from
"not on this page of the list."

**Independent Test**: open a team, LOB, and component-group detail URL
directly; each issues one single-entity read; an unknown identifier
yields a 404-shaped not-found state.

**Acceptance Scenarios**:

1. **Given** a Team exists, **When** its detail read is requested by the
   identifier the UX route carries, **Then** the API returns the team —
   and 404 for an unknown identifier.
2. **Given** a Line of Business exists, **When** its detail read is
   requested, **Then** the API returns the LOB — same contract.
3. **Given** a Component Group exists, **When** its detail is requested
   by slug (the identifier `/ux/component-groups/:slug` carries), **Then**
   the API returns the group — consistent with product and component
   detail reads.

---

### Edge Cases

- **Unknown identifier** on any new detail read → `404` with the standard
  `{code, message}` error envelope; no partial object.
- **Retired / inactive entities**: detail reads return the entity as-is —
  lifecycle filtering applies to list and dashboard queries, not explicit
  detail fetches.
- **Renamed entity**: feed rows show a resolvable current-or-recorded
  name per the implementation's choice; they never show a stale raw id
  pair when a name exists.
- **Deleted entity history**: rows survive the entity; name field carries
  the defined empty value and the client renders its fallback.
- **Slug-addressed group read vs. existing `GET /component-groups/:id`**:
  the id-addressed read keeps working for existing callers; slug
  resolution is additive.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The API MUST expose a single-entity read for **Team** —
  returning the team record or `404 NOT_FOUND`.
- **FR-002**: The API MUST expose a single-entity read for **Line of
  Business** — same contract.
- **FR-003**: The Component Group detail read MUST be resolvable by
  **slug** — the identifier the UX detail route carries — consistent with
  how product and component detail reads already resolve.
- **FR-004**: Audit feed items MUST carry the target entity's
  human-readable display name. Entity-kind items carry `entityName`;
  edge-kind items carry display names for both the `from` and `to`
  endpoints.
- **FR-005**: When a feed item's entity (or edge endpoint) cannot be
  resolved to a name — deleted entity, null `entityId`, non-entity events
  — the name field MUST carry a defined empty value (null) and the client
  MUST render a clean fallback, never a `type:id` pair.
- **FR-006**: The UX detail pages for teams, LOBs, and component groups
  MUST consume the direct reads — the list-and-match resolution is
  retired for these surfaces.
- **FR-007**: The feed mapper MUST render the provided names; for
  genuinely unresolvable rows it renders the entity-kind label — never a
  raw identifier or `type:id` pair.
- **FR-008**: `docs/openapi.yaml` and regenerated `docs/api.md` ship in
  the same change (ADR-104); gaps G7, G8, G9, and G11 are marked resolved
  in `researches/ux-rewrite-gaps.md`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Each affected detail page loads with exactly one entity
  read — zero full-list fetches for slug resolution.
- **SC-002**: 100% of feed rows whose target entity exists render a
  display name instead of `entityType:entityId`.
- **SC-003**: 100% of feed rows for unresolvable entities render the
  defined fallback — no raw identifier pairs, no broken rows.
- **SC-004**: Unknown identifiers on the new reads return `404` with the
  standard error envelope 100% of the time.
- **SC-005**: The route-coverage contract test passes — every new route
  is declared in `openapi.yaml` with matching auth metadata.

## Assumptions

- Detail reads resolve by **slug** — the identifier all UX detail routes
  carry — consistent with `GET /products/:slug` and
  `GET /components/:slug`. Whether the team/LOB routes take a `:slug`
  param or accept id-or-slug on `:id` is a plan-level decision; the
  requirement is one direct read with no client-side list scan.
- Feed display names are resolved server-side (join or recorded); the
  storage choice is plan-level. The spec fixes the observable contract —
  a name or a defined null.
- All four gaps are flagless per `researches/ux-rewrite-gaps.md` — no
  feature flags flip; surfaces already render and get real data.
- Group members, team members, and related-object payloads on the new
  detail reads match what the corresponding list row already exposes;
  richer detail composition (member lists, owned products) remains
  fetched through the existing dedicated endpoints.
