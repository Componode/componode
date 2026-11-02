# ADR-124 — URL Check execution surfaces

**Status**: Ratified (2026-11-01, spec 051)
**Supersedes**: none
**Amends**: ADR-116, ADR-054, ADR-069, ADR-071, ADR-077, ADR-107 (see
"Amendments to earlier ADRs")

## Context

ADR-123 ratified the unified HTTP(S) URL Check monitoring capability —
the domain model, the separation from importer runs, the probe semantics,
and the API-type authentication contract — but deliberately deferred every
enumerated contract surface to the feature spec: agent wire frames and the
protocol version, permission names, error codes, table columns, the exact
meaning of a scheduled-but-unexecuted probe, the credential/vantage rule,
hub tuning knobs, and metric label policy.

Spec 051 (`051-url-check-monitoring`) designed and implemented those
surfaces. Several extend enumerations that earlier ADRs present as closed
— the ADR-116 frame list and `AGENT_PROTOCOL_VERSION`, the ADR-054
permission matrix, the ADR-071 error-code set, the ADR-077 schema
inventory, and the ADR-069 metric-label policy — so they are ratified
here per the ADR-fidelity rule.

## Decision

1. **Agent probe frames.** Two new frames on the agent stream:
   `url_check.probe` (hub → agent) carrying `{probeId, url, method,
timeoutMs, authMode, authKeyNames, secretRefMap}` and
   `url_check.probe.result` (agent → hub) carrying `{probeId, outcome,
httpStatus?, durationMs?, errorType?}`. Correlation is by payload
   `probeId` — the `credential.test`/`testId` precedent — not the envelope
   `runId`: probes are not import runs, and `runId`-correlated frames
   route to the remote-run handler with `import_runs` semantics.
   `secretRefMap` carries reference names only (ADR-117); secret values
   never cross the wire. `AGENT_PROTOCOL_VERSION` bumps 3 → 4 — lockstep
   means hub and agent ship from the same commit.

2. **Permissions.** `urlCheck:create`, `urlCheck:update`,
   `urlCheck:delete`, and `monitoringSetup:update` are granted to
   `EDITOR` — the catalog-authoring precedent (`component:*` is EDITOR).
   The composite create-a-Component-with-checks path requires
   `component:create` + `urlCheck:create`. All GET routes remain
   `verifySession`-only per the read convention.

3. **Error codes.** `URL_CHECK_NOT_FOUND` and
   `MONITORING_SETUP_NOT_FOUND` join `ERROR_CODES`, `ERROR_TYPES`, the
   OpenAPI `Problem.code` enum, and `CODE_MEANINGS` in the same change
   (ADR-104). Reused codes: `VALIDATION_FAILED`, `NOT_FOUND`,
   `AGENT_OFFLINE`, `CREDENTIAL_IN_USE`, `FORBIDDEN`.

