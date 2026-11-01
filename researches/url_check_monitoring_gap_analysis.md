# URL Check Monitoring Gap Analysis

> **Purpose**: Compare the URL importer/multi-endpoint research with the
> feature-051 specification and the implementation on `main`, then identify
> remaining work that could become one or more phased specifications.
>
> **Review snapshot**: `origin/main` at
> `a0fb22cad3457132a36790f050482f040345ad8d`. The reviewed local copies of the
> research, spec, and implementation paths match that revision.
>
> **Status**: Informative gap analysis, not an implementation contract. The
> candidate scopes below need the normal spec-kit workflow before implementation.

---

## Executive finding

Feature 051 implements the core direction in
[ADR-123](./adrs/ADR-123-http-url-check-monitoring.md): independent URL Check
records attached to ComponentInstances, scheduled HTTP(S) observations,
rolling metrics, reusable Credentials, and separation from importer runs and
operational instance status. Its docs also correctly distinguish URL Checks
from the existing point-in-time `web-url` and `api-url` importers.

The work is therefore **substantially complete as a first monitoring
capability**, but the comparison found three user-facing or operational gaps:

1. **Agent-vantage probes bypass the configured concurrency and rate bounds,
   and have no cancellation path.** This conflicts with FR-011's system-level
   bound requirement.
2. **The Component-level checks table does not show a compact availability or
   latency summary.** It shows recent outcome dots; windowed metrics are only
   on the per-check detail page. The table also fetches observations once per
   row.
3. **The create-with-checks onboarding flow is narrower than the regular
   editor.** It cannot configure API authentication or availability targets
   for the first checks, and an existing Component with no ComponentInstance
   has no in-page path into check setup.

These gaps do not invalidate the chosen model or justify changing importer
identity, ComponentInstance semantics, URL destination restrictions, or
product-health rollups. Existing importer configurations are not automatically
converted or merged; ADR-123 preserves their discovery contract, and the
importer guides now direct users to URL Checks for monitoring.

## Coverage review

| Research direction                                                                                                                                  | Feature 051 result                                                                                                    | Assessment                                                                                                                   |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| One logical Component can have multiple independently named URL Checks, each attached to the appropriate ComponentInstance.                         | `url_checks` has its own identity and instance relationship; the Component detail page supports multiple checks.      | **Covered.**                                                                                                                 |
| Monitoring is separate from `ImporterConfig`, `ImporterSource`, import runs, ComponentInstance status, and product health.                          | Separate tables, scheduler, API, UI, and observation history; tests assert no importer-run or instance-status writes. | **Covered.**                                                                                                                 |
| Shared Component cadence and execution vantage, with optional per-check cadence; GET/HEAD, no redirects/body retention, configurable status policy. | Spec, shared probe executor, setup editor, and API implement these semantics.                                         | **Covered**, with the Agent resource-bound gap below.                                                                        |
| Availability, error rate, coverage gap, latency percentiles, three rolling windows, and 30-day detailed retention.                                  | Observation-based metrics and per-check detail view implement these definitions.                                      | **Covered** on the individual check detail page; **partial** for the Component overview.                                     |
| API-category authentication using reusable Credentials, including custom headers and the `Authorization` reservation.                               | Credential key-name mappings, Hub/Agent resolution, dependent tracking, and editor controls are implemented.          | **Covered** for the regular check editor. The create-with-checks page is an exception.                                       |
| Component-first management and a create-Component-with-first-checks path.                                                                           | Both paths exist.                                                                                                     | **Partial**: the composite flow omits some regular-editor options, and existing Components without instances are a dead end. |
| Preserve existing URL importer discovery behavior and make its distinction from monitoring clear.                                                   | Importer guides cross-link URL Checks and explain that importer runs are point-in-time discovery.                     | **Covered by design.** No automatic migration was specified.                                                                 |

