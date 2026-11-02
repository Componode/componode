# Feature Specification: Componode Playwright User Testing

**Feature Branch**: `055-playwright-workload`

**Created**: 2026-11-02

**Status**: Draft

**Input**: User request for a comprehensive local automated user-testing exercise that detects UX, business-logic, and journey inconsistencies, with research and implementation handed to later SWE-model sessions.

## User Scenarios & Testing

### User Story 1 - Run a safe, disposable user-testing environment (Priority: P1)

A Componode maintainer starts the complete browser-testing exercise locally without risking the normal development stack or any real provider account. A normal run creates isolated application and database state, runs the tests, provides results, and removes disposable services.

**Why this priority**: Every other journey depends on a repeatable environment that cannot corrupt developer data or contact real external providers.

**Independent Test**: With the regular project stack already running, start the testing workload, verify that it uses distinct ports, environment, database, and storage, run a minimal authenticated journey, then confirm the regular stack and its data are unchanged.

**Acceptance Scenarios**:

1. **Given** the normal Componode stack is running, **When** the maintainer starts the testing workload, **Then** it uses its own ports, environment files, database, and disposable storage without stopping or modifying the normal stack.
2. **Given** the testing workload is active, **When** its browser and application exercise importer or monitoring journeys, **Then** runtime requests stay within the test environment and cannot reach real provider endpoints.
3. **Given** a normal test run completes or fails, **When** cleanup runs, **Then** disposable services and database state are removed while failure evidence and reports remain available locally.
4. **Given** a maintainer needs to investigate a failure, **When** they select the documented debug mode, **Then** services can remain available until explicitly stopped.

---

### User Story 2 - Exercise user journeys with realistic synthetic catalog data (Priority: P1)

A maintainer runs browser journeys across Componode’s documented user-facing areas with deterministic synthetic records. The workload covers add, change, removal or retirement, relationship, and pagination behavior wherever the product supports those actions.

**Why this priority**: Sparse or hand-entered fixtures hide defects in list states, business rules, permissions, and cross-entity relationships.

**Independent Test**: Start from a fresh disposable database, seed the documented synthetic dataset, complete representative catalog and administration journeys, and verify both visible results and supported data lifecycle outcomes.

**Acceptance Scenarios**:

1. **Given** a fresh test database, **When** the fixture setup completes, **Then** every application-owned persistent table is accounted for and has appropriate synthetic lifecycle data; only migration bookkeeping tables are excluded.
2. **Given** a user-manageable entity or relationship, **When** the UI supports creating, changing, removing, retiring, or deciding it, **Then** browser tests exercise those actions and verify their outcomes.
3. **Given** a list with server-side pagination, **When** a test requests page or offset boundaries, **Then** it verifies correct ordering, counts, continuation, and final partial-page behavior without inventing UI controls that do not exist.
4. **Given** a page that loads all component pages automatically, **When** the synthetic dataset spans multiple pages, **Then** the browser view contains the complete expected result set.

---

### User Story 3 - Test implemented importers without live provider access (Priority: P1)

A maintainer tests every importer that currently performs real discovery using deterministic local mock APIs derived from Componode’s importer guides and the provider’s official API documentation. The fixtures can vary between runs so discovery, updates, absence, and failures are observable.

**Why this priority**: Importer output drives catalog data and source-scoped reconciliation, while tests must never depend on real cloud or repository credentials.

**Independent Test**: Configure each implemented importer against its local mock, run it using synthetic credentials, verify normalized outputs and run outcomes, then change the fixture and verify the agreed reconciliation scenario.

**Acceptance Scenarios**:

1. **Given** an importer with implemented provider behavior, **When** a successful or empty fixture is returned, **Then** the resulting discovered Components and run state match the provider mapping contract.
2. **Given** a collection importer fixture that adds, changes, omits, or rejects data, **When** the importer is run again, **Then** the workload can verify update and source-scoped retirement behavior without contacting a real provider; single-endpoint importers use applicable empty-body/payload cases instead of fictitious inventory omission.
3. **Given** multiple ImporterSources report shared catalog data, **When** one source omits that data, **Then** the workload verifies that another active source preserves the shared Component.
4. **Given** a package remains a scaffold with no external calls, **When** the importer matrix is evaluated, **Then** it is recorded as deferred rather than receiving a fictitious provider mock.

---

### User Story 4 - Verify roles, authentication, and monitoring journeys (Priority: P1)

A maintainer exercises the application as Viewer, Editor, and Admin, including local authentication, OIDC, administration, URL Check setup, and Hub- and Agent-vantage probe outcomes. Sensitive test values remain disposable and are not exposed in outputs.

**Why this priority**: Permission and monitoring defects can make a visually complete flow unsafe or unusable.

