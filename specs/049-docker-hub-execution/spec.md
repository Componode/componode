# Feature Specification: Docker Hub execution and managed targets

**Feature Branch**: `049-docker-hub-execution`  
**Created**: 2026-11-01  
**Status**: Draft  
**Input**: Enable the existing Docker importer to execute on either the Hub or an Import Agent, with Hub-managed Docker target records, ADMIN-only target management, executor-appropriate credentials, target lifecycle controls, safe cancellation, auditing, and preserved Agent behavior (`researches/docker-importer-hub-execution_research.md`, `researches/docker-importer-implementation-tracking.md` Phase 6).

## Clarifications

### Session 2026-11-01

Resolved through the completed grilling session (no open markers):

- Docker supports both Hub and Import Agent execution, with the same inventory surfaces on each executor where the executor runtime supports the selected transport.
- Hub targets are Docker-specific durable records managed through an ADMIN-only UI/API. Agent targets remain in each Agent's existing local registry and are not synchronized to the Hub.
- A target's route profile and credential-key references are immutable. Display metadata may change; route changes require a new target identifier.
- Hub execution uses stored credentials linked to each importer configuration. Agent execution continues to use Agent-managed credential references. Secret values are never stored in target profiles or sent across the Agent protocol.
- One importer configuration targets one Docker Engine. Multiple configurations may reuse the same target, while Source identity continues to come from Docker Engine identity rather than executor location.
- New Docker configurations default to Hub execution. Existing Agent-bound configurations remain Agent-bound. Changing executor clears target and credential selections.
- Disabled targets remain visible but cannot be newly selected, tested, or run. Disabling requests cancellation of active Hub work without waiting for all in-flight calls to drain.
- The default deployment does not mount the host Docker socket into the Hub. Hub socket access is an explicit deployment opt-in.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Import Docker inventory through the Hub (Priority: P1)

An administrator creates a managed Docker target, configures a Docker import to run on the Hub, links stored credentials when the selected transport requires them, and runs the importer. The resulting catalog contains the same container, image, health, and Swarm inventory that an Import Agent would report for the same Docker Engine.

**Why this priority**: This is the headline value: environments that cannot or do not need an Import Agent can still inventory Docker from the Hub.

**Independent Test**: create one enabled Hub target and one Hub-bound Docker configuration, run it, and verify that the catalog receives the expected Docker inventory and Source identity without deploying an Agent.

**Acceptance Scenarios**:

1. **Given** an enabled Hub target and a Hub-bound Docker configuration, **When** a run completes, **Then** the Docker inventory is imported through the Hub and recorded against the Docker Engine's Source identity.
2. **Given** a target that requires credential keys and a configuration whose stored credentials provide those keys, **When** the configuration is saved and run, **Then** the target resolves before Docker access and the run uses the configured credentials.
3. **Given** a target profile that needs no secrets, **When** a Hub configuration has no linked credential, **Then** the configuration can be saved and run without inventing a credential requirement.
4. **Given** an existing Agent-bound Docker configuration, **When** this feature is installed, **Then** it remains Agent-bound and continues to use its Agent-local target and Agent-managed credentials.

---

### User Story 2 - Administer Hub Docker targets safely (Priority: P1)

An administrator can list, inspect, create, test, enable, disable, and delete Hub Docker targets from a dedicated administration surface. Route-defining fields cannot be changed in place; labels and descriptions can. Targets that are still referenced by configurations cannot be deleted.

**Why this priority**: Hub execution is unusable without a trusted way to define which Docker endpoints the Hub may reach; lifecycle controls are required to revoke access safely.

**Independent Test**: create a target, edit its display metadata, test connectivity, disable and re-enable it, and attempt deletion while a configuration still references it.

**Acceptance Scenarios**:

1. **Given** administrator access, **When** targets are listed or opened, **Then** each target shows its identifier, display metadata, lifecycle state, and non-secret route summary.
2. **Given** a target create request, **When** the profile is valid and the target identifier is unique, **Then** the target is persisted and becomes selectable by Hub-bound configurations.
3. **Given** an existing target, **When** its label or description is changed, **Then** the immutable target identifier and route profile remain unchanged.
4. **Given** an existing target, **When** an administrator attempts to change a route, transport, pinning, or credential-key reference, **Then** the change is rejected and a new target identifier is required instead.
5. **Given** a target referenced by at least one configuration, **When** an administrator deletes it, **Then** deletion is blocked and the configuration remains intact.
6. **Given** an enabled target and a suitable credential context, **When** the administrator tests it, **Then** the system performs a minimal connectivity check and reports success or a sanitized failure without performing inventory.