4. **Schema.** Three tables (migration 024):
   - `component_monitoring_setups` — one row per Component (unique
     `componentId`, CASCADE): `cadenceSeconds` (default 300, CHECK
     60–86400), `vantage` (`HUB`|`AGENT`), `agentId` (FK →
     `import_agents`, RESTRICT; required iff `vantage='AGENT'`).
   - `url_checks` — `setupId` (CASCADE), `componentInstanceId`
     (CASCADE, must belong to the setup's Component), `credentialId`
     (nullable FK → `credentials`, RESTRICT — required for any
     `authMode != NONE`), `name`, `url`, `method` (`GET`|`HEAD`,
     default `GET`), `enabled` (default true), `cadenceSeconds`
     (nullable override), `successPolicy` jsonb (default 2xx),
     `authMode` (`NONE`|`BASIC`|`BEARER`|`CUSTOM_HEADERS`),
     `authConfig` jsonb (credential **key-name** mappings only — never
     values), `availabilityTarget` + `targetWindow` (`24H`|`7D`|`30D`;
     set together or both null), `nextProbeAt` (null while disabled).
   - `url_check_observations` — append-only: `urlCheckId` (CASCADE),
     `scheduledAt` (the slot the observation belongs to), `outcome`
     (`SUCCESS`|`FAILURE`|`MISSED`), `httpStatus` (only when a response
     was received), `durationMs` (request-start → response-headers),
     `errorType` (bounded enum: `DNS`, `CONNECT`, `TLS`, `TIMEOUT`,
     `HTTP_STATUS`, `POLICY_BLOCKED`, `AGENT_OFFLINE`, `ABORTED`,
     `OTHER`), `vantage`, `agentId`. Retained 30 days, then purged.

5. **`MISSED` observation semantics.** A scheduled slot that could not
   execute — selected agent offline, hub downtime recovered at startup,
   or dispatch rejection — persists a `MISSED` row with `scheduledAt`
   set to the missed slot. Metrics: `availability = SUCCESS / (SUCCESS +
FAILURE + MISSED)` — scheduled-but-missed probes count against
   availability (conservative SLI, per the user-clarified decision);
   `errorRate = FAILURE / (SUCCESS + FAILURE)` — executed attempts only;
   `coverageGap = MISSED` share, displayed distinctly so monitor-side
   downtime is never confused with endpoint failure. Disabled checks
   accrue no rows — a disabled window is configuration, not monitor
   downtime.

6. **Credential vantage rule.** A check on an `AGENT`-vantage setup MUST
   reference an `AGENT_MANAGED` credential (or use no auth); `STORED`
   values never leave the hub (ADR-117), so a `STORED` credential is
   rejected on agent vantage. `Authorization` is reserved for `BASIC` and
   `BEARER` modes and is rejected as a custom-header name; custom-header
   names are validated against the HTTP token charset. `authConfig` maps
   logical fields to credential key names, never values. Check references
   join credential dependents: delete protection, revocation (revoked
   credentials block future authenticated probes), and usage tracking
   (`lastUsedAt`, throttled — written when >1 h stale).

7. **Env tunables.** `URL_CHECK_SWEEP_INTERVAL_MS` (default 15 000 — how
   often the hub scheduler selects due checks via
   `enabled AND nextProbeAt <= now()`), `URL_CHECK_PROBE_TIMEOUT_MS`
   (default 30 000 — per-probe timeout, bounded by the cadence floor),
   `URL_CHECK_HUB_CONCURRENCY` (default 10 — hub-vantage probe
   parallelism through `p-queue`), and `URL_CHECK_DEFAULT_CADENCE_SECONDS`
   (default 300; per-setup and per-check overrides bounded 60–86400 s).

8. **Metric-label policy.** `url_check_probes_total{vantage, outcome,
errorType}` counter and `url_check_probe_duration_seconds{vantage}`
   histogram — bounded enum labels only. No check id, URL, or config
   labels (ADR-069 low-cardinality rule, FR-018). The raw URL may appear
   in pino logs (non-secret configuration); credential material never
   appears in metrics, logs, observations, or audit payloads.

## Consequences

- `packages/core` carries the probe executor shared by hub and agent —
  identical measurement semantics across vantages, respecting the
  ADR-065 dependency rule.
- The agent session layer gains a probe dispatch path modeled on
  `dispatchCredentialTest` (pending map keyed by `probeId`, dispatch
  timeout, `AGENT_OFFLINE` when the agent is not connected); the
  remote-run routing is untouched.
- Hub and agent must ship in lockstep at protocol v4 — a v3 peer is
  refused `protocol_mismatch`.
- `MISSED` rows make every window query a plain `COUNT` grouped by
  outcome and give hub/agent downtime an auditable record; they also mean
  availability can drop while the endpoint itself never failed — the
  coverage-gap display is required to interpret it.
- Credential dependent listing and delete protection now cover three
  consumer kinds: importer configs, OIDC, and URL Checks.
- `docs/openapi.yaml`, `docs/url-checks.md`, `docs/ux.md` (custom-widget
  note), and the `web-url`/`api-url` importer guides update in the same
  change (ADR-104; importer-guide rule does not apply — checks are not an
  importer — but the guides get a cross-link so the discovery/monitoring
  boundary stays visible).

## Amendments to earlier ADRs

- **ADR-116** — the frame enumeration gains `url_check.probe` /
  `url_check.probe.result` and `AGENT_PROTOCOL_VERSION` becomes 4
  (Amendment 7 appended there as a back-pointer).
- **ADR-054** — the RBAC matrix gains `urlCheck:create|update|delete`
  and `monitoringSetup:update`, all EDITOR.
- **ADR-069** — the metric inventory gains `url_check_probes_total` and
  `url_check_probe_duration_seconds` under the existing bounded-label
  policy.
- **ADR-071** — the error-code set gains `URL_CHECK_NOT_FOUND` and
  `MONITORING_SETUP_NOT_FOUND`.
- **ADR-077** — `component_monitoring_setups` joins the v1 schema
  inventory alongside the `url_checks`/`url_check_observations` tables
  ADR-123 added; the column-level design ADR-123 deferred is ratified in
  item 4.
- **ADR-107** — URL Check credential consumption is concrete:
  `url_checks.credentialId` + `authConfig` key-name mapping; dependents,
  revocation, and delete protection include checks.

**Unchanged**: ADR-106 URL destination restrictions (validated at write
_and_ probe time, on the agent too), ADR-112 product-health rollup,
ADR-117 `AGENT_MANAGED` reference-only semantics, ADR-119 ImporterSource
identity and reconciliation.

## Rationale

Probes needed their own wire identity because every existing agent frame
is either lifecycle/run-scoped (`runId`-correlated, routed to the remote
run service) or a one-shot request/response (`credential.test`). A probe
is the second kind — the `testId` precedent gives correlation, timeouts,
and offline handling without inventing a new session mechanism. Persisting
`MISSED` rows rather than deriving gaps at query time makes monitor
downtime distinguishable from "the check did not exist yet" or "the check
was disabled" — states cadence math cannot recover — at the cost of one
row per skipped slot. Requiring `AGENT_MANAGED` credentials on agent
vantage is the same trust boundary ADR-117 drew for remote imports:
`STORED` values exist only inside the hub's trust domain. Bounded enum
labels keep the new series inside ADR-069's cardinality budget at any
check count.

## Alternatives considered

- **Reuse `job.assign`/`runId` for probes** — rejected. `runId`-correlated
  frames route to the remote-run handler and imply `import_runs` rows,
  reconciliation context, and run semantics a probe does not have.
- **Derive missed slots from cadence math at query time** — rejected.
  It cannot distinguish hub downtime from a not-yet-created or disabled
  check without tracking enable intervals, and leaves no auditable record
  of monitor gaps.
- **Count missed slots as neutral** — rejected by clarification; the
  conservative SLI treats a scheduled-but-unexecuted probe as
  unsuccessful, with the coverage gap shown separately.
- **Allow `STORED` credentials on agent vantage** — rejected. It would
  push plaintext secret values across the trust boundary the
  `AGENT_MANAGED` kind exists to preserve.
- **Per-check/per-URL metric labels** — rejected. Unbounded cardinality
  violates ADR-069; per-check detail stays on the API read path.
- **Pre-aggregated rollups for percentiles** — rejected. `percentile_cont`
  over ≤ ~8.6k rows/check is exact and trivially cheap; rollups cannot be
  re-aggregated across windows.

## Amendment 1 — Agent-vantage bounds and cancellation (2026-11-01, spec 052)

**Context**: the G1 gap analysis showed the ratified execution bounds
(item 7) applied only to HUB-vantage dispatch — `dispatchProbe` branched
to agent execution before the `p-queue`, the agent ran every
`url_check.probe` frame unbounded, and no cancellation path existed.

**Refinements**:

- **Item 1 (frames)** — the probe family gains
  `url_check.probe.cancel` (hub → agent, `{probeId}`), sent when the hub
  finalizes a dispatch without a result (deadline expiry). The agent
  aborts the in-flight fetch via `AbortSignal`; unknown/settled
  `probeId` is a no-op; session close aborts all in-flight probes
  locally. `AGENT_PROTOCOL_VERSION` 4 → 5 (lockstep).
- **Item 4 (schema)** — `SATURATED` joins `URL_CHECK_ERROR_TYPES`
  (migration 026 alters `url_check_obs_error_type_check`): the slot
  could not execute because probe work exceeded a bound.
- **Item 5 (MISSED semantics)** — two `SATURATED` sources map to
  `MISSED`: hub per-agent deferral overflow, and an agent at-cap refusal
  (`url_check.probe.result{outcome:"FAILURE", errorType:"SATURATED"}` —
  an unexecuted refusal is never an endpoint FAILURE). Distinguishing
  `SATURATED` from `AGENT_OFFLINE` separates "monitor overloaded" from
  "agent down".
- **Item 7 (env tunables)** — gains `URL_CHECK_AGENT_CONCURRENCY`
  (default 4 — per-agent in-flight bound), `URL_CHECK_AGENT_RATE_LIMIT`
  (default 20 — dispatches per sweep interval per agent),
  `URL_CHECK_AGENT_QUEUE_MAX` (default 100 — bounded deferral; overflow
  → MISSED/SATURATED per the spec-052 clarification), and agent-side
  `URL_CHECK_MAX_PROBES` (default 8 — the agent's own cap, deliberately
  above the hub bound).
- **Item 8 (metric-label policy)** — `url_check_probes_total` exposes
  saturation via `errorType="SATURATED"`; hub adds label-free gauges
  `url_check_agent_probes_in_flight` and
  `url_check_agent_probe_queue_depth` (sums across agents — agentId is
  never a label); agent ops gains
  `agent_url_check_probes_in_flight` and
  `agent_url_check_probes_total{result}` — which agent saturates is read
  at the agent's own scrape target.

**Unchanged**: one observation per scheduled slot under every finalize
path — a result arriving after finalization is discarded; cancellation
is prompt-resource-freeing, not a new outcome.

## Amendment 2 — Bounded summary read-path (2026-11-02, spec 053)

**Context**: the G2 gap analysis showed the Component checks table
fetched the observations endpoint once per row to draw its
recent-outcome strip, and carried no windowed summary — the ratified
metrics were reachable only on the per-check detail read.

**Refinements**:

- **List read-path (item 2 surfaces)** —
  `GET /components/:componentId/url-checks` items gain two embedded
  fields: `summary` (the compact 24h rollup: `availability`, `p95`,
  `coverageGap`, `counts` — identical formulas to the per-check metrics
  read) and `recent` (the ≤12 latest observations, `scheduledAt` desc —
  the outcome-strip payload). The route, method, and `verifySession`-only
  read permission are unchanged; the response extension is additive and
  documented in `docs/openapi.yaml` (`UrlCheckListItem.summary`/`recent`,
  new `UrlCheckSummary` schema).
- **Bounded query shape** — the handler executes a constant number of
  queries regardless of check count: one `GROUP BY urlCheckId` windowed
  aggregate (percentiles over `SUCCESS` durations via
  `percentile_cont(0.95)` with a `CASE`-scoped ordering, since `FILTER`
  is unavailable for ordered-set aggregates) and one
  `row_number() over (partition by urlCheckId)` recent-observations read.
  Per-check observations/metrics requests from the table are eliminated;
  the detail page's metrics and cursor-paginated observations reads are
  unchanged.
- **Presentation contract** — the compact summary is fixed at the
  24-hour window and the p95 percentile (clarified in spec 053);
  `availability: null`/`p95: null` are the no-data signals (never
  fabricated), and `counts.missed > 0` surfaces the coverage-gap
  annotation so monitor-side downtime stays distinguishable from
  endpoint failure (item 5 semantics).

**Unchanged**: metric formulas (item 5), the three rolling windows and
30-day retention on the detail read, and the no-pre-aggregated-rollups
decision — the summary is computed from observations at read time.

---

**Amended by ADR-125**: the onboarding role boundary is explicit —
`urlCheck:*` and Hub `monitoringSetup:update` remain EDITOR, while
non-null `credentialId` writes require `credential:read` and AGENT
vantage/`agentId` writes require `agent:read`.

## Amendment 3 — Repeated-failure auto-disable (2026-11-02, spec 056)

**Context**: the original research follow-up asked for an explicit failure
policy for repeated probe errors, and the shipped behavior — probe at
cadence, record one observation per slot, never stop — was never written
down as a contract. Spec 056 ratifies the policy: probing is bounded by a
consecutive-failure auto-disable threshold.

**Refinements**:

- **Streak semantics** — `url_checks.consecutiveFailures` increments once
  per non-`SUCCESS` observation (`FAILURE` _and_ `MISSED` — a
  monitor-side gap advances the streak the same as an endpoint failure,
  bounding work while a vantage is down) and resets to zero on `SUCCESS`.
  The counter is a maintained column updated in the same transaction that
  writes the observation — the single funnel `recordObservation` for
  executed/dispatch-time outcomes and the scheduler's bulk-MISSED writer.
- **Threshold resolution** — the effective threshold is
  `COALESCE(autoDisableAfter, URL_CHECK_AUTO_DISABLE_AFTER)`: a per-check
  integer override (`0`–`1000`, `NULL` = inherit, `0` = never) over a
  global env tunable (default **12**, `0` = never). Both write paths
  evaluate after updating the counter; the guarded disable update
  (`enabled = true`) makes the transition single-writer.
- **Disable semantics** — reaching the threshold sets `enabled = false`,
  `nextProbeAt = null`, `autoDisabledAt = now` in the same transaction and
  writes a `url_check` `disabled` audit event with
  `changes.reason = "auto_disable"` under the null (system) actor.
  Disabled-check semantics are unchanged: no observations accrue,
  including no post-disable `MISSED` inflation — a check disabled
  mid-sweep never dispatches its live slot. `autoDisabledAt` is set only
  by this transition and cleared on re-enable, distinguishing
  auto-disable from a manual disable to operators.
- **Re-enable** — manual only (`PATCH enabled: true`), and it resets
  `consecutiveFailures` to `0` and clears `autoDisabledAt`. A late-arriving
  result for a disabled check still records its observation (item
  mid-flight semantics) but never mutates the streak or re-arms the
  schedule.
- **Existing checks** — migration 027 backfills `consecutiveFailures = 0`:
  streaks start clean when the policy ships.

**Unchanged**: one observation per scheduled slot, no in-slot retries or
backoff, `MISSED` coverage-gap display semantics, no alerting or
notification on failure (out of scope), and the agent protocol — the
disable is hub-side scheduling state only.