**Independent Test**: Use isolated test identities to complete permitted and forbidden actions, configure representative checks, observe real local probe outcomes, and verify role-specific UI and API behavior.

**Acceptance Scenarios**:

1. **Given** each supported role, **When** it visits documented user-facing areas, **Then** read, write, and denied actions match the permission matrix.
2. **Given** an active Component with no Component Instances, **When** an Editor adds the first instance and then a URL Check, **Then** the existing Component is reused; invalid input, missing Components, inactive Components, unauthorized callers, and duplicate instances produce the documented outcomes.
3. **Given** an existing check or monitoring setup with an Admin-selected Credential or Import Agent, **When** an Editor changes unrelated fields, **Then** the existing selection is preserved; attempts to reconfigure it are rejected; switching Agent vantage back to Hub clears the Agent selection.
4. **Given** each URL Check authentication mode, **When** a local Hub probe runs, **Then** the local target receives the expected request and Componode records the expected observation without disclosing credential values.
5. **Given** an Agent-vantage check, **When** the local Import Agent is connected or unavailable, **Then** successful and missed-probe outcomes are visible through the documented user journey.
6. **Given** OIDC is configured against the local test identity provider, **When** a user completes or fails authentication, **Then** provisioning, callback, and safe error behavior match the application contract.

---

### User Story 5 - Diagnose failures and keep coverage current (Priority: P2)

A maintainer reviews readable test results and failure evidence, and can identify which documented screens, roles, tables, and implemented importers are covered. Future product work has a clear requirement to extend the corresponding tests and references.

**Why this priority**: A test workload is useful only when failures are diagnosable and new product behavior does not silently fall outside its coverage.

**Independent Test**: Intentionally fail a journey, inspect the local report and failure artifacts, then add a fixture-only importer or route entry in a controlled branch and verify the coverage process identifies the missing test mapping.

**Acceptance Scenarios**:

1. **Given** a test run, **When** it completes, **Then** it produces a human-readable report and machine-readable test results under the Playwright folder.
2. **Given** a failed test, **When** the maintainer opens its evidence, **Then** traces, screenshots, and video are available without exposing secret values.
3. **Given** a supported route or implemented importer is added, **When** the coverage check runs, **Then** a missing journey, test, or mock mapping is reported.
4. **Given** the documented key routes, **When** accessibility checks run, **Then** automatically detectable WCAG 2.1 AA issues are reported; visual screenshot-diff baselines are not required.

## Edge Cases

- A Docker port is already occupied; startup fails safely with an actionable message and does not reuse another stack’s database.
- A test environment variable is missing, malformed, or points at the regular project stack; the workload fails closed before mutations.
- A mock is unavailable, returns malformed data, or returns a provider error; the test records the intended failure and does not fall through to a live provider.
- A mock scenario changes while an importer run is active; tests isolate or serialize scenario state so results remain deterministic.
- A Components list spans multiple API pages while UI hooks fetch every page; tests check both server pagination and the actual rendered set.
- A seed operation would bypass an encrypted credential, append-only history, or lifecycle invariant; that data is created through a supported application flow instead.
- An Editor preserves an existing Credential or Agent selection while changing an unrelated field; only an actual selection or auth-configuration change is denied.
- A URL Check probe targets a local mock by a `.test` hostname; URL safety validation passes the hostname while Docker’s internal network resolves it to the mock.
- The real Import Agent is disconnected or its TLS trust is invalid; the test verifies a bounded safe failure instead of hanging indefinitely.
- The current 054 URL Check onboarding changes are not in the 055 worktree base; implementation and execution must wait until those changes are committed or otherwise integrated.

## Requirements

### Functional Requirements

