# Feature Specification: Manual environment override for ComponentInstances

**Feature Branch**: `071-instance-environment-override`

**Created**: 2026-11-12

**Status**: Draft

**Input**: User request — "When accessing the component page, I can see instances but can't edit which environment the instances are in. I would like to change the environment to any of the options available." Investigation confirmed this is an architecture limitation, not a missed UI option: `component_instances.environment` is required importer-reported data (`DiscoveredAssetInstance.environment`), there is no instance-update API at all (only the spec-054 zero-instance recovery POST), and import reconciliation unconditionally rewrites `environment` from the discovered asset on every run — so a naive edit would be silently reverted. Ratified approach (user decision): **override flag** — a human-set environment persists across import runs until explicitly reset, while the importer-reported value remains recorded as provenance. Governing docs: ADR-014/ADR-034 (ComponentInstance model + upsert key), ADR-054/ADR-094 (route conventions), spec 054 (manual instance recovery), spec 058 (managed-check ownership precedent for importer-vs-actor field ownership).

## Clarifications

### Session 2026-11-12

All decisions resolved in the design discussion — no open markers:

- **Approach → override flag (option A)**: a dedicated human-override layer sits beside the importer-reported environment; effective environment = override when present, else reported. Chosen over "insert-only" (breaks legitimate importer-reported env changes) and "manual instances only" (does not cover importer-managed instances, which is the reported pain).
- **Scope → environment only**: url, region, status, version, deployedAt, rawConfig remain importer-owned in v1. No generic per-field override framework.
- **Values → existing catalog enum**: DEV, TEST, STAGING, DEMO, PRODUCTION, OTHER — "any of the options" needs no vocabulary change; OTHER already covers unclassifiable cases.
- **Provenance → reported value stays recorded**: importers keep writing the reported environment untouched; the override never erases what the source observed.
- **Identity → override is not identity**: instance slug, externalId, source memberships, and URL-check bindings are keyed by instance ID and must not change when environment is overridden.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Override an instance's environment (Priority: P1)

A catalog user opens a component's detail page, sees an instance whose environment is wrong or unclassified (e.g. reported `OTHER` because the source carries no environment label), and sets it to the correct catalog environment — e.g. `PRODUCTION`. The choice persists: subsequent importer runs keep reporting their observed value but the catalog continues to show the human-set environment.

**Why this priority**: This is the feature's entire value — environments drive catalog truth ("what runs where"), and today a missing/mislabeled source fact is unfixable by humans.

**Independent Test**: import a source whose instance reports `OTHER`; override it to `PRODUCTION` via the UI/API; re-run the import; verify the effective environment remains `PRODUCTION` while the reported value is still `OTHER`.

**Acceptance Scenarios**:

1. **Given** a component instance with reported environment `OTHER`, **When** a permitted user sets its environment to `PRODUCTION`, **Then** the instance's effective environment becomes `PRODUCTION` and the change is reflected on the component detail page.
2. **Given** an overridden instance, **When** the owning importer runs again and reports the same instance, **Then** the effective environment remains the overridden value — the run does not revert it.
3. **Given** an overridden instance, **When** its detail is read via API, **Then** both the effective environment and the importer-reported environment (plus override state) are returned.
4. **Given** a user without the component-update permission, **When** they attempt to change an instance's environment, **Then** the request is rejected.

---

### User Story 2 - See provenance and reset to the importer value (Priority: P2)

A catalog user viewing an instance can tell at a glance that its environment was set manually rather than observed, sees what the importer last reported, and can clear the override so the instance returns to importer-reported truth.

**Why this priority**: Overrides that can't be seen or undone erode trust in importer data; provenance + reset is what makes the override safe to expose.

**Independent Test**: override an instance, verify the UI marks it as overridden and shows the reported value; reset it; verify the effective environment returns to the last importer-reported value.

**Acceptance Scenarios**:

1. **Given** an overridden instance, **When** the user views the instances table or instance details, **Then** the override state and the importer-reported environment are visible.
2. **Given** an overridden instance, **When** a permitted user clears the override, **Then** the effective environment immediately returns to the most recently importer-reported value.
3. **Given** an instance that was never overridden, **When** the user views it, **Then** no override affordance or badge is shown — it behaves exactly as today.

---

### Edge Cases

- **Instance stops being reported**: reconciliation's GONE/retirement handling is orthogonal — an override never resurrects or retains an instance the source stopped reporting; it only affects the environment field while the instance exists.
- **Manual (spec-054) instances**: instances created via first-instance recovery participate identically — they have no importer reporter, so their "reported" environment is the creation-time value and the override behaves the same way.
- **Environment is part of the generated instance slug**: overriding must not rewrite the slug or any identifier — URL checks, source memberships, and audit history all reference the instance by ID/slug and must remain intact.
- **Invalid or unknown environment value**: rejected at the boundary; only catalog environment values are accepted.
- **Concurrent edits**: last write wins, each change audited (standard catalog semantics).
- **Component RETIRED**: editing follows the same permission rules as other component updates; no special-casing in v1.
- **Importer changes its reported value while overridden**: the reported value keeps updating (provenance stays fresh); the override still wins until reset.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST let a user with component-update permission set a component instance's environment to any value in the catalog environment list (DEV, TEST, STAGING, DEMO, PRODUCTION, OTHER).
- **FR-002**: A human-set environment MUST persist across subsequent importer runs that report the same instance — importer-reported values MUST NOT overwrite an active override.
- **FR-003**: The system MUST continue recording the importer-reported environment even while an override is active, and MUST expose both the effective and reported values.
- **FR-004**: The system MUST let a permitted user clear an instance's override, restoring the effective environment to the most recently importer-reported value.
- **FR-005**: Every override set and clear MUST be audit-logged with actor, timestamp, and previous/effective values.
- **FR-006**: Environment MUST be the only overridable instance field in v1 — url, region, status, version, deployedAt, and rawConfig remain importer-owned.
- **FR-007**: The override MUST apply per instance, never per component or per source.
- **FR-008**: Overriding environment MUST NOT alter instance identity — slug, externalId, source memberships, and URL-check bindings remain unchanged.
- **FR-009**: Instance payloads returned by the API MUST expose the effective environment, the override state, and (when overridden) the importer-reported environment.
- **FR-010**: The component detail page MUST offer environment editing to permitted users on the instances surface, MUST indicate when an instance's environment is overridden, and MUST offer a way to reset to the importer-reported value.
- **FR-011**: Instances belonging to RETIRED components or reported GONE follow existing visibility rules; the override does not change lifecycle or visibility semantics.

### Key Entities *(include if feature involves data)*

- **ComponentInstance**: gains a human-override layer over `environment` — reported environment (importer-written, unchanged semantics), optional override value + who/when set it, and the derived effective environment used by all reads.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A permitted user can correct an instance's environment from the component page in under 1 minute, without API tooling.
- **SC-002**: 100% of importer runs preserve human-set environments — zero silent reverts of overridden instances.
- **SC-003**: Users can distinguish overridden from importer-observed environments at a glance on the instances surface (badge/indicator on 100% of overridden rows).
- **SC-004**: Resetting an override restores the importer-reported environment in a single action, with no data loss of the reported value.
- **SC-005**: All override changes appear in the audit trail with actor and timestamp (100% coverage).

## Assumptions

- Editing requires the same permission as component update (`component:update`); no new role or permission is introduced.
- The importer-reported environment continues to be written on every run exactly as today — the override is a separate layer, not a replacement of the reported column.
- "Any of the options available" means the six existing catalog environment values; OTHER is the catch-all and no new values are added.
- Manual (spec-054) instances use the same override mechanics even though they have no active reporter.
- No generic multi-field override framework is built — environment only; the design MAY leave room for future fields but v1 ships environment alone.
- This feature is independent of spec 070 (component groups) — no interplay.
