# Feature Specification: Guided Docker importer setup

**Feature Branch**: `063-docker-importer-onboarding`
**Created**: 2026-11-05
**Status**: Draft
**Input**: Expert assessment found Docker importer setup too complex: Hub setup requires three screens in three admin areas (Docker targets → Credentials → Importer config) with a manual naming contract between target profile `*Key` fields and credential keys, a test chicken-and-egg for credential-requiring transports, immutable hand-invented `targetId`s, and power-user knobs shown to every user. Resolved through a grilling session into a guided wizard, a stateless connectivity probe, progressive disclosure, and a docs quickstart — Hub execution only; agent-side simplification deferred.

## Clarifications

### Session 2026-11-05

Resolved through the completed grilling session (no open markers):

- Scope is **Hub execution only**. Agent-side simplification (agent-local `docker-targets.json` UX, agent target enumeration, registry generation) is explicitly deferred to a later wave.
- The guided wizard covers the **entire create path in one flow**: transport + route fields → secrets (credential-requiring transports only) → identity (label, target selector, schedule) → connectivity probe → create target → credential → importer configuration. It is **create-only**; editing any Docker configuration keeps using the existing generic importer form, which also remains the manual creation path for power users.
- The wizard performs **no orchestration on the backend** — it calls the existing target, credential, and importer-config APIs in sequence. The single deliberate backend addition is a **stateless connectivity probe** endpoint so a route can be verified before any records exist.
- Credential handling: the wizard never exposes credential-key-name fields. For mTLS TCP and SSH transports it derives the profile's `*Key` references from the importer's declared secret names automatically and creates a `STORED` credential with those canonical keys. Existing `STORED` credentials may be reused **only** when their key hints already cover every canonical key the chosen transport requires.
- The probe endpoint persists nothing and writes no audit event; it performs the same minimal version check as the existing target test and never enumerates inventory.
- One wizard run creates exactly one Docker target, at most one credential, and one importer configuration. There is no agent-execution selector (wizard is Hub-only) and no auto-rollback: a partial failure surfaces which step failed with links to finish manually; orphaned targets/credentials are benign and manageable.
- Progressive disclosure hides only `environmentMap`, `componentIdLabel`, and `sourceKey` behind an "Advanced" disclosure in the generic scope editor, via a frontend-side mapping — no manifest or core contract change. `environmentLabel`, `includeImages`, and the Docker target picker remain visible.
- The governance model is unchanged: immutable target selectors, enable/disable lifecycle, delete-in-use protection, audit events, and executor-local registries all stay exactly as ratified in ADR-122.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Set up a Docker import in one guided flow (Priority: P1)

An administrator with no prior Docker configuration opens the guided setup, picks a transport (local socket, mutual-TLS TCP, pinned-key SSH, or named Docker context), fills in the route details with plain-language guidance, provides secrets when the transport needs them, names the import, and finishes. The wizard verifies connectivity and then creates the target, credential (when needed), and importer configuration, landing the admin on the new configuration ready to run.

**Why this priority**: This is the headline value — it collapses the current three-screen, three-admin-area setup with its manual key-naming contract into a single guided pass. Every other story supports or extends this journey.

**Independent Test**: with a reachable Docker Engine (e.g. a local socket), complete the wizard end-to-end and verify a Docker target, a linked credential (for tcp/ssh), and an enabled importer configuration all exist and a run produces inventory.

**Acceptance Scenarios**:

1. **Given** an administrator on the importers page, **When** they start guided Docker setup and choose the socket transport with a valid socket path, **Then** the wizard asks only for the fields that transport needs and creates a target, an importer configuration referencing it, and no credential.
2. **Given** the guided wizard, **When** the administrator chooses tcp or ssh, **Then** secret values are captured through masked inputs and the wizard creates a stored credential whose keys match the route's secret references — the administrator never types a credential key name.
3. **Given** a completed wizard run, **When** it succeeds, **Then** the admin lands on the new importer configuration detail and can trigger a run immediately.
4. **Given** the wizard, **When** the administrator reviews the identity step, **Then** a target selector is pre-suggested from their input, is editable before creation, and the form states it cannot change afterwards.
5. **Given** the guided setup entry points, **When** an administrator opens the importers index or the generic new-importer form with Docker selected, **Then** a clear path into the wizard is offered.

---

### User Story 2 - Verify a route before any records exist (Priority: P1)

