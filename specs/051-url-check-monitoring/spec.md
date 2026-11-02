# Feature Specification: URL Check Monitoring — per-ComponentInstance HTTP(S) checks with availability and latency metrics

**Feature Branch**: `051-url-check-monitoring`

**Created**: 2026-11-01

**Status**: Shipped

**Input**: User description: "Unified HTTP(S) URL Check monitoring per ADR-123 (`researches/adrs/ADR-123-http-url-check-monitoring.md`) and `researches/url_importer_multi_endpoint_research.md`: administrators manage multiple HTTP(S) checks per Component from the Component detail page (or create a Component and its first checks together); each check attaches to a ComponentInstance; probes run on a schedule from the Hub or a selected Import Agent; the system collects availability, HTTP status, request-to-response-headers latency (p50/p95/p99), TTFB, and error rate with 24h/7d/30d rolling windows and 30-day observation retention; API-type checks support Basic Auth, Bearer Token, and custom headers via reusable Credentials; ADR-106 destination restrictions are unchanged; monitoring state never overwrites importer-reported ComponentInstance status or product health."

## Clarifications

### Session 2026-11-01

- Q: When a scheduled probe cannot run at all — the selected Import Agent is offline, or the Hub scheduler was down — how should that gap affect a check's availability metric? → A: Missed scheduled probes count as failures in availability (conservative SLI) AND a coverage gap is displayed so users see the monitor's own downtime distinctly.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Configure URL checks on a Component (Priority: P1)

An administrator opens a Component's detail page and manages its URL checks: adding a check with a name, target URL, the ComponentInstance it monitors, and an enabled state; editing an existing check; disabling a check temporarily; and removing a check that is no longer needed. A single ComponentInstance may carry several checks (for example, a public storefront URL and a readiness path on the same deployment). Shared monitoring defaults for the Component — probe cadence and execution vantage — are configured once and can be overridden per check where needed.

**Why this priority**: Configuration is the entry point for everything else — without the ability to define checks against the correct ComponentInstance, no monitoring value exists.

**Independent Test**: from a Component detail page, create a check against one of its instances, edit it, disable it, and re-enable it; create a second check on the same instance; verify the checks persist, remain attached to their instance, and are listed together under the Component.

**Acceptance Scenarios**:

1. **Given** a Component with at least one ComponentInstance, **When** the administrator adds a URL check with a name, valid HTTP(S) URL, and target instance, **Then** the check is persisted with its own identity and appears in the Component's check list.
2. **Given** an existing check, **When** the administrator edits its name, URL, method, cadence override, or success policy and saves, **Then** the check keeps its identity and observation history.
3. **Given** an enabled check, **When** the administrator disables it, **Then** no new probes are scheduled for it and its existing history remains visible.
4. **Given** a check, **When** the administrator deletes it and confirms, **Then** the check definition and its observations are removed and it no longer appears in the Component's check list.
5. **Given** a URL that fails the platform's URL destination safety validation, **When** the administrator attempts to save, **Then** the check is rejected with a clear validation error and nothing is persisted.
6. **Given** a session whose role lacks check-management permission, **When** the Component detail page renders, **Then** authoring controls are hidden or disabled per existing RBAC conventions.

---

### User Story 2 - Scheduled probes collect observations (Priority: P1)

Once a check is enabled, the system probes its URL on the configured schedule — every five minutes by default — from a single consistent execution vantage: the Hub by default or the Import Agent selected for the Component's monitoring setup. Each attempt produces exactly one observation recording when it ran, whether it satisfied the check's success policy, the HTTP status code when a response was received, the request-to-response-headers duration, a normalized error reason when it failed, and the vantage it ran from. One unreachable endpoint never blocks or aborts sibling checks.

**Why this priority**: Scheduled, isolated, consistently-vantaged collection is what turns a configured check into trustworthy metrics; without it there is nothing to display.

**Independent Test**: enable a check pointing at a reachable endpoint and one pointing at an endpoint that fails; verify observations accumulate for each independently at the configured cadence, each carrying status/duration/policy outcome/vantage, with no importer run records created.

**Acceptance Scenarios**:

1. **Given** an enabled check, **When** its scheduled time arrives, **Then** one probe runs from the configured vantage and one observation is recorded.
2. **Given** a check whose endpoint times out or fails at the transport level, **When** the probe runs, **Then** the observation records a failure with a normalized error reason and no HTTP status, and sibling checks are unaffected.
3. **Given** a check whose endpoint responds with a redirect status, **When** the probe runs, **Then** the original response is evaluated as-is (no follow-up request is made) and the 3xx code is recorded.
4. **Given** an endpoint that returns a large or unexpected body, **When** the probe runs, **Then** the body is not parsed or persisted and only status, timing, and policy outcome are recorded.
5. **Given** checks on the same Component, **When** probes execute, **Then** all use the Component's configured execution vantage and each observation carries that vantage.

