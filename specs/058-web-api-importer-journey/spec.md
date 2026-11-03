# Feature Specification: Web/API importer profiles and managed URL Checks

**Feature Branch**: `058-web-api-importer-journey`

**Created**: 2026-11-03

**Status**: Draft

**Input**: User-confirmed design from `researches/web_api_product_map_component_relationships_research.md` and ADR-126. Extend Web URL and API URL importer setup from one URL per config to named Component profiles with multiple ComponentInstances and importer-managed URL Checks, while preserving the independent URL Check scheduler and observation history.

## User Scenarios & Testing

### User Story 1 — Configure a collection of Components and instances (Priority: P1)

An administrator configures one Web URL or API URL importer with several logical Component profiles. Each profile has an editable name, initially suggested from its URL host, and one or more instances representing environments or deployments. Each instance has one managed URL Check. The user can review the profile, instance, and check counts before saving.

**Why this priority**: The current one-URL-per-config model makes a collection of related environments difficult to understand and forces operators to maintain redundant importer configs.

**Independent Test**: Create one importer config with at least two profiles and multiple instances per profile. Verify one catalog Component per profile, the expected ComponentInstances under each Component, and one stable managed URL Check per configured instance.

**Acceptance Scenarios**:

1. **Given** a new Web URL or API URL importer, **When** an administrator adds a profile and two environment-specific instances, **Then** the review shows one Component profile and two ComponentInstances.
2. **Given** a profile whose name was suggested from its URL host, **When** the administrator edits the name before saving, **Then** the display name changes without changing the stable profile key.
3. **Given** multiple profile cards, **When** the user adds, edits, reorders, or removes an instance before saving, **Then** the configured keys and validation errors remain associated with the correct profile and instance.
4. **Given** the new or edited configuration, **When** it is saved with an invalid or unsafe instance/check URL, **Then** the affected row identifies the validation error and no configuration change is committed.

### User Story 2 — Run complete inventory and understand endpoint outcomes (Priority: P1)

An operator runs or schedules the importer to refresh the configured inventory. Each Component profile is reported as one asset with its configured ComponentInstances. The importer performs its one-shot discovery request for each instance, records a row-level failure when an endpoint cannot be evaluated, and continues evaluating sibling rows. A completed run means every configured row was evaluated; it does not mean every endpoint responded successfully.

**Why this priority**: A collection is useful only if each run preserves the logical Component/instance structure and distinguishes endpoint failures from an incomplete inventory.

**Independent Test**: Run a config containing multiple profiles with one reachable endpoint and one failing endpoint. Verify all rows are represented, the failing ComponentInstance is `ERROR`, the run is `COMPLETED` because all configured rows were evaluated, and the run's complete Source snapshot reconciles.

**Acceptance Scenarios**:

1. **Given** a profile with multiple instances, **When** a run evaluates the config, **Then** one Component is reported with one ComponentInstance for each configured instance.
2. **Given** an endpoint that returns a non-success response or has a transport failure, **When** its row is evaluated, **Then** that instance is reported as `ERROR` and sibling rows continue.
3. **Given** every configured row has been evaluated, including rows with endpoint errors, **When** the run completes, **Then** its status is `COMPLETED` and Source reconciliation runs.
4. **Given** a fatal configuration or execution error that prevents the full inventory from being evaluated, **When** the run ends, **Then** it is `FAILED` and no absent Source membership is retired.

### User Story 3 — Configure and understand managed URL Checks (Priority: P1)

An administrator configures one URL Check for each importer-managed ComponentInstance in the Importer UI. The check may use the ComponentInstance URL or an optional health-check URL override. The user can see the check's independent history and current state from Component detail, but edits the managed definition only through its ImporterConfig. URL Check observations update the current operational status of monitored ComponentInstances after the first observation.

**Why this priority**: The new collection builder must provide an understandable monitoring journey without making importer packages responsible for monitoring persistence or conflating import-run history with probe history.

**Independent Test**: Create a managed check, verify the first importer result seeds ComponentInstance status, then record successful, failing, and missed observations. Verify status mapping, check history, Product health, and that later importer status values do not overwrite a status after the first URL Check observation.