Before the wizard creates anything, the administrator can probe a route profile plus secret values and see whether the Docker Engine answers a minimal version check. The same probe capability is available as an API operation for administrators, persists nothing, and reports sanitized failures.

**Why this priority**: The current target test is unusable until an importer configuration already references the target — a chicken-and-egg that forces admins to create records before they can verify connectivity. Probing first turns "create, run, debug, delete" into "verify, then create."

**Independent Test**: call the probe operation with a valid profile and matching secrets against a reachable engine and with a wrong secret against an unreachable endpoint; verify `ok` results and sanitized errors, and verify no target, credential, or configuration rows were created.

**Acceptance Scenarios**:

1. **Given** a valid route profile and the secrets its key references require, **When** an administrator probes it, **Then** the system performs only a minimal connectivity check and returns success without persisting any record or audit event.
2. **Given** a profile whose key references name secrets that were not supplied, **When** probed, **Then** the result is a failure identifying the missing key name — never the secret value.
3. **Given** a malformed or insecure profile (unknown transport, plaintext TCP, unpinned or skipped verification), **When** probed, **Then** the request is rejected before any network access.
4. **Given** the wizard's probe step, **When** the probe fails, **Then** the wizard shows the sanitized error, keeps all entered values, and does not create any records.
5. **Given** a non-administrator, **When** they attempt to probe, **Then** the request is denied by the same permission that guards target testing.

---

### User Story 3 - Reuse credentials without re-typing secrets (Priority: P2)

When setting up a credential-requiring transport, the administrator can pick an existing stored credential instead of re-entering certificate or key material — but only credentials that already contain every key the chosen transport needs are offered.

**Why this priority**: Organizations accumulate credentials per account; re-entering PEM material for every new engine is error-prone and encourages copying secrets into insecure places. Coverage-gated reuse keeps the canonical-key contract intact without forcing duplication.

**Independent Test**: create a stored credential containing the canonical mTLS keys, run the wizard for a tcp target, and verify it is offered and selectable; verify a credential missing one required key is not offered.

**Acceptance Scenarios**:

1. **Given** stored credentials exist, **When** the wizard reaches the secrets step for tcp or ssh, **Then** credentials whose key hints cover all required canonical keys are listed as reuse options alongside "enter new values."
2. **Given** a credential missing a required key, **When** the secrets step renders, **Then** that credential is not selectable for this transport.
3. **Given** a reused credential, **When** the wizard completes, **Then** the new configuration links that credential and no new credential is created.
4. **Given** socket or context transport, **When** the secrets step renders, **Then** no credential choice is presented because these transports require no secret material.

---

### User Story 4 - Find advanced options without clutter (Priority: P2)

When editing or manually creating a Docker importer configuration through the generic form, the rarely needed scope fields — the environment label-value map, the workload-identity label override, and the source-identity fallback — are collapsed under an "Advanced" disclosure instead of competing with the fields everyone needs.

**Why this priority**: The scope form currently shows every Docker field to every user, which is part of what makes the importer feel complex. Progressive disclosure reduces noise without removing capability, and the mechanism must not disturb other importers' forms.

**Independent Test**: open a Docker importer configuration form and verify the three advanced fields are collapsed by default and expandable; verify a different importer's form is unchanged.

**Acceptance Scenarios**:

1. **Given** the generic importer form for Docker, **When** the scope section renders, **Then** the environment label key and include-images options remain visible while the environment map, component-id label, and source key are grouped under an Advanced disclosure.
2. **Given** the Advanced disclosure expanded, **When** the administrator edits an advanced field, **Then** values save and validate exactly as before.
3. **Given** any other importer's form, **When** it renders, **Then** its fields are unaffected by the Docker-specific disclosure.

---

### User Story 5 - Follow a five-minute quickstart (Priority: P3)

A new administrator reads the Docker importer guide and finds a short happy-path quickstart — Hub execution with a local socket — that gets them from nothing to a completed first import, with the depth-first transport and lifecycle detail preserved below it and pointers to deployment and agent documentation for non-happy paths.

**Why this priority**: Documentation is the fallback for every user who skips the wizard or hits an edge case; a quickstart converts the guide from reference material into an onboarding path.

**Independent Test**: follow only the quickstart section against a local Docker socket and reach a completed import without consulting other sections.

**Acceptance Scenarios**:

1. **Given** the Docker importer guide, **When** it is opened, **Then** a quickstart covering the Hub + local-socket happy path appears before the detailed sections.
2. **Given** the quickstart, **When** it references deployment prerequisites (socket mount) or agent execution, **Then** it links to the authoritative guides rather than duplicating their content.
3. **Given** the existing guide content, **When** the change ships, **Then** all transport, credential, lifecycle, and failure documentation remains intact.

### Edge Cases

- Probe request carries a profile missing a secret key its references require → failure names the missing key, never values.
- Probe request carries secret values for a profile that references none → values are ignored; success depends only on reachability.
- Wizard probe succeeds but target creation fails (e.g. duplicate selector) → error surfaces, entered values retained, no credential or configuration is created.
- Credential creation fails after the target was created (e.g. encryption key unavailable) → the failure names the completed and pending steps; the orphaned target is visible and deletable under Docker targets.
- Configuration creation fails after target and credential exist → same partial-failure treatment; both artifacts remain usable by the generic form.
- Two administrators pick the same suggested selector concurrently → the second create gets a conflict and can edit the selector.
- The Hub has no Docker socket mounted and the administrator picks socket → probe fails with a sanitized connection error and the wizard surfaces the documented mount guidance.
- An administrator abandons the wizard at any step → nothing is persisted (the probe is stateless and creates happen only in the final step).
- A non-administrator reaches wizard URLs → denied by the same permissions that guard target and credential management (all wizard mutations are admin-only).
- A credential-requiring transport is chosen but the linked credential is revoked between selection and save → save-time validation rejects with the existing missing-key/conflict behavior.
- The wizard is used while agent-bound Docker configurations exist → unaffected; those remain editable only via the generic form.
- Secret values pasted into the wizard must never appear in browser history state, logs, audit events, error messages, or API responses beyond the create/test request bodies.

## Requirements *(mandatory)*

### Functional Requirements

**Guided wizard**

- **FR-001**: The system MUST provide a guided setup flow for creating Docker importer configurations that executes on the Hub, reachable from the importers area and hinted from the generic new-importer form when Docker is selected.
- **FR-002**: The wizard MUST be create-only and MUST produce exactly one Docker target, at most one credential, and one importer configuration per completed run; it MUST NOT attach configurations to pre-existing targets (the generic form covers that).
- **FR-003**: The wizard MUST support all four Docker transports (socket, mutual-TLS TCP, pinned-key SSH, named Docker context) with transport-specific route fields and plain-language guidance, including the deployment prerequisite for Hub socket access.
- **FR-004**: For transports whose profile references secret keys, the wizard MUST capture secret values through masked inputs and MUST derive the profile's key references automatically — administrators MUST NOT have to type credential key names.
- **FR-005**: The wizard MUST create the credential as a stored credential encrypted at rest, named sensibly by default (editable), containing exactly the canonical secret keys for the chosen transport.
- **FR-006**: The wizard MUST offer existing stored credentials as reuse options only when their key hints cover every canonical key the chosen transport requires; socket and context transports MUST NOT present a credential step.
- **FR-007**: The wizard MUST collect the import label, a pre-suggested editable target selector (communicating its post-creation immutability), a schedule choice, and an enabled flag; it MUST default the remaining scope options.
- **FR-008**: The wizard MUST NOT offer agent execution; agent-bound Docker configurations remain creatable only through the generic form.
- **FR-009**: The wizard MUST run the connectivity probe before creating any records and MUST proceed to creation only on success, retaining all entered values on failure.
- **FR-010**: Wizard creation MUST call the existing target, credential, and importer-config APIs; partial failure MUST identify the completed and failed steps and offer links to finish manually, with no automatic rollback.
- **FR-011**: On success the wizard MUST land the administrator on the created importer configuration.

**Connectivity probe**

- **FR-012**: The API MUST expose an administrator-only operation that accepts a route profile and secret values and returns a connectivity result without persisting any record or audit event.
- **FR-013**: The probe MUST validate the profile against the Docker target profile contract and MUST reject malformed or insecure profiles before any network access.
- **FR-014**: The probe MUST perform only the minimal version check — never inventory enumeration — matching the existing target test's behavior.
- **FR-015**: Probe failures MUST be sanitized of secret values; secret values MUST NOT appear in responses, logs, audit events, or error details beyond the request itself.
- **FR-016**: The probe operation MUST be represented in the public API contract with contract-test coverage, and its permission MUST equal the existing target-test permission.
- **FR-017**: The probe MUST work for credential-requiring transports without any pre-existing target, credential, or configuration — closing the current test chicken-and-egg.