---

### User Story 3 - Select and change executors without ambiguity (Priority: P1)

An administrator chooses whether a Docker import runs on the Hub or an Import Agent. New Docker configurations default to Hub; Hub-bound configurations choose from managed targets, while Agent-bound configurations retain their Agent-local target identifier. Changing executor clears target and credential selections so an identifier cannot silently resolve to a different route.

**Why this priority**: The same `targetId` text can have different meanings on different executors; the UI and validation must prevent accidental imports from the wrong Docker Engine.

**Independent Test**: create a new Docker configuration, switch between Hub and Agent execution, and verify which fields and validation rules apply in each mode.

**Acceptance Scenarios**:

1. **Given** a new Docker configuration, **When** the form opens, **Then** Hub execution is the default while Agent execution remains selectable.
2. **Given** Hub execution, **When** the administrator chooses a target, **Then** only an enabled managed target can be assigned.
3. **Given** Agent execution, **When** the administrator enters a target identifier, **Then** the existing Agent-local identifier behavior remains in place.
4. **Given** a configuration with target and credential selections, **When** its executor changes between Hub and Agent, **Then** both selections are cleared and must be chosen again for the new executor.
5. **Given** a disabled target already referenced by a configuration, **When** unrelated fields are edited without changing the target, **Then** the edit is allowed but the configuration still cannot run until the target is re-enabled or changed.

---

### User Story 4 - Revoke access and understand what happened (Priority: P2)

An administrator disables a target to prevent new Hub work. New selections, tests, and runs are blocked; active Hub runs and tests are asked to cancel; and run history plus the activity feed explain whether work failed, was cancelled by a person, or was cancelled because the target was disabled.

**Why this priority**: Target disablement is the emergency access-control action. It must be immediate, visible, and distinguishable from a Docker failure.

**Independent Test**: disable a target while work is pending or active, then inspect the target state, run history, test outcome, and activity feed.

**Acceptance Scenarios**:

1. **Given** an enabled target, **When** it is disabled, **Then** new target selections, runs, and tests are rejected or recorded as unavailable before any Docker access.
2. **Given** a saved configuration whose target is disabled after save, **When** that configuration is triggered, **Then** a run record is retained and marked as a disabled-target failure.
3. **Given** an active Hub run using the target, **When** the target is disabled, **Then** cancellation is requested with a disabled-target reason and the run is not represented as a Docker failure.
4. **Given** a disabled target, **When** it is re-enabled, **Then** existing configurations that still reference it can run again.
5. **Given** target create, update, enable, disable, delete, or test actions, **When** they complete, **Then** an auditable event exists and appears in the existing activity feed with a human-readable target name.
6. **Given** any target audit, log, API response, or error, **When** it is inspected, **Then** no secret value is present.

---

### User Story 5 - Keep contracts and operator guidance accurate (Priority: P3)

Administrators and integrators can see the new target-management permissions, lifecycle behavior, cancellation reason, and Docker setup instructions in the public API and user documentation. Architecture decisions record the durable Hub/Agent boundary.

**Why this priority**: The feature changes authenticated APIs, RBAC, audit behavior, run semantics, importer deployment guidance, and ADR-owned contracts; incomplete contract documentation would make the feature unsafe to operate or extend.

**Independent Test**: compare implementation behavior with API documentation, Docker setup guidance, audit labels, and the affected architecture decisions.

**Acceptance Scenarios**:

1. **Given** the shipped feature, **When** the API documentation is inspected, **Then** every target endpoint, permission, response, and error behavior is documented and matches implementation.
2. **Given** the Docker setup guide, **When** an administrator reads Hub execution instructions, **Then** target management, credential expectations, supported transports, and optional socket access are explained without changing the default deployment's socket behavior.
3. **Given** the affected architecture decisions, **When** they are inspected, **Then** every new or amended contract surface is ratified and cross-referenced.