- **FR-001**: The workload MUST start a disposable local environment using distinct ports, environment, database, and storage from the normal project stack.
- **FR-002**: The workload MUST use disposable per-run identities and credentials and MUST prevent test runtime calls to real importer providers or identity providers.
- **FR-003**: A normal run MUST prepare a fresh database, execute migrations and deterministic setup, run tests, produce results, and clean up; a documented debug mode MUST allow services to remain available for investigation.
- **FR-004**: The fixture and coverage matrix MUST account for every application-owned persistent table and MUST exclude only migration bookkeeping; lifecycle-generated records MUST be created through supported operations.
- **FR-005**: Browser journeys MUST cover all documented user-facing areas and the Viewer, Editor, and Admin role boundaries, including supported create, change, remove/retire, and relationship behavior.
- **FR-006**: Pagination checks MUST cover the supported Components, activity, and suggestions API boundaries and the actual UI behavior that loads all component pages.
- **FR-007**: Mock coverage MUST include all currently implemented importers—Alibaba Cloud, GitHub, Docker, web URL, and API URL—and MUST defer scaffold importers until their external behavior is implemented.
- **FR-008**: Importer mocks MUST use the endpoint shapes Componode calls, cite importer guides and official provider references, and support deterministic success, changed, error, and applicable empty/omitted-inventory scenarios.
- **FR-009**: Importer lifecycle coverage MUST verify full source-scoped add/update/retire and shared-source preservation through the agreed representative GitHub scenario, with provider mapping coverage for every implemented importer.
- **FR-010**: Monitoring journeys MUST cover first-instance recovery, supported URL Check auth modes, Hub probe observations, real Agent-vantage success, and offline/missed outcomes.
- **FR-011**: Role tests MUST verify that Editors may preserve existing Credential and Agent selections while changing unrelated fields, may switch Agent setup back to Hub, and may not reconfigure Credential auth or select/reselect an Import Agent.
- **FR-012**: OIDC journeys MUST use a local Dex provider and cover successful provisioning and meaningful callback/token failure paths.
- **FR-013**: The workload MUST produce HTML and JUnit reports and retain failure-only traces, screenshots, and video under the Playwright folder without exposing secret values.
- **FR-014**: Accessibility checks MUST cover key routes and interaction states against automatically detectable WCAG 2.1 AA issues; initial delivery MUST NOT depend on screenshot-diff baselines.
- **FR-015**: The workload MUST maintain a route/table/importer coverage matrix and a feasible automated guard for implemented importers that lack test/mock mappings.
- **FR-016**: The handoff MUST provide dependency-ordered, immediately executable tasks and a run/debug guide for later Devin SWE-model sessions.
- **FR-017**: The test workload MUST remain local-only in its initial delivery; it MUST NOT add CI configuration or propose a PR to `main`.
- **FR-018**: The 055 implementation MUST preserve the active 054 worktree and MUST document integration of the 054 URL Check onboarding changes as a prerequisite to implementation and execution.

### Key Entities

- **Test Run**: One isolated execution with generated credentials, a fresh database, mock scenarios, reports, and cleanup state.
- **Synthetic Fixture**: Deterministic, non-production records and provider responses used to cover entity lifecycles and pagination.
- **Mock Scenario**: A controlled provider or URL Check response profile used to test success, empty, changed, omitted, and failure cases.
- **Coverage Entry**: A route, role/action, application table, importer, mock endpoint, or probe behavior mapped to one or more automated tests.
- **Failure Evidence**: A report, trace, screenshot, video, and sanitized diagnostic record associated with a failed test.

## Success Criteria

### Measurable Outcomes

- **SC-001**: A documented local command starts the isolated environment, runs the full suite, writes both reports, and cleans up without modifying the regular project stack.
- **SC-002**: The coverage matrix has an explicit entry for all 35 application-owned persistent tables and for every documented user-facing route area; only the two migration bookkeeping tables are excluded.
- **SC-003**: Every currently implemented importer has at least one deterministic mapping journey and the shared reconciliation lifecycle is verified through the representative importer.
- **SC-004**: Every server-paginated endpoint is tested across two complete pages and a partial page, and the component UI displays the complete multi-page fixture set.
- **SC-005**: Automated browser journeys cover all three roles, all four URL Check auth modes, Hub and Agent probe outcomes, and local OIDC success and failure.
- **SC-006**: Test runtime makes zero network requests to real importer or identity-provider endpoints, and test credentials are generated per run and absent from checked-in files and reports.
- **SC-007**: Every failed test retains a trace, screenshot, and video; successful tests do not retain failure-only evidence.
- **SC-008**: The handoff defines a measurable completion criterion and implementation tasks for every user story, with the 054 integration prerequisite stated before execution.

## Assumptions

- The five importer packages currently making real provider calls remain the implemented importer scope; AWS, Azure, Kubernetes, and MCP Server remain excluded while they are scaffolds.
- The normal Componode application remains the system under test; Playwright-specific execution, mock, seed, and reporting files are kept in `playwright/`.
- The existing root Dockerfile and `.dockerignore` are reused unchanged; the existing `**/.env*` pattern excludes local test env files from the build context.
- The existing PostgreSQL schema and migrations remain authoritative; migration bookkeeping is not synthetic business data.
- The test runtime has Docker Compose and can build/pull required images before the isolated runtime network is restricted.
- The 054 URL Check onboarding changes must be committed or otherwise integrated into the 055 worktree before implementing or executing journeys that depend on them.
- Initial execution is local-only and serialized; CI, performance/load testing, mobile widths below the documented 768px boundary, and visual baseline maintenance are out of scope.
- Automated accessibility checks supplement, but do not replace, human accessibility assessment.
