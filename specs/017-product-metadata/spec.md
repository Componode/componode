# Feature Specification: Practical Catalog Metadata

**Feature Branch**: `feature/017-product-metadata`

**Created**: 2026-10-31

**Status**: Draft

**Input**: Add practical, all-optional metadata to Digital Products and Components — links, tags, criticality, and a planned sunset date — per the practical-DPAM grilling session ratified in [ADR-111](../../researches/adrs/ADR-111-practical-catalog-metadata.md).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Attach reference links to catalog entries (Priority: P1)

As a catalog maintainer, I want to attach titled links (repository, runbook,
monitoring dashboard, design doc) to a product or component so anyone landing
on its detail page can jump straight to the operational context — without
hunting through chat or wiki searches.

**Why this priority**: Links are the single highest-value addition — they turn
the detail page from a description into a jumping-off point. Cheap to add,
immediately useful, and the most-requested capability in practical catalogs.

**Independent Test**: Create a product or component with two links, reopen its
detail page, click through — delivers full value even if no other story ships.

**Acceptance Scenarios**:

1. **Given** an existing product, **When** I add a link "Runbook" pointing to
   a valid web address and save, **Then** the link appears on the product's
   detail page and clicking it opens the URL.
2. **Given** a component with links, **When** I edit the component and remove
   one link, **Then** the remaining links persist in their original order.
3. **Given** the link form, **When** I enter a title longer than 80
   characters, an empty title, or a URL that is not http/https, **Then** the
   entry is rejected with a clear inline validation error and nothing is
   saved.
4. **Given** an entity that already has 20 links, **When** I try to add a
   21st, **Then** the system rejects it with a message explaining the limit.

---

### User Story 2 - Label and find entries with tags (Priority: P1)

As a catalog maintainer, I want to attach free-form tags to products and
components and filter list views by tag so I can slice the catalog along
lines the fixed taxonomy doesn't cover ("pci", "deprecated-deps",
"team-alpha") — before any formal taxonomy exists.

**Why this priority**: Tags are the pragmatic substitute for premature
classification; they self-organize the catalog. Filtering makes them
immediately useful rather than decorative.

**Independent Test**: Tag two products with "pci" and one with "beta", filter
the product list by "pci" — only the two tagged products appear.

**Acceptance Scenarios**:

1. **Given** a product being created or edited, **When** I enter tags "PCI",
   "pci ", and "pci-compliance", **Then** they are normalized to lowercase,
   the duplicate is removed, and the result stored as `pci` and
   `pci-compliance`.
2. **Given** products tagged variously, **When** I filter the product list by
   tag "pci", **Then** only products carrying exactly that tag are listed.
3. **Given** a component, **When** I filter the component list by a tag the
   component carries, **Then** it appears in the results.
4. **Given** a tag containing characters outside lowercase alphanumerics,
   dot, underscore, colon, or hyphen — or longer than 32 characters, or
   pushing the entity past 20 tags — **When** I submit, **Then** it is
   rejected with a clear inline error.

---

### User Story 3 - Mark product criticality for triage (Priority: P2)

As a product owner or incident responder, I want to record how critical each
Digital Product is (`CRITICAL`, `HIGH`, `MEDIUM`, `LOW`) and filter the
product list by criticality, so during an incident I can immediately tell
which products matter most.

**Why this priority**: Criticality is one field that answers the first real
incident question — "is this tier-1?" — but it is useless without the
attention-surfacing context that later specs provide, so it ranks below the
two P1 metadata stories.

**Independent Test**: Set `CRITICAL` on one product, `LOW` on another, filter
the list by `CRITICAL` — only the first product appears with its badge.

**Acceptance Scenarios**:

1. **Given** a product with no criticality, **When** I set it to `HIGH` and
   save, **Then** the product detail and list entry display the `HIGH`
   badge.
2. **Given** products with mixed criticality values, **When** I filter the
   product list by `CRITICAL`, **Then** only `CRITICAL` products appear.
3. **Given** a product with criticality set, **When** I clear it, **Then**
   the product saves with criticality unset and displays no badge.
4. **Given** a create/update payload containing a criticality outside the
   four allowed values, **When** submitted, **Then** it is rejected with a
   validation error.
5. **Given** a component, **When** I view its detail page, **Then** no
   criticality field is shown (criticality applies to products only).

---

### User Story 4 - Record a planned sunset date (Priority: P2)

As a product owner, I want to record the date a product or component is
planned to retire so the catalog communicates "this is going away" before it
actually does — while staying ACTIVE until someone deliberately retires it.

**Why this priority**: Sunset planning keeps the catalog honest about
end-of-life without adding a lifecycle state machine — a date informs, a
person decides.

**Independent Test**: Set a sunset date 60 days out on a product — a neutral
"Sunset {date}" badge appears; set one in the past — an "overdue" badge
appears while the product stays ACTIVE.

**Acceptance Scenarios**:

1. **Given** a product or component, **When** I set a sunset date more than
   30 days in the future, **Then** a neutral "Sunset {date}" badge is
   displayed.
2. **Given** an entity whose sunset date is within 30 days, **When** I view
   it, **Then** an amber "Sunset in {n}d" badge is displayed.