### Edge Cases

- A Hub target identifier is missing, malformed, disabled, or duplicated at create time.
- A configuration is switched between Hub and Agent while retaining incompatible target or credential selections.
- A target profile requires credential keys that the linked stored credential does not provide.
- A target needs no credential, but a configuration links an incompatible credential anyway.
- A target is disabled while a run or connectivity test is already in progress.
- A target is re-enabled after a configuration was saved against it.
- Two executor-local registries use the same `targetId` text for different Docker Engines.
- Two different targets or executors reach the same Docker Engine identity.
- A configuration points to a different Docker Engine than it did previously; the previous Source must not be implicitly retired.
- A Hub runtime does not support a requested transport or cannot access the target path; the failure must occur before Docker access and must not fall back to another transport.
- The default deployment does not provide a Docker socket; Hub execution must fail visibly unless access is explicitly configured.
- A non-administrator attempts to read or mutate target records.
- A target's route summary contains internal endpoint information but no secret material; only authorized administrators may view it.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Docker importer configurations MUST support both Hub execution and Import Agent execution through the existing executor selection, with Hub execution no longer blocked by Docker's manifest.
- **FR-002**: Hub execution MUST support the same Docker inventory surfaces as Agent execution where the Hub runtime supports the selected transport: container workloads, opt-in images, health observations, and Swarm inventory.
- **FR-003**: The default deployment MUST NOT mount the host Docker socket into the Hub; any Hub socket access MUST be explicit deployment configuration.
- **FR-004**: Hub Docker targets MUST be durable, Docker-specific records managed by the Hub; Agent target profiles MUST remain in the Agent-local registry and MUST NOT be synchronized through the Hub API.
- **FR-005**: Each Hub target MUST have a durable record identifier and a separate immutable target selector unique within the Hub, 1-200 characters in length.
- **FR-006**: Each Hub target MUST have editable display metadata and an enabled/disabled lifecycle state.
- **FR-007**: Each Hub target MUST store a strictly validated, non-secret route profile for the supported Docker transports; unknown or insecure profile fields MUST be rejected.
- **FR-008**: Target transport, endpoint, pinning, context, and credential-key references MUST be immutable; changes to those fields require a new target identifier.
- **FR-009**: Secret values MUST NOT be stored in target profiles, returned by target APIs, written to audit details, or emitted in logs.
- **FR-010**: Only administrators MUST be able to list, read, create, update, enable, disable, test, or delete Hub targets, using dedicated target-management permissions.
- **FR-011**: A target connectivity test MUST perform only the minimal Docker version check and MUST use an explicitly selected Hub-bound configuration as the credential context when the profile requires secret material.
- **FR-012**: Deleting a target MUST be blocked while any importer configuration references it.
- **FR-013**: Multiple importer configurations MAY reference the same enabled target; each importer configuration MUST still target exactly one Docker Engine.
- **FR-014**: Importer configuration scope MUST contain only the target selector; raw endpoints, socket paths, credentials, or route overrides MUST NOT be accepted through scope.
- **FR-015**: Hub-bound Docker configurations MUST use stored credentials; Agent-bound Docker configurations MUST continue to use Agent-managed credential references.
- **FR-016**: Saving a Hub-bound configuration MUST validate that every credential key referenced by the selected target profile is supplied by the configuration's linked stored credentials.
- **FR-017**: A Hub-bound configuration MUST reference an existing enabled target at assignment time; assigning a disabled target MUST return a distinct disabled-target conflict.
- **FR-018**: A configuration that already references a disabled target MUST remain editable for unrelated fields, but MUST NOT run while the target remains disabled.
- **FR-019**: Triggering a configuration whose target is disabled MUST retain a run record marked with a distinct disabled-target failure before any Docker access.
- **FR-020**: Disabling a target MUST prevent new selections, tests, and runs, and MUST request cancellation of active Hub runs and tests without waiting for in-flight Docker calls to drain before returning.
- **FR-021**: Runs cancelled by a person and runs cancelled because a target was disabled MUST record distinguishable cancellation reasons while retaining the existing cancelled run state.
- **FR-022**: Cancellation reasons MUST be exposed through run APIs and rendered as neutral cancellation information, not as Docker errors.
- **FR-023**: New Docker configurations MUST default to Hub execution; existing Agent-bound configurations MUST remain Agent-bound.
- **FR-024**: The configuration form MUST provide a managed-target picker for Hub execution and preserve the free-text Agent-local target identifier for Agent execution.
- **FR-025**: Switching a configuration between Hub and Agent execution MUST clear its target and credential selections.
- **FR-026**: Target create, update, enable, disable, delete, and test actions MUST be audited with non-secret route details and human-readable target names in the existing activity feed.
- **FR-027**: Source identity MUST remain the Docker Engine identity; the same Engine reached through Hub or Agent MUST resolve to the same Source, while a different Engine MUST use a different Source.
- **FR-028**: Source-scoped reconciliation MUST remain unchanged; failed or cancelled runs MUST NOT retire absent memberships, and the previous Source of a changed Engine MUST become unmonitored rather than implicitly retired.
- **FR-029**: The Agent wire protocol, Agent enrollment, Agent-local target registry, Agent credential behavior, and default Agent execution behavior MUST remain unchanged.
- **FR-030**: New target APIs, permissions, run cancellation reason, and disabled-target errors MUST be represented in the public API contract and covered by API contract tests.
- **FR-031**: Docker setup and deployment documentation MUST explain Hub execution, managed targets, credential requirements, supported transports, optional socket access, and the unchanged Agent path.
- **FR-032**: Every contract surface that changes an ADR-owned decision MUST be ratified in the same change, including ADR amendments or a new ADR, back-pointers, and the architecture-decision index.