**Progressive disclosure**

- **FR-018**: The generic importer form MUST group the Docker scope fields `environmentMap`, `componentIdLabel`, and `sourceKey` under an "Advanced" disclosure, collapsed by default, while `environmentLabel`, `includeImages`, and the target picker remain visible.
- **FR-019**: Advanced-field grouping MUST be scoped to the Docker importer and MUST NOT alter other importers' forms or the underlying scope contract.
- **FR-020**: Values entered in the generic form's advanced fields MUST save and validate identically to before.

**Documentation**

- **FR-021**: The Docker importer guide MUST open with a quickstart covering the Hub + local-socket happy path to a completed first import, linking to deployment and agent guides for prerequisites and non-happy paths.
- **FR-022**: All existing Docker importer documentation (transports, credentials, lifecycle, failures, reconciliation) MUST remain intact; generated contract regions MUST stay generated.
- **FR-023**: Deployment documentation's Docker section MUST reference the guided setup path.

**Boundaries**

- **FR-024**: Agent execution, agent-local target registries, and the agent protocol MUST remain unchanged by this feature.
- **FR-025**: The Docker target lifecycle (immutable selectors, enable/disable, delete-in-use protection, auditing) and all existing target/credential/config APIs MUST remain behaviorally unchanged except for the added probe operation.
- **FR-026**: Secret values MUST be submitted only over the authenticated API, MUST be write-only thereafter, and MUST follow the existing credential-store encryption rules.

### Key Entities *(include if feature involves data)*

- **Docker Target** (existing): the immutable-selector, non-secret route profile the wizard creates through the existing API; unchanged lifecycle.
- **Stored Credential** (existing): the encrypted key bundle the wizard creates (or reuses) to satisfy the profile's key references; write-only after creation.
- **Importer Configuration** (existing): the Hub-bound Docker config the wizard creates with scope `{targetId}` and linked credentials.
- **Connectivity Probe** (new, ephemeral): a stateless request/response pair — profile + secrets in, sanitized ok/error out — with no persisted entity.
- **Import Run / Importer Source** (existing): unchanged; the wizard's end state is a normal Hub-bound config whose runs behave exactly as today.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An administrator can go from zero Docker configuration to a completed first import through the wizard in a single session of under 10 minutes, without reading documentation.
- **SC-002**: 100% of wizard-completed setups produce a valid target, (when required) a credential with exactly the canonical keys, and an enabled configuration through the existing APIs — zero new persistence paths.
- **SC-003**: A route can be verified end-to-end (probe → create → run) for every supported transport, including credential-requiring transports, with zero records existing before the probe.
- **SC-004**: Secret values appear in 0 API responses, logs, audit events, or error messages across the wizard and probe flows (verified by tests).
- **SC-005**: The three advanced Docker scope fields are collapsed by default in 100% of renders of the generic form, and remain editable with identical validation.
- **SC-006**: An administrator following only the quickstart section can complete the Hub + local-socket setup without consulting other documentation sections.
- **SC-007**: Lint, typecheck, tests, and build pass for every changed package; the probe endpoint has API contract-test coverage; the Docker importer package's tests continue to exercise `validateDiscoveredAsset`.

## Assumptions

- All wizard mutations are administrator-only, matching the existing permissions for target, credential, and importer-config management; no new roles or permission splits are introduced.
- Canonical credential key names are the importer's declared secret names (`caCert`, `clientCert`, `clientKey`, `sshPrivateKey`, `sshPassphrase`); arbitrary key names remain available only through the manual target-management form.
- The wizard creates new targets and credentials; it does not list, select, or attach to existing Docker targets — that remains the generic form's job.
- Partial wizard failure leaves benign, manageable artifacts (an unreferenced target is deletable; a credential is revocable); automatic rollback is deliberately out of scope.
- The probe endpoint's exact path and schema are planning artifacts; its behavioral contract (stateless, minimal check, sanitized, admin-only) is what this spec fixes.
- `environmentLabel` and `includeImages` remain visible in the generic form because they are common multi-environment and inventory choices; only the three deepest knobs collapse.
- The socket transport's Hub deployment prerequisite (mounted Docker socket) is documented guidance surfaced by the wizard, not something the wizard configures.
- Agent-side Docker onboarding improvements are deferred; this feature must not regress agent-bound Docker configurations.
- Exact wizard route path, step layout, and visual design are planning/UX artifacts bounded by the behavioral requirements above.