---

### User Story 3 - View per-check status and metric history (Priority: P1)

On the Component detail page, an administrator sees the Component's checks with each check's name/URL, target environment/instance, current monitoring status, latest HTTP status code, last-checked time, and compact availability and latency summaries. Opening a check shows rolling 24-hour, 7-day, and 30-day summaries: availability percentage under the check's success policy, error rate, latency percentiles (p50/p95/p99), and a recent observation history with normalized error reasons. Every summary states its window and the execution vantage, phrased as "reachable from" that vantage rather than global availability.

**Why this priority**: The metrics are the feature's headline value — they must be visible, correctly labeled, and interpretable.

**Independent Test**: after observations accumulate, open the Component detail page and a check's detail view; verify availability/error-rate/percentile values per window, the latest status code, error reasons, and the vantage label — all derived from recorded observations.

**Acceptance Scenarios**:

1. **Given** a check with recorded observations, **When** the administrator opens its detail, **Then** availability, error rate, and p50/p95/p99 latency are shown for the 24-hour, 7-day, and 30-day windows.
2. **Given** a check with recent failures, **When** the administrator views its observation history, **Then** each entry shows timestamp, outcome, status code when present, duration, and normalized error reason when failed.
3. **Given** any metric display, **When** it renders, **Then** it states the time window and the vantage the probes ran from.
4. **Given** an instance whose importer-reported status differs from its checks' monitoring status, **When** the Component page renders, **Then** the two statuses remain distinct — monitoring results never overwrite the importer-reported instance status, Component lifecycle, or product health.

---

### User Story 4 - Authenticated checks for API Components (Priority: P2)

For checks attached to an API-category Component, the administrator configures per-check authentication: none, Basic Auth, Bearer Token, or custom headers. Secret values are never typed into monitor configuration — each check selects a reusable Credential whose values stay encrypted and write-only. Custom headers support multiple name/value rows; `Authorization` cannot be set through custom headers since it is reserved for the Basic and Bearer modes. Credentials resolve where the probe runs: stored credentials resolve in the Hub, agent-managed credential references resolve on the selected Import Agent.

**Why this priority**: Many APIs require authentication to return a healthy response, but a large share of endpoints (public health checks, web URLs) need none — the base monitoring flow ships value without it.

**Independent Test**: attach a check to an API-category Component with each auth mode; verify the probe presents the correct credentials, no secret value is ever returned by the API or stored in observations, and credential dependents reflect the check reference.

**Acceptance Scenarios**:

1. **Given** a check on an API-category Component, **When** the administrator selects Basic Auth and a Credential holding username/password values, **Then** probes send an `Authorization: Basic` header built from those values.
2. **Given** a check on an API-category Component, **When** the administrator selects Bearer Token and a Credential holding a token value, **Then** probes send an `Authorization: Bearer` header.
3. **Given** a check on an API-category Component, **When** the administrator configures multiple custom header rows mapped to Credential-held values, **Then** probes send those headers; selecting `Authorization` as a custom header name is rejected.
4. **Given** a check on a non-API Component (e.g. `WEB_ENDPOINT`), **When** the check editor renders, **Then** authentication controls are not offered.
5. **Given** a Credential referenced by a URL check, **When** an administrator attempts to delete the Credential, **Then** deletion protection treats the check as a dependent, consistent with importer-config dependents.
6. **Given** any check with authentication, **When** observations, logs, or audit records are produced, **Then** no secret value appears in them.

---

### User Story 5 - Create a Component and its first checks together (Priority: P2)

When the endpoint to monitor has no catalog entry yet, the administrator starts a flow that creates the Component (category, name, and first ComponentInstance) and its first URL checks in one pass, landing on the new Component's detail page with checks already listed.

**Why this priority**: A smooth first-run path matters for adoption, but the primary surface is the existing Component detail page; this flow reuses the same check editor.

**Independent Test**: run the create flow for a new Component with two checks; verify the Component, its instance, and both checks exist and the checks begin probing.

**Acceptance Scenarios**:

1. **Given** the create flow, **When** the administrator provides Component details and at least one valid check, **Then** the Component, instance, and checks are created together and the checks appear on the new Component's page.
2. **Given** the create flow with an invalid check URL, **When** the administrator submits, **Then** validation errors are surfaced and nothing partial is created.

---

### User Story 6 - Optional availability target (Priority: P3)

An administrator sets an availability target (for example 99.9%) and an evaluation window on a check. The check's metric display shows the target beside the observed availability for that window — clearly labeled as a target, never as a hard-coded default.