### Key Entities *(include if feature involves data)*

- **Docker Target**: An administrator-managed Hub route profile for one Docker endpoint; includes an immutable selector, display metadata, lifecycle state, non-secret route details, and audit metadata.
- **Importer Configuration**: Selects the Hub or an Import Agent as executor, references one target selector, links executor-appropriate credentials, and retains Docker scope options.
- **Credential**: Stored credential material resolved by the Hub, or Agent-managed credential references resolved locally by an Agent.
- **Import Run**: Records the selected executor, outcome, failure type, and optional cancellation reason for a Docker import attempt.
- **Importer Source**: The durable Docker Engine identity used to scope reconciliation independently of executor location or target identifier.
- **Audit Event**: The append-only record of target management, lifecycle, and test actions, containing only non-secret route details.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A Docker import can complete on the Hub and on an Agent using equivalent targets, with 100% of the supported inventory surfaces represented in both paths where the runtime supports the transport.
- **SC-002**: 100% of missing, malformed, disabled, or unauthorized target uses fail before any Docker network access.
- **SC-003**: 100% of target create, update, enable, disable, delete, and test actions produce an audit event with a human-readable target name and zero secret values.
- **SC-004**: The same Docker Engine reached through Hub and Agent resolves to one Source; switching to a different Engine creates a distinct Source in 100% of tested cases.
- **SC-005**: Administrators can create a target, configure a Hub-bound Docker import, run it, disable the target, and understand the resulting run/audit outcome through the UI without reading logs.
- **SC-006**: All new target endpoints, permissions, and cancellation/error fields are documented in the public API contract, with 100% route and permission contract coverage.
- **SC-007**: The default deployment contains zero Docker socket mounts for the Hub; documented opt-in socket access is separately verifiable.
- **SC-008**: Lint, typecheck, tests, and build pass for every changed package; importer tests exercise `validateDiscoveredAsset`.

## Assumptions

- Target management is Docker-specific for this feature; a generic importer-target management system is out of scope.
- Exact API paths and request/response schemas are planning artifacts, but they must preserve the behavior and permission boundaries in this specification.
- Named Docker Context resolution on the Hub must preserve the importer/package and file-access boundaries; the implementation plan must choose a compliant resolution mechanism.
- Labels may duplicate; only the immutable target selector must be unique. The UI should show both label and selector when ambiguity matters.
- The delete-in-use conflict may use a distinct API error from the disabled-target conflict; the exact controlled code is ratified during planning.
- Target disablement affects Hub-managed records only. Agent-local target availability continues to be managed on each Agent.
- Manual cancellation and target-disable cancellation are the two initial cancellation reasons; additional reasons require a future contract change.
