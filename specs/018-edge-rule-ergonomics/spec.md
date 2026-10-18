# Feature Specification: Edge-Rule Ergonomics

**Feature Branch**: `feature/018-edge-rule-ergonomics`

**Created**: 2026-10-31

**Status**: Implemented

**Input**: Implement ratified [ADR-109](../../researches/adrs/ADR-109-composes-parent-restriction-removed.md) — remove the `COMPOSES` parent-type restriction so any Digital Product type may compose children; `COMPOSES` becomes a fully general DAG guarded only by self-edge rejection and cycle detection. `CONSUMES_FROM` target-must-be-`PLATFORM` is unchanged. Deferred from earlier work; the ratified decision is documented but not yet enforced.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Compose parts under a platform (Priority: P1)

As a catalog maintainer, I want to model a real platform's structure —
"Identity Platform" composed of "SSO Service" and "MFA Service" — without the
system rejecting the edge because the parent has type `PLATFORM`.

**Why this priority**: This is the entire point of ADR-109. The old rule
forced users to mislabel platforms as capabilities or flatten their models;
it is the only blocking behavior this feature removes.

**Independent Test**: Create two products, set the parent's type to
`PLATFORM`, add the other as a `COMPOSES` child — the edge is accepted and
appears on both products' composition views.

**Acceptance Scenarios**:

1. **Given** a `PLATFORM` product and any second product, **When** I add the
   second product as a `COMPOSES` child of the platform, **Then** the edge is
   created and visible in both products' composition views.
2. **Given** any product as prospective parent, **When** I try to compose a
   product onto itself, **Then** the request is rejected as a self-edge.
3. **Given** products A→B→C already composed, **When** I try to make C
   compose A (creating a cycle), **Then** the request is rejected as a cycle,
   unchanged from today.
4. **Given** the product detail page of a `PLATFORM` product, **When** I open
   the "Composes" add flow, **Then** the action is enabled and I can select
   any non-retired product — no "only Business Capability and
   Customer-Facing" notice appears.

---

### User Story 2 - Change a product's type without false edge conflicts (Priority: P2)

As a catalog maintainer, I want to retype a `BUSINESS_CAPABILITY` product that
composes children to `PLATFORM` — and keep the children — so the type field
reflects reality without forcing me to delete and re-add edges.

**Why this priority**: Type corrections are the second half of the ergonomic
fix; without it users could add a PLATFORM parent but never convert one.

**Independent Test**: Give a `BUSINESS_CAPABILITY` product one `COMPOSES`
child, change its type to `PLATFORM` — the change is accepted and the child
edge survives.

**Acceptance Scenarios**:

1. **Given** a product with `COMPOSES` children, **When** I change its type to
   `PLATFORM`, **Then** the update succeeds and the edges are preserved.
2. **Given** a `PLATFORM` product that is a `CONSUMES_FROM` target, **When** I
   change its type to `BUSINESS_CAPABILITY`, **Then** the update is still
   rejected because the target rule is unchanged — with an explanation naming
   the offending edges.

---

### User Story 3 - Documentation matches behavior (Priority: P2)

As a reader of the product-model documentation, I want the `COMPOSES` rules
stated there to match what the system enforces.

**Why this priority**: `docs/digital-products.md` still states the rescinded
rule; leaving stale guidance misleads exactly the users this feature helps.

**Independent Test**: Read the composition-rules section — it describes any
type as a legal parent with only self-edge/cycle rejection.

**Acceptance Scenarios**:

1. **Given** `docs/digital-products.md`, **When** I read the `COMPOSES` rule
   and the "can be a COMPOSES parent" diagram, **Then** they describe any
   product type as a legal parent.

### Edge Cases

- A `PLATFORM` parent composing a `CUSTOMER_FACING` child is legal per
  ADR-109 ("accepted permissiveness") — no special-casing.
- Retyping a `CONSUMES_FROM` *target* away from `PLATFORM` stays blocked by
  the still-valid target rule; retyping a product *to* `PLATFORM` is now
  unrestricted by its `COMPOSES` children.
- Existing data needs no migration — this is a validation-rules-only change.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Any `DigitalProduct` type (`BUSINESS_CAPABILITY`,
  `CUSTOMER_FACING`, `PLATFORM`) MUST be accepted as a `COMPOSES` parent. The
  parent-type rejection is removed entirely.
- **FR-002**: Self-edges (`parentId == childId`) MUST still be rejected.
- **FR-003**: Cycle detection (`409 CYCLE_DETECTED`) MUST be unchanged — the
  only remaining structural guards on `COMPOSES`.
- **FR-004**: `CONSUMES_FROM` target-must-be-`PLATFORM` MUST be unchanged.
- **FR-005**: Changing a product's type to `PLATFORM` MUST no longer be
  blocked by the product's existing `COMPOSES` children; retyping a
  `CONSUMES_FROM` *target* away from `PLATFORM` MUST still be blocked and
  name the offending edges.
- **FR-006**: The UI MUST offer and enable the "Composes" action for every
  product type — no type-based gating or explanatory "only BC/CF" message.
- **FR-007**: `docs/digital-products.md` MUST be updated so its composition
  rules and diagrams reflect FR-001/FR-003 (ADR-109 consequence).
- **FR-008**: No database schema change; existing edges and records are
  unaffected.

### Key Entities

- **COMPOSES edge** (`product_composes`): product → product, "parent is
  composed of child". After this feature, legal iff parent and child exist,
  parent ≠ child, and the edge introduces no cycle.
- **CONSUMES_FROM edge** (`product_consumes_from`): unchanged; target must be
  `PLATFORM`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A maintainer can compose a part under a `PLATFORM` product on
  the first attempt — previously an unconditional rejection.
- **SC-002**: 100% of pre-existing `COMPOSES` safety guarantees still hold:
  self-edges and cycles are rejected exactly as before (regression suite
  proves both).
- **SC-003**: No error responses reference `COMPOSES_PARENT_TYPE`; API
  behavior and docs contain no stale parent-type rule.

## Assumptions

- The type enum stays closed at three values; no new product type is
  introduced (ADR-109).
- `CONSUMES_FROM` remains the canonical "uses shared platform machinery"
  edge; `COMPOSES` means "is a part of" — accepted permissiveness of e.g. a
  `PLATFORM` composing a `CUSTOMER_FACING` product is not modeled as an
  error.
- `CONTEXT.md` already reflects the relaxed rule (updated with spec 017);
  `docs/digital-products.md` is the remaining stale document.
- Audit/history behavior for edge add/remove is unchanged — the same
  `edge_changes` rows are written.