**Acceptance Scenarios**:

1. **Given** an API-category ComponentInstance, **When** an administrator configures an authenticated check, **Then** the check references a reusable Credential and stores only credential key-name mappings, never secret values.
2. **Given** a Web Endpoint ComponentInstance, **When** the administrator configures its check, **Then** authentication controls are unavailable.
3. **Given** a configured instance URL and an optional check URL override, **When** the check is saved, **Then** the check probes the override when present and otherwise probes the instance URL.
4. **Given** a URL Check observation of `SUCCESS`, **When** it is finalized, **Then** the monitored ComponentInstance becomes `RUNNING`.
5. **Given** a URL Check observation of `FAILURE`, **When** it is finalized, **Then** the monitored ComponentInstance becomes `ERROR`.
6. **Given** a `MISSED` observation, no observation, or disabled check, **When** monitoring state is read, **Then** the last operational ComponentInstance status is preserved.
7. **Given** a managed check, **When** the user opens Component detail, **Then** status, summary, and history are visible without check-definition editing controls; the owning ImporterConfig is the edit surface.

### User Story 4 — Migrate existing single-URL configs without losing identity (Priority: P1)

An administrator upgrades existing Web URL and API URL configs to the collection shape. Each old config becomes one profile and one instance. Existing Components, ComponentInstances, ImporterSources, URL Check records, and observation histories remain attached when provenance is unambiguous. Separate old configs are not automatically merged.

**Why this priority**: Migration is part of changing the config contract; losing identities or monitoring history would damage catalog trust.

**Independent Test**: Migrate a single-URL config with an existing Component, instance, Source, and one matching URL Check. Verify the internal IDs and observation history remain, and that rerunning the config updates the same records.

**Acceptance Scenarios**:

1. **Given** an existing single-URL config, **When** it is migrated, **Then** it becomes one Component profile with one ComponentInstance and a stable generated collection key.
2. **Given** a unique existing URL Check whose URL matches the ComponentInstance URL, **When** migration runs, **Then** the same URL Check ID and observations become importer-managed.
3. **Given** additional or ambiguous legacy checks, **When** migration runs, **Then** they are disabled and retained read-only; the system does not merge histories.
4. **Given** a config with no matching check, **When** migration runs, **Then** a default managed check is created for the instance URL.
5. **Given** multiple old configs, **When** migration runs, **Then** each config migrates one-to-one and no two configs or Sources are automatically merged.

### User Story 5 — Pause, reattach, and retire managed checks safely (Priority: P1)

An administrator can disable or delete an ImporterConfig without confusing discovery lifecycle with monitoring history. A disabled config pauses its managed checks; explicitly re-enabling it resumes configured-enabled checks and resets their failure streak. Deleting a config leaves its Source and check history available for reattachment. Removing an endpoint only deletes its check history when the instance becomes `GONE` and no effective Source membership remains.

**Why this priority**: Collection changes must preserve shared inventory and check history while maintaining source-scoped reconciliation.

**Independent Test**: Disable and re-enable a config; delete and reattach it to the same Source; remove an endpoint while another Source still reports its instance; then remove the final effective membership. Verify pauses, reactivation, and cleanup at each boundary.

**Acceptance Scenarios**:

1. **Given** an enabled ImporterConfig, **When** an administrator disables it, **Then** its importer runs and managed checks pause; a check shared with another effective, enabled Source continues.
2. **Given** a disabled ImporterConfig, **When** an administrator explicitly re-enables it, **Then** configured-enabled checks resume and their failure streak/auto-disable marker resets; ordinary importer runs never clear auto-disable.
3. **Given** an ImporterConfig is deleted, **When** its Source becomes `UNMONITORED`, **Then** managed check definitions and observations are paused and retained.
4. **Given** an endpoint is absent from a completed run, **When** another effective Source still reports its ComponentInstance, **Then** the shared instance and check remain.
5. **Given** an endpoint is absent from a completed run and no effective Source membership remains, **When** the instance becomes `GONE`, **Then** its managed URL Check and observations are deleted.
6. **Given** a new config is created to reattach an existing Source, **When** the operator selects that Source, **Then** the same Source identity and memberships are reused.

