# Feature Specification: Schema-Driven Importer Forms

**Feature Branch**: `037-schema-driven-importer-forms`

**Created**: 2026-10-30

**Status**: Draft

**Input**: User description: "037 — schema-driven importer forms (G13).
Resolve ux-rewrite gap G13: the importer create/edit form edits `scope` as
raw JSON because the API previously could not express each importer's
config fields. `GET /importers` now ships `configSchema` serialized to
JSON Schema (spec 036); render field-level scope controls from that schema
instead of asking operators to hand-write JSON."

## Clarifications

### Session 2026-10-30

- Q: When a scope field's schema default is pre-filled but untouched,
  should the submitted scope include it explicitly or omit the key? → A:
  Submit defaults explicitly — the form displays the default, so the
  stored scope is self-documenting and pinned against future importer
  default changes.
- Q: When editing a config whose stored scope contains keys no longer in
  the schema, what should the typed form do with them? → A: Render them
  in a labeled "unrecognized fields" JSON sub-editor — preserved on save
  unless the operator removes them; never silently dropped or carried
  invisibly.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Configure scope with typed fields (Priority: P1)

An operator creating a new importer config selects an importer (e.g.
GitHub) and sees a form field per scope property — a text input for `org`,
a dropdown for `billingPeriod`, toggles for the `include*` booleans, a
list editor for `repos` — instead of a JSON textarea. Required fields are
marked; defaults are pre-filled. The operator fills in the fields and
saves; the submitted scope passes the importer's validation unchanged.

**Why this priority**: This is the entire gap — hand-writing JSON is the
single worst interaction in the importer form (no discoverability, no
validation until submit, easy syntax errors). Every importer config flows
through this section.

**Independent Test**: Can be fully tested by creating a config for each of
the 8 in-tree importers using only the rendered fields (no JSON editing)
and verifying each saved `scope` round-trips through the existing
server-side schema validation.

**Acceptance Scenarios**:

1. **Given** the operator opens the new-importer form and selects GitHub,
   **When** the scope section renders, **Then** it shows a field per
   schema property with required fields marked and schema defaults
   pre-filled — no JSON is visible.
2. **Given** the operator leaves a required field (e.g. `org`) empty,
   **When** they submit, **Then** the field shows an inline error and
   nothing is sent to the server.
3. **Given** the operator fills all required fields, **When** they save,
   **Then** the created config's `scope` contains exactly the entered
   values plus the schema-declared defaults, and the run accepts it.
4. **Given** the operator edits an existing config, **When** the form
   opens, **Then** each scope field is pre-populated from the stored
   `scope` (not defaults), and saving preserves untouched values.

---

### User Story 2 - Safe fallback for complex fields (Priority: P2)

An importer's schema contains a construct the field renderer does not
support as a dedicated control (e.g. GitHub's `environmentMapping`
key→value record). The operator still needs to set it. The form renders
that field as a small per-field JSON editor — clearly labeled — while the
rest of the scope stays on typed controls. A "Edit as JSON" toggle lets
power users drop the whole scope back to the raw JSON editor at any time,
preserving their work in both directions.

**Why this priority**: Without it, unsupported schema constructs are
either uneditable (data loss for `environmentMapping`) or force the whole
form back to JSON — the field renderer must degrade gracefully per field,
not per importer.

**Independent Test**: Can be tested by opening the GitHub importer form,
confirming `environmentMapping` renders a JSON sub-editor while every
other property gets a typed control, entering a valid mapping, and
verifying it lands in the saved scope.

**Acceptance Scenarios**:

1. **Given** a schema property whose shape has no dedicated control,
   **When** the form renders, **Then** that property shows a labeled
   JSON sub-editor while sibling properties keep typed controls.
2. **Given** the operator toggles "Edit as JSON", **When** the raw editor
   opens, **Then** it contains the current field values serialized —
   edits in either mode are preserved when toggling back.
3. **Given** invalid JSON in a sub-editor or raw mode, **When** the
   operator submits, **Then** an inline error names the offending field
   and nothing is sent.

---

### User Story 3 - No silent scope loss on importer switch (Priority: P3)

While creating a config, the operator changes the selected importer. The
scope fields re-render for the new importer's schema, seeded with its
defaults — values from the previous importer never leak across (a
regression already fixed for the JSON editor in spec 036, preserved for
typed fields). If the operator had entered values, the switch discards
them after the same behavior the shipped form already has — no new
confirmation flow.

**Why this priority**: Correctness guard — cross-importer key leakage
produces scopes that fail validation or, worse, silently carry wrong keys.

**Independent Test**: Select GitHub, type into `org`, switch to
Kubernetes — confirm `org` is gone and Kubernetes' defaults render.