3. **Given** an entity whose sunset date has passed and is still ACTIVE,
   **When** I view it, **Then** a red "Sunset overdue" badge is displayed
   and the entity remains ACTIVE (no automatic transition).
4. **Given** an entity with a sunset date, **When** I clear the field,
   **Then** no badge is shown and the record persists with no date.
5. **Given** a RETIRED entity with a sunset date, **When** I view it,
   **Then** the overdue styling does not apply (retirement already
   happened).

---

### Edge Cases

- A link URL that passes validation on save but later becomes unsafe —
  rendering MUST re-validate URLs at display time, so stored data can't
  inject a dangerous href.
- Updating an entity while leaving every metadata field untouched MUST not
  clear any of them (partial-update semantics).
- Removing the last link or tag MUST persist an empty collection, not an
  error.
- All four fields are optional: creating a product or component with none of
  them MUST succeed, and all pre-existing records remain valid with no
  backfill.
- A change to any metadata field MUST appear in the entity's audit history
  like any other field change.
- Duplicate link URLs are allowed (different titles may point at the same
  destination); duplicate tag values are not (normalized + deduplicated).
- Components are importer-maintained: a reconciliation/upsert run MUST NOT
  create, modify, or clear human-curated `links`, `tags`, or `sunsetAt` on a
  component — importer writes are confined to importer-owned fields.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Users MUST be able to attach an ordered list of links (title +
  URL) to a Digital Product and to a Component, up to 20 per entity.
- **FR-002**: Each link MUST have a non-empty title (≤80 characters) and a
  URL restricted to http/https; entries failing either rule MUST be rejected
  with a field-level validation error.
- **FR-003**: Links MUST be displayed on the entity's detail page in the
  order they were entered, each opening its URL.
- **FR-004**: Users MUST be able to attach free-form tags to a Digital
  Product and to a Component, up to 20 per entity.
- **FR-005**: Tags MUST be normalized at write time — trimmed, lowercased,
  deduplicated — and each tag MUST start with a lowercase alphanumeric
  followed by up to 31 characters of lowercase alphanumerics, `.`, `_`,
  `:`, or `-` (maximum 32 characters total).
- **FR-006**: Both product and component list views MUST support filtering by
  a single tag value (exact match).
- **FR-007**: Users MUST be able to set a product's criticality to one of
  `CRITICAL`, `HIGH`, `MEDIUM`, `LOW`, or leave it unset; the product list
  MUST support filtering by criticality.
- **FR-008**: Criticality MUST NOT be available on Components.
- **FR-009**: Users MUST be able to set or clear an optional sunset date on
  both Digital Products and Components.
- **FR-010**: Sunset display MUST have three states — neutral badge when the
  date is more than 30 days out, amber when 30 days or fewer remain, red
  "overdue" when the date has passed while the entity is `ACTIVE` — and MUST
  NEVER change the entity's lifecycle automatically.
- **FR-011**: All four metadata fields MUST be optional in both create and
  update flows; omitting them MUST leave existing values unchanged and MUST
  NOT block saving.
- **FR-012**: Changes to metadata fields MUST be recorded in the entity's
  audit history consistently with other field changes.
- **FR-013**: Unknown or malformed values for any new field MUST be rejected
  at the API boundary, consistent with the project's strict-input rule.
- **FR-014**: Editing permissions for metadata MUST match the entity's
  existing update permission — no new roles or permission gates.
- **FR-015**: Importer reconciliation MUST NOT write the new metadata fields —
  `links`, `tags`, and `sunsetAt` on a Component are human-curated only and
  MUST survive every importer upsert unchanged.

### Key Entities *(include if feature involves data)*

- **DigitalProduct** — gains optional `links`, `tags`, `criticality`,
  `sunsetAt`.
- **Component** — gains optional `links`, `tags`, `sunsetAt` (no
  `criticality`).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can attach a runbook link to a product and reach that
  runbook from the detail page in under 1 minute.
- **SC-002**: Filtering a list by tag or criticality returns exactly the
  matching subset — 100% precision and recall against manual tag
  assignment.
- **SC-003**: 100% of pre-existing products and components remain valid and
  editable with zero data migration required by users.
- **SC-004**: A product 10 days from its sunset date is visibly flagged on
  first view of its detail or list entry — no navigation required to
  discover it.
- **SC-005**: Zero lifecycle transitions occur automatically at a sunset
  date (verified across a date rollover).

## Assumptions

- Links are display-only navigation aids — no "find everything linking to X"
  query and no link health checking in this feature.
- The tag filter accepts a single tag value; multi-tag (AND/OR) filtering is
  deferred.
- Sorting by criticality rank is deferred — the criticality filter and badge
  are sufficient for triage.
- Sunset date is a calendar date with no time-of-day or timezone nuance;
  "overdue" is evaluated against the current date.
- No new permissions are introduced — editing metadata uses each entity's
  existing update permission.
- All limits (20 links, 20 tags, 32-char tags, 80-char titles) follow
  ADR-111; they are guardrails against abuse, not domain rules, and can be
  revisited without an ADR change.