### Edge Cases

- A URL's authentication query parameters or userinfo must not enter the generated Source identity.
- Two profiles with the same stable key but conflicting definitions must be rejected before last-writer-wins behavior is possible.
- The same ComponentInstance/check key reported by multiple Sources shares one URL Check and observation stream.
- If a Source shares an instance but does not own a check definition, endpoint removal by another Source does not make the instance `GONE`; check cleanup waits for the final effective membership.
- An ImporterConfig re-enable is a manual action; ordinary scheduled runs must not reset a spec-056 auto-disable streak.
- `GONE` is assigned only by Source reconciliation and cannot be overwritten by a late URL Check result.
- A URL Check marked `MISSED` changes availability/coverage metrics but does not itself set the ComponentInstance to `ERROR`.
- Direct URL Check write routes and the manual Component-create monitoring payload reject writes; read/metrics/history paths and per-Component monitoring-setup defaults remain available.
- An `API` check with missing/revoked Credential or insufficient role fails safely without persisting a partial profile, leaking secrets, or disabling sibling checks.

## Requirements

### Functional Requirements

- **FR-001**: The Web URL and API URL importer configurations MUST support multiple named Component profiles, each with one or more environment-specific ComponentInstances.
- **FR-002**: Each profile and instance MUST retain a stable key independent of editable names, URLs, and environments.
- **FR-003**: Each configured instance MUST have exactly one importer-managed URL Check definition; that check MAY override the ComponentInstance URL.
- **FR-004**: The profile name MUST be user-editable and MUST be initially suggested from the URL host.
- **FR-005**: Every instance URL and check URL MUST pass the existing HTTP(S) destination safety validation independently.
- **FR-006**: Imported Component categories MUST remain provider-appropriate: Web URL profiles use `WEB_ENDPOINT`; API URL profiles use `API`.
- **FR-007**: Managed check methods MUST be limited to `GET` and `HEAD`. Authenticated checks MUST be restricted to `API`-category Components and MUST use reusable Credential references with key-name mappings only.
- **FR-008**: Managed check definitions MUST include the accepted success policy, optional cadence override, optional availability target/window, enabled state, and per-check `autoDisableAfter` override. Vantage and default cadence MUST come from the Component monitoring setup.
- **FR-009**: Importer packages MUST remain pull-only and database-free. The core MUST synchronize Component, ComponentInstance, Source membership, and managed URL Check records from the config and validated discovered assets.
- **FR-010**: An importer run MUST report its collection Source identity before its first asset yield. The stable identity MUST survive URL-list and label edits and support reattachment after config deletion.
- **FR-011**: One importer-reported catalog record MUST represent one Component profile and all of its configured instances. Each configured endpoint MUST be evaluated; endpoint-level failures MUST be represented on that instance as `ERROR` outcomes without aborting sibling rows.
- **FR-012**: A run MUST use existing terminal statuses. A run that evaluates every configured row MUST complete as `COMPLETED`, including when row outcomes are `ERROR`; fatal/incomplete runs MUST be `FAILED` and MUST NOT reconcile absent Source memberships.
- **FR-013**: Managed URL Check synchronization MUST preserve check identity and observations across ordinary edits. Shared stable check keys MUST resolve to one URL Check when definitions agree; conflicting definitions MUST be rejected.
- **FR-014**: URL Check observations MUST continue to be produced by the independent monitoring scheduler. A successful observation MUST set monitored `ComponentInstance.status` to `RUNNING`; a failed observation MUST set it to `ERROR`; `MISSED`, no-data, and disabled states MUST preserve the last status. `GONE` MUST remain controlled by Source reconciliation.
- **FR-015**: After the first URL Check observation, subsequent importer status values MUST NOT overwrite the monitored ComponentInstance status. The importer MUST retain its one-shot discovery request for initial status and discovery details.
- **FR-016**: URL Check-driven ComponentInstance status MUST feed the existing derived Product health rollup; the rollup formula and direct-dependency scope remain unchanged.
- **FR-017**: Disabling an ImporterConfig MUST pause its managed check memberships. An explicit disabled-to-enabled transition MUST re-enable configured-enabled checks and reset their streak; ordinary importer runs MUST NOT clear auto-disable.
- **FR-018**: Deleting an ImporterConfig MUST leave its Source `UNMONITORED` and pause, not delete, managed URL Check definitions and observations. A recreated config MUST be able to reattach to that Source.
- **FR-019**: Endpoint removal MUST deactivate only the reporting Source's membership. A managed check and its observations MUST be deleted only after the ComponentInstance becomes `GONE` with no effective Source membership.
- **FR-020**: ImporterConfig migration MUST convert each existing single-URL config one-to-one, preserve existing entity/source/check identities and histories where provenance is unambiguous, and MUST NOT automatically merge configs or Sources.
- **FR-021**: Legacy manually authored URL Checks MUST be disabled and retained read-only. New managed check definitions MUST be editable only through the Importer UI; direct URL Check writes and the manual Component-create monitoring block MUST reject writes with the controlled deprecated-write error.
- **FR-022**: Component detail MUST display managed check status, summary, and history read-only and provide navigation to the owning ImporterConfig. Component-level monitoring setup defaults remain available.
- **FR-023**: The user-facing Web/API importer guides and URL Check guidance MUST explain the collection builder, one-Component/many-instance model, status propagation, check lifecycle, migration, and legacy manual-check behavior.
- **FR-024**: The Importer UI and Component detail MUST meet the existing WCAG 2.1 AA, keyboard, responsive, token, and async-state conventions.