**Why this priority**: Targets aid reading of the SLI but are optional; the feature is complete without them.

**Independent Test**: set a 99.5% target on a check, view its summary, and see the target displayed alongside observed availability; remove it and confirm the summary still works.

**Acceptance Scenarios**:

1. **Given** a check with a configured target, **When** its summary renders, **Then** observed availability and the target are shown separately for the chosen window.
2. **Given** a check without a target, **When** its summary renders, **Then** no target line appears and nothing implies a default target.

---

### Edge Cases

- A check's endpoint is unreachable at configuration time — the check is still valid to save; reachability is what monitoring measures.
- The Component or a ComponentInstance is deleted or retired — its checks follow the parent record's lifecycle: deleting an instance removes its checks and observations; a retired Component's checks stop probing but history remains visible.
- The selected Import Agent is offline — probes for that setup cannot run; missed scheduled probes are not backfilled, count as scheduled-but-unsuccessful in availability (conservative SLI), and are shown as a coverage gap in the metric display.
- Two checks on the same Component point at identical URLs — allowed; checks are independently identified.
- A Credential attached to checks is rotated or expires — the next probe resolves the current value; expiry surfaces through the existing credential-status surfaces.
- A check is disabled mid-flight — an in-progress probe finishes (or is cancelled promptly) but no new probes are scheduled.
- Response latency exceeds the probe timeout — the attempt is recorded as a timeout failure, not a slow success.
- A URL passes safety validation but resolves to a blocked address at runtime — the attempt records a failure; destination restrictions remain as written (no relaxation).

## Requirements *(mandatory)*

### Functional Requirements

**Check management**

- **FR-001**: The system MUST let an authorized administrator create, read, update, enable, disable, and delete URL checks, each attached to exactly one ComponentInstance.
- **FR-002**: A ComponentInstance MUST support multiple URL checks; checks on different instances of the same Component remain distinct.
- **FR-003**: The system MUST give each URL check its own stable identity, independent of importer configs, ImporterSource, and import runs; editing a check's URL MUST preserve its identity and observation history.
- **FR-004**: Check URLs MUST pass the existing URL destination safety validation (HTTP(S) only, existing destination restrictions) with no relaxation; saving a check MUST validate at write time and probes MUST validate at run time.
- **FR-005**: The system MUST support shared monitoring defaults per Component — probe cadence and execution vantage — with optional per-check cadence override and a default cadence of five minutes.
- **FR-006**: Deleting a check MUST remove its definition and its observations; disabling a check MUST stop new probes while retaining history. Deleting a ComponentInstance MUST remove its checks and observations.

**Probe execution**

- **FR-007**: Each enabled check MUST be probed on its configured schedule from the Component's configured execution vantage — Hub by default or a selected Import Agent; one vantage applies to a monitoring setup and MUST be recorded on every observation.
- **FR-008**: Probes MUST use GET by default with an optional HEAD method, MUST NOT follow redirects, MUST NOT parse or persist response bodies, and MUST NOT persist arbitrary response-header values.
- **FR-009**: Each probe attempt MUST produce exactly one observation recording: check identity, timestamp, success/failure decision under the check's success policy, HTTP status code when a response was received, request-to-response-headers duration, normalized error reason on failure, and execution vantage.
- **FR-010**: Probe attempts MUST be isolated — one endpoint's failure or slowness MUST NOT block, delay, or abort other checks' attempts.
- **FR-011**: Probe timeouts, cancellation, concurrency, and rate limits MUST be bounded and configurable at the system level; a timed-out attempt MUST be recorded as a failure, never silently dropped.

**Success policy and metrics**

- **FR-012**: A check's success policy MUST default to accepting 2xx status codes and MUST be overridable per check (explicit accepted statuses and/or ranges); a received status is an observation evaluated against the policy.
- **FR-013**: The system MUST compute and display per check: availability (successful scheduled probes / scheduled probes, where scheduled-but-missed probes count as unsuccessful), error rate (failed probes / attempted probes), and latency percentiles (p50/p95/p99) for request-to-response-headers duration — each over 24-hour, 7-day, and 30-day rolling windows.
- **FR-014**: Detailed observations MUST be retained for 30 days and then purged; percentile values MUST be computed from observations, not stored as pre-aggregated-only values.
- **FR-015**: Displays MUST label every metric with its window and execution vantage; TTFB and request-to-response-headers latency are the same measurement boundary and MUST NOT be presented as two independent metrics. When scheduled probes did not run (monitor-side downtime), the display MUST surface a coverage gap distinct from endpoint failures.

**Separation of concerns**