**Acceptance Scenarios**:

1. **Given** create mode with values entered for importer A, **When** the
   operator selects importer B, **Then** B's fields render with B's
   defaults and none of A's keys reach the submitted scope.
2. **Given** a manifest refetch (new array identity) mid-edit, **When**
   the form re-renders, **Then** the operator's entered values are not
   wiped.

---

### Edge Cases

- Schema serialization fails or yields a non-object shape → the whole
  scope section falls back to the shipped JSON editor rather than
  rendering an empty or broken form.
- Stored `scope` on an existing config contains keys no longer in the
  schema → they render in a labeled "unrecognized fields" JSON
  sub-editor; preserved on save unless the operator removes them.
- Enum with one value, empty `properties`, or all-optional schemas →
  renders a minimal or "no scope options" state, never a crash.
- Defaults vs required: a required field with a schema default pre-fills
  the default but still validates non-empty.
- Server-side schema remains authoritative — typed-client validation is
  a convenience; a stale schema still gets a server `VALIDATION_FAILED`
  surfaced on the field when possible, else the form-level error.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The importer create/edit form MUST render one control per
  top-level property of the importer's serialized `configSchema`:
  string → text input, `format: uri`/url → URL input, boolean → switch,
  enum → dropdown, number/integer → number input, `array` of strings →
  list editor.
- **FR-002**: Required properties MUST be marked and block submit with an
  inline per-field error when empty.
- **FR-003**: Schema `default` values MUST pre-fill their control on
  create and MUST be submitted explicitly (stored scope is
  self-documenting); stored `scope` values MUST win over defaults on
  edit.
- **FR-004**: Properties without a dedicated control (e.g. object/record
  types) MUST render a per-field JSON sub-editor, not break the form.
- **FR-005**: A scope-level "edit as JSON" mode MUST remain available and
  MUST round-trip values losslessly with the typed view.
- **FR-005a**: Stored scope keys absent from the current schema MUST
  render in a labeled "unrecognized fields" JSON sub-editor, preserved
  on save unless the operator removes them — never silently dropped or
  carried invisibly.
- **FR-006**: Switching importers in create mode MUST reset scope fields
  to the new importer's defaults with zero key leakage.
- **FR-007**: Manifest refetches MUST NOT wipe entered scope values.
- **FR-008**: The scope JSON submitted MUST be identical in shape to what
  the current JSON editor produces — no envelope, no client-side key
  renaming; unknown stored keys survive a typed-mode save via FR-005a.
- **FR-009**: Server `VALIDATION_FAILED` responses with field paths MUST
  surface on the matching scope field when the path is resolvable.
- **FR-010**: The change is flagless — typed scope controls replace the
  JSON editor as the default for renderable schemas (the JSON editor
  remains the defined fallback per FR-004/FR-005).

### Key Entities *(include if feature involves data)*

- **ImporterManifest.configSchema**: JSON Schema object serialized
  server-side; drives field generation. Read-only contract for this
  feature — already shipped by spec 036.
- **ImporterConfig.scope**: `Record<string, unknown>` the form produces;
  unchanged shape, unchanged server validation.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An operator can create a valid importer config for every
  in-tree importer without typing JSON — 8/8 importers completable via
  typed controls (with at most per-field JSON for `environmentMapping`).
- **SC-002**: Zero scope-validation failures caused by malformed JSON in
  usability terms — JSON syntax errors are impossible in typed mode.
- **SC-003**: 100% of previously valid scopes still save identically —
  no regression in the submitted payload shape (verified against existing
  importer validation).
- **SC-004**: Field discoverability: every scope property a schema
  declares is visible in the form without reading external docs.

## Assumptions

- The JSON Schema serialization shipped in spec 036
  (`z.toJSONSchema` on `GET /importers` and `GET /importers/:name/schema`)
  is the contract this feature consumes; no backend API shape change is
  expected beyond what already ships.
- "Edit as JSON" stays available rather than being removed — it is the
  defined fallback for unrenderable constructs and preserves unknown
  keys; removing it would be a scope expansion, not a gap resolution.
- Only top-level schema properties get dedicated controls; nested
  objects/records use the per-field JSON fallback (FR-004) — deep nested
  field trees are deferred custom-widget work (`docs/ux.md` §9).
- Field ordering follows schema property order; labels derive from
  property names (humanized) since schemas carry no descriptions today.
- No new feature flag: the gap registry notes the flag was removed when
  the JSON editor shipped; the typed form is itself the resolution.
- Server-side validation stays the authority; the client never weakens
  or duplicates the importer's zod rules beyond required/type checks.