### Key Entities

- **ImporterConfig collection**: the user-authored inventory and managed-check definition set, with a generated durable Source key.
- **Component profile**: a named importer-config entry that upserts one logical Component and its ComponentInstances; not a separate catalog entity.
- **ComponentInstance definition**: one environment-specific occurrence with a stable instance key and URL/region/version data.
- **Managed URL Check definition**: one configured check per imported instance, including target URL override and monitor policy.
- **ImporterSource**: the durable provenance owner for a collection and its Component, instance, and check memberships.
- **URL Check**: the materialized operational check row used by the independent scheduler.
- **URL Check observation**: the per-slot history row used for availability, latency, errors, and coverage.

## Success Criteria

### Measurable Outcomes

- **SC-001**: An administrator can configure at least two Component profiles, with at least two instances each, in one importer configuration.
- **SC-002**: After every completed run, 100% of configured profiles and instances have a corresponding catalog record or an explicit per-instance error result; no configured row is silently omitted.
- **SC-003**: Across a migration fixture set, 100% of unambiguous Component, ComponentInstance, ImporterSource, URL Check, and observation identities remain stable.
- **SC-004**: For every managed check fixture, URL Check success/failure updates the associated ComponentInstance according to the specified mapping, and `MISSED`/no-data/disabled outcomes do not create a false state transition.
- **SC-005**: For all tested Source-sharing cases, endpoint removal deletes a check/history only after the last effective Source membership is removed and the instance becomes `GONE`.
- **SC-006**: No Credential value appears in importer configuration responses, URL Check definitions, observations, audit records, or logs.
- **SC-007**: All direct URL Check write routes and manual Component-create monitoring writes return the documented deprecated-write response; GET/read/metrics/history paths remain available.

## Assumptions

- The user-facing builder is a scoped custom importer form; other importer schemas retain the existing rendering policy.
- Importer schedules drive inventory discovery and check-definition synchronization. The URL Check scheduler independently drives repeated monitoring.
- The importer one-shot request remains useful for discovery details and the initial ComponentInstance status; after the first URL Check observation, the Check is the authoritative status source.
- Each imported ComponentInstance receives one managed URL Check. Existing extra checks are legacy rows and are disabled/read-only rather than merged.
- A profile's name is user-authored, with the URL host as its initial suggestion. Stable keys are generated once, persisted in the config, and may be reused across Sources to declare shared identity.
- Product health continues to derive only from direct Product dependency Components; it reflects URL Check outcomes only because those outcomes update current ComponentInstance status.
- Check URLs and importer URLs continue to use ADR-106 destination restrictions. No POST probes, response-body retention by checks, alerting, or new manual check authoring are introduced.
- The project remains single-organization, self-hosted, and without multi-tenancy.