References: [research direction and metric/UX requirements](./url_importer_multi_endpoint_research.md#bottom-line),
[feature 051 requirements](../specs/051-url-check-monitoring/spec.md#L134-L181),
[feature 051 implementation tasks](../specs/051-url-check-monitoring/tasks.md),
[URL Check guide](../docs/url-checks.md),
[Web URL guide](../docs/importers/web-url.md#monitoring-vs-discovery),
and [API URL guide](../docs/importers/api-url.md#monitoring-vs-discovery).

## Gaps suitable for follow-up specification

### G1 — Bound and cancel Agent-vantage probe work

**Proposed priority: P1 — operational safety and FR-011 completeness.**

FR-011 requires probe timeout, cancellation, concurrency, and rate limits to
be bounded and configurable at the system level. The Hub path has a `p-queue`
with `URL_CHECK_HUB_CONCURRENCY` and `URL_CHECK_PROBE_RATE_LIMIT`, but the
dispatcher branches to Agent execution before using that queue. On the Agent,
the WebSocket handler starts `handleUrlCheckProbe` without a queue or
in-flight limit. The probe frame contract has no cancellation frame, and the
Agent handler does not pass an abort signal to the shared probe executor.

This means configured Hub bounds do not bound Agent-vantage work. A large
batch of due checks for one Agent can be dispatched concurrently, and a timed
out Hub request or disconnected session does not explicitly cancel an
already-started Agent fetch. Individual probe timeouts limit duration, but do
not provide admission control or prompt cancellation.

**Candidate spec outcome**:

- Define and enforce a maximum in-flight probe count and dispatch rate for
  Agent-vantage work, with explicit behavior when the limit is reached.
- Specify timeout, cancellation, late-result, agent-disconnect, and
  queue-saturation semantics so scheduled slots are neither silently lost nor
  double-recorded.
- Add tests showing that load above the limit is bounded and that a timed-out
  or disconnected probe follows the specified cancellation behavior, and that
  a late result cannot create a duplicate observation.
- Document the applicable configuration and expose only bounded-cardinality
  telemetry.

**ADR follow-up**: if the resolution adds a frame, error/disconnect reason, or
enumerated tuning variable, amend ADR-124 (and any ADR it extends) in the same
change per the ADR-fidelity rule.

Evidence: [FR-011](../specs/051-url-check-monitoring/spec.md#L147-L154),
[Hub-only queue](../packages/backend/src/services/probe-dispatcher.ts#L54-L70),
[Agent branch and Hub queue use](../packages/backend/src/services/probe-dispatcher.ts#L363-L447),
[Agent frame handling](../packages/agent/src/client.ts#L388-L396),
[Agent probe handler](../packages/agent/src/probe.ts#L69-L128),
and [Agent frame contract](../specs/051-url-check-monitoring/contracts/agent-frames.md#L416-L472).

### G2 — Provide an at-a-glance Component monitoring summary

**Proposed priority: P2 — Component-level operational UX.**

The research recommends that the Component endpoint table include a recent
availability/latency summary as well as endpoint identity, environment,
current result, latest HTTP status, and last-check time. The delivered table
shows the latter fields and a strip of recent outcome dots, but not a
window-labeled availability or latency value. The 24-hour, 7-day, and 30-day
metrics are available only after opening each check's detail page.

The current recent-outcome strip also requests the observations endpoint from
each rendered check row. The Component checks endpoint returns setup, checks,
and latest-observation summaries in one request, but not a compact windowed
metric summary. As the number of checks grows, the table therefore creates
one additional observations request per check.

**Candidate spec outcome**:

- Agree which compact metric(s) and window belong in the Component table
  (the research suggests a recent availability/latency summary; the precise
  window and presentation remain open).
- Include the selected window and execution vantage in the displayed summary,
  and keep coverage gaps distinguishable from endpoint failures.
- Provide the summary through a bounded list/read path rather than one
  observations request per row; preserve the existing detailed history view.
- Add API/service and frontend tests for empty, partial, missed, and many-check
  cases, including a check that loading the table does not fan out one request
  per check.

Evidence: [research table recommendation](./url_importer_multi_endpoint_research.md#L205-L211),
[FR-023](../specs/051-url-check-monitoring/spec.md#L175-L181),
[Component table fields](../packages/frontend/src/ux/components/catalog/url-checks-card.tsx#L84-L124),
[per-row observations hook](../packages/frontend/src/ux/components/catalog/url-checks-card.tsx#L59-L67),
[row rendering](../packages/frontend/src/ux/components/catalog/url-checks-card.tsx#L215-L230),
and [detail-page metric cards](../packages/frontend/src/ux/components/catalog/url-check-detail.tsx#L229-L245).

### G3 — Complete first-check onboarding and existing-Component recovery

**Proposed priority: P2 — close the difference between the advertised flow
and the regular check editor.**

The regular check editor supports API authentication and an optional
availability target. The create-with-checks page uses a separate, reduced
repeated-row editor with name, URL, method, success policy, and cadence only.
Its submit handler explicitly sends `authMode: "NONE"` and does not send
`availabilityTarget` or `targetWindow`. An administrator can edit the checks
after creation, but a protected API endpoint is initially scheduled without
authentication, and the user must make a second edit to complete setup. This
is narrower than the spec's promise to reuse the same check editor.

There is a separate cold-start hole for an already-existing Component with
no instances. The Component detail card only enables “Add check” when the
Component has an instance; otherwise, it displays that no instance exists
without an action. The composite flow creates a _new_ Component plus its
first instance and checks, so it does not recover an existing zero-instance
Component.

**Candidate spec outcome**:

- Define which check fields the atomic create flow supports and bring it to
  parity for the fields needed to create a valid first check, including
  API authentication and optional target/window when applicable.
- Keep creation atomic: invalid check or credential references must leave no
  partial Component, instance, setup, or checks.
- Decide whether an existing Component without an instance can create its
  first instance and checks together, or whether the UI should guide the user
  to a different supported workflow. Do not silently create a duplicate
  Component.
- Clarify access requirements: check creation/setup changes are EDITOR-gated,
  while the current credential and Agent selectors report Admin-only access.
  Either document the Admin-only sub-capabilities or ratify a safe metadata
  read permission for Editors; keep secret values write-only.
- Test the first-probe behavior so an incomplete/unauthenticated check is not
  accidentally left running as the result of the onboarding flow.

Evidence: [US5's create-with-first-checks scenario](../specs/051-url-check-monitoring/spec.md#L93-L105),
[FR-019 and FR-025](../specs/051-url-check-monitoring/spec.md#L168-L181),
[reduced repeated-row fields](../packages/frontend/src/ux/components/forms/url-check-rows.tsx#L10-L19),
[repeated-row editor](../packages/frontend/src/ux/components/forms/url-check-rows.tsx#L121-L157),
[composite submit payload](../packages/frontend/src/ux/app/components/new.tsx#L98-L143),
[regular API auth editor](../packages/frontend/src/ux/components/catalog/url-check-editor.tsx#L79-L118),
[zero-instance empty state and add gate](../packages/frontend/src/ux/components/catalog/url-checks-card.tsx#L176-L212),
[credential role message](../packages/frontend/src/ux/components/catalog/url-check-editor.tsx#L79-L110),
and [Agent selector role message](../packages/frontend/src/ux/components/catalog/monitoring-setup-editor.tsx#L41-L123).

## Clarifications and intentional boundaries

These items should not be mistaken for omitted implementation:

- **Credential testing**: feature research explicitly chose the first scheduled
  probe as the credential validation result; there is no separate
  check-specific credential-test endpoint in v1.
  ([spec research R6](../specs/051-url-check-monitoring/research.md#L106-L135))
- **Alerting and multi-location aggregation**: both are explicitly out of
  scope for 051. A future alerting or multi-vantage capability needs its own
  product decision; it is not implied by the monitoring research.
  ([spec assumptions](../specs/051-url-check-monitoring/spec.md#L202-L210))
- **Existing URL importer configurations**: 051 does not migrate importer
  configs or automatically merge Components created by separate URL importer
  configs. This is consistent with ADR-123's decision to preserve importer
  discovery and source identity. If conversion of existing configurations is
  required, specify it separately, including the effect on ImporterSource
  memberships and Component identity; do not auto-merge by URL.
  ([ADR-123](./adrs/ADR-123-http-url-check-monitoring.md),
  [Web URL monitoring note](../docs/importers/web-url.md#L52-L57),
  [API URL monitoring note](../docs/importers/api-url.md#L119-L126))
- **Repeated failures**: the earlier research follow-up asked for a repeated
  probe error policy. The shipped behavior continues the configured schedule
  and records each attempt; no retry/backoff policy is stated as a product
  contract. Before adding retries, clarify whether fixed-cadence retries are
  the intended v1 behavior. Alerting remains out of scope.
  ([research follow-up](./url_importer_multi_endpoint_research.md#L336-L365),
  [scheduler](../packages/backend/src/services/url-check-scheduler.ts#L153-L163),
  [spec assumptions](../specs/051-url-check-monitoring/spec.md#L204-L210))
- **Completion metadata**: the task checklist is checked through T058 and
  ADR-124 describes the designed and implemented surfaces, but
  `spec.md` still says `Status: Draft`. Reconcile that status during the
  feature's final convergence; it is an artifact-hygiene issue, not a runtime
  capability gap.
  ([spec status](../specs/051-url-check-monitoring/spec.md#L1-L9),
  [tasks](../specs/051-url-check-monitoring/tasks.md),
  [ADR-124](./adrs/ADR-124-url-check-execution-surfaces.md#context))

## Suggested phasing

1. **Operational bounds (G1)** — close the Agent-vantage admission-control
   and cancellation contract first; amend ADR-124 if any closed surface
   changes.
2. **Component overview (G2)** — agree a compact metric summary and provide
   it without per-row request fan-out.
3. **Onboarding completion (G3)** — align the atomic create flow with the
   regular editor, settle the existing zero-instance path, and document the
   role boundary for credentials and Agent selection.
4. **Decision-only follow-up** — explicitly state repeated-failure behavior
   and reconcile feature-051 status. Only create a separate feature spec if
   the decision adds runtime behavior.

Do not assign feature numbers in this gap analysis. If the user elects to
turn any candidate into a specification, follow the Research → Specification
workflow in [AGENTS.md](../AGENTS.md#research-workflow): resolve open decisions
first, ratify any new architectural contract surfaces, then generate the
authoritative `spec.md`, `plan.md`, and `tasks.md` under `specs/`.

## Sources

- [URL importer and multi-endpoint research](./url_importer_multi_endpoint_research.md)
- [ADR-123 — HTTP(S) URL Check monitoring](./adrs/ADR-123-http-url-check-monitoring.md)
- [ADR-124 — URL Check execution surfaces](./adrs/ADR-124-url-check-execution-surfaces.md)
- [Feature 051 specification](../specs/051-url-check-monitoring/spec.md)
- [Feature 051 research](../specs/051-url-check-monitoring/research.md)
- [Feature 051 implementation plan](../specs/051-url-check-monitoring/plan.md)
- [Feature 051 task list](../specs/051-url-check-monitoring/tasks.md)
- [URL Check user guide](../docs/url-checks.md)