- **FR-016**: Monitoring results MUST NOT write to `ComponentInstance.status`, `Component.lifecycle`, ImporterSource memberships, import runs, or the derived product health rollup.
- **FR-017**: URL Check management, scheduling, and observation storage MUST NOT be modeled as importer runs, ImporterConfig, or ImporterSource records.
- **FR-018**: Per-check URLs, config identifiers, and observation detail MUST NOT appear as metric labels in service telemetry (low-cardinality rule).

**Authentication (API-category Components only)**

- **FR-019**: Checks attached to an API-category Component MUST support per-check authentication modes: none, Basic Auth, Bearer Token, and custom headers; checks on non-API Components MUST NOT offer authentication controls.
- **FR-020**: Secret auth material MUST come from reusable Credentials — never stored in the URL or ordinary check configuration; `Authorization` MUST be reserved for Basic and Bearer modes and rejected as a custom-header name.
- **FR-021**: Credential resolution MUST follow execution vantage: stored credentials resolve in the Hub; agent-managed credential references resolve on the selected Import Agent; secret values MUST remain write-only through the API and MUST NOT appear in observations, logs, or audit payloads.
- **FR-022**: Credential dependent listing, usage tracking, revocation, and deletion protection MUST account for URL check references.

**User experience and documentation**

- **FR-023**: The Component detail page MUST surface check management and per-check status/metrics; a flow MUST exist to create a Component and its first checks together.
- **FR-024**: Check status displays MUST remain visually distinct from importer-reported instance status; phrasing MUST be "reachable from" the vantage, not global availability.
- **FR-025**: A check MUST support an optional administrator-defined availability target and window, displayed beside observed availability without a hard-coded default.
- **FR-026**: Check create/update/delete and credential attachment changes MUST produce audit events per existing conventions.
- **FR-027**: API additions MUST be documented in the OpenAPI source and user-facing documentation in the same change.

### Key Entities *(include if feature involves data)*

- **URL Check**: an administrator-configured HTTP(S) check monitoring one URL for one ComponentInstance. Attributes: identity, name, URL, HTTP method (GET/HEAD), enabled state, optional cadence override, success policy (accepted statuses), optional availability target/window, auth mode and credential reference. Owns its observation history.
- **URL Check Observation**: one timestamped probe attempt for one check. Attributes: timestamp, success decision, optional HTTP status, request-to-response-headers duration, normalized error reason, execution vantage. Retained for 30 days.
- **Component monitoring setup**: the shared per-Component monitoring configuration — default cadence and execution vantage (Hub or named Import Agent) — grouping the Component's checks.
- **ComponentInstance** (existing): the operational occurrence a check monitors; unchanged semantics — checks never write its status.
- **Credential** (existing): reusable secret source for API-type check authentication; check references join its dependent/usage tracking.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An administrator can configure a working URL check — from opening the Component page to a saved, scheduled check — in under 2 minutes.
- **SC-002**: 100% of scheduled probe attempts produce a recorded observation (success or failure); no attempt is silently dropped.
- **SC-003**: Administrators can see availability, error rate, and latency percentiles for the 24-hour, 7-day, and 30-day windows on every enabled check with data, rendered within 5 seconds of opening its detail view.
- **SC-004**: A failed probe never changes the importer-reported operational status users see for the ComponentInstance — verifiable by failing a check while an importer reports the instance healthy.
- **SC-005**: Zero secret values are exposed through the API, observation records, logs, or audit entries across all auth modes — verifiable by inspection of each surface.
- **SC-006**: An administrator can distinguish at a glance which ComponentInstance and which execution vantage each check result reflects.

## Assumptions

- Administrators already have a Component (imported or manually created) with at least one ComponentInstance before configuring checks in the common path; the create-with-checks flow covers the cold-start case.
- The five-minute default cadence, 30-day detailed retention, and 24h/7d/30d summary windows ratified in ADR-123 are correct for v1 scale; system-level bounds (probe timeout, concurrency, rate limits) are engineering parameters decided in the plan.
- Editing a check's URL preserves check identity and history; a materially different endpoint is expressed by disabling/removing and adding a check.
- Missed scheduled probes (agent offline, scheduler downtime) are not backfilled; they count as unsuccessful in the availability denominator per the clarified conservative-SLI decision, and the UI shows coverage gaps distinctly.
- Alerting/notifications on check failures are out of scope; this feature is collection and display only.
- Multi-location aggregation (running one check from several vantages) is out of scope per ADR-123.
- Existing RBAC, audit, Credential, session/auth, and import-agent infrastructure is reused without redesign; permission names follow existing naming conventions and are enumerated in the plan.
- The Component's monitoring-setup record (shared cadence/vantage) is a first-class stored record so all checks under a Component share one consistent vantage, per ADR-123's deferral of its exact shape to this spec.
