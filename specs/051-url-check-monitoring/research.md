# Research — URL Check Monitoring (spec 051)

Resolves the engineering questions the spec and ADR-123 deferred. Each entry:
**Decision / Rationale / Alternatives**.

## R1 — Probe executor placement and mechanics

**Decision**: `packages/core/src/monitoring/probe.ts` exports
`executeHttpProbe(input, authHeaders, signal): Promise<ProbeResult>` used by
both the Hub dispatcher and the Agent probe handler. Uses `fetch` with
`redirect: "manual"`, `AbortSignal.timeout(timeoutMs)` + caller signal, method
`GET` or `HEAD`, `User-Agent: Componode-URLCheck/<version>`, and
`res.body?.cancel()` after headers arrive (duration measured to
headers/TTFB). `assertUrlAllowedForImport` (ADR-106) runs before the request.
Result: `{outcome, httpStatus?, durationMs?, errorType?}` — never headers or
body content.

**Rationale**: one implementation guarantees identical measurement semantics
across vantages; `core` is the only package both backend and agent may import
(ADR-065). `redirect:"manual"` records the original 3xx under the success
policy (ADR-123 §6).

**Alternatives**: per-vantage implementations (rejected — divergent timing
semantics); forwarding the importers' fetch (rejected — monitoring is not an
importer).

## R2 — Scheduling, timeout, concurrency, rate limits

**Decision**: `UrlCheckSchedulerService` — a `setInterval` sweep (default
15 s, env `URL_CHECK_SWEEP_INTERVAL_MS`) selects checks where
`enabled AND nextProbeAt <= now()` (indexed). `nextProbeAt` is set on
create/enable/update and advanced to `scheduledAt + cadence` after each
attempt. Hub probes run through `p-queue` (default concurrency 10, env
`URL_CHECK_HUB_CONCURRENCY`); each check is dispatched independently so one
slow endpoint cannot block siblings (FR-010). Probe timeout default 30 s
(env `URL_CHECK_PROBE_TIMEOUT_MS`, bound ≤ cadence floor 60 s). Cadence bounds:
min 60 s, max 86400 s, default 300 s (`URL_CHECK_DEFAULT_CADENCE_SECONDS`,
overridable per check within bounds).

**Rationale**: interval sweep + `nextProbeAt` is simpler and more honest than
cron for "every N minutes", survives restarts, and makes missed-slot
detection a comparison against `now()`. Reuses `p-queue` already used for
importer concurrency.

**Alternatives**: node-cron per check (rejected — sub-minute granularity and
per-check reschedule churn); a persistent job queue table (rejected —
over-engineered for v1 volume).

## R3 — Missed probes (clarified SLI semantics)

**Decision**: `url_check_observations.outcome` includes `MISSED` alongside
`SUCCESS`/`FAILURE`. The scheduler writes a `MISSED` row for each scheduled
slot it could not dispatch — agent offline (`AGENT_OFFLINE` errorType), hub
downtime recovered at startup (reconcile pass writes one `MISSED` row per
skipped slot, `scheduledAt` set to the missed slot), or dispatch rejection.
Availability = `SUCCESS / (SUCCESS + FAILURE + MISSED)` — conservative per
the clarified decision; coverage gap = `MISSED / total` displayed distinctly.
Error rate = `FAILURE / (SUCCESS + FAILURE)` — executed attempts only.
Checks that are `enabled=false` accrue nothing.

**Rationale**: persisted `MISSED` rows make every window query a plain
`COUNT(GROUP BY outcome)` and give an auditable record of monitor downtime —
including hub downtime, which cannot be derived from "schedule vs
observations" alone because the disabled/enabled windows would be
unknowable.

**Alternatives**: derive missed slots from cadence math at query time
(rejected — needs enable-interval tracking and cannot distinguish monitor
downtime from check-not-yet-existing); count missed as neutral (rejected by
clarification — conservative SLI).

## R4 — Observation storage and metric queries

**Decision**: `url_check_observations` rows are the single source; no
pre-aggregation (precomputed quantiles cannot be re-aggregated — research §4,
Prometheus guidance). Metrics computed at read time: availability/coverage
via `count(*) GROUP BY outcome` per window; latency percentiles via Postgres
`percentile_cont(0.5|0.95|0.99) WITHIN GROUP (ORDER BY durationMs)` over
`outcome='SUCCESS'` rows; error-rate from outcome counts. Windows 24h/7d/30d
computed from `scheduledAt >= now() - interval`. Retention: nightly sweep
`DELETE WHERE scheduledAt < now() - 30 days` in the scheduler service.

**Rationale**: ≤ ~8.6k rows/check at default cadence — trivially queryable;
`percentile_cont` is exact, not approximate.

**Alternatives**: continuous aggregates/rollups (rejected — premature at this
volume); histogram table (rejected — same reason).

## R5 — Check identity, URL edits, delete/disable semantics

**Decision**: editing `url` updates the row in place — identity and history
preserved (spec FR-003). `PATCH` toggles `enabled`; disable stops future
slots (no `MISSED` rows while disabled — the gap is configuration, not
monitor downtime). `DELETE` removes the check and its observations via FK
cascade. Deleting a ComponentInstance cascades its checks; deleting a
Component cascades its monitoring setup (and therefore its checks). A
RETIRED Component's checks do not probe (scheduler filters on active
lifecycle) but remain readable.

**Rationale**: check is the monitoring unit; history must not fragment across
URL edits. Cascade mirrors spec FR-006.

**Alternatives**: new identity per URL edit (rejected — fragments history);
soft-delete observations (rejected — 30-day retention already bounds data).

## R6 — Credential linkage and secret contract

**Decision**: `url_checks.credentialId` (nullable FK → `credentials`,
`ON DELETE RESTRICT`) + `url_checks.authConfig` jsonb mapping logical fields
to **credential key names** (never values):

- `BASIC` → `{usernameKey, passwordKey}`
- `BEARER` → `{tokenKey}`
- `CUSTOM_HEADERS` → `{headers: [{name, key}]}` — header `name` validated
  against an HTTP token-name allowlist and `Authorization` rejected.

Resolution builds request headers from the credential bundle at probe time:
`STORED` → decrypt in Hub service; `AGENT_MANAGED` → agent resolves refs via
`secretRefMap` (names only cross the wire, ADR-117). **Vantage rule**: a
check on an AGENT-vantage setup MUST use `AGENT_MANAGED` credentials (or no
auth); `STORED` credentials are rejected for agent vantage because values
must never leave the Hub. Credential dependents gains `urlChecks[]`; delete
protection, usage `lastUsedAt` (throttled: write when >1 h stale), revocation,
and list/detail surfaces include check references. Audit `changes` payloads
carry key names only — never values.

Credential **testing**: reuse `testSecrets`/`credential.test` path is
importer-shaped; for checks, testing is implicit — the first probe result is
the truth. No dedicated "test credential" endpoint for checks in v1.

**Rationale**: ADR-107/117 already define the locus rule; key-name mapping is
the smallest contract that supports variable header counts (importer manifest
fixed-secret-keys do not apply — this is not an importer).

**Alternatives**: embed secret values in `authConfig` (rejected — write-only
violation); new credential kind (rejected — unnecessary).

## R7 — Agent execution design

**Decision**: new frame family `url_check.probe` (hub→agent) and
`url_check.probe.result` (agent→hub), correlated by payload `probeId` — the
`credential.test`/`testId` precedent, avoiding the `import_runs`-shaped
`RemoteRunService`. `url_check.probe` payload: `{probeId, url, method,
timeoutMs, authMode, authKeyNames, secretRefMap}` — secret **ref names**
only. Agent resolves refs locally (`resolveRefMap` + agent resolvers),
executes the shared probe, replies `{probeId, outcome, httpStatus?,
durationMs?, errorType?}`. Hub's `AgentSessionService.dispatchUrlCheckProbe`
(pending-map + timeout + `AGENT_OFFLINE` 503, modeled on
`dispatchCredentialTest`) resolves the dispatcher, which writes the
observation. `AGENT_PROTOCOL_VERSION` 3 → 4 (lockstep — hub and agent ship
together).

**Rationale**: probe is not a run — its own correlation id and frame types
keep the session layer's run routing untouched.

**Alternatives**: reuse `job.assign`/`runId` envelope (rejected — `runId`
frames route to the single `RemoteRunService` run-handler and imply
`import_runs` semantics).

## R8 — Permissions, error codes, audit

**Decision**:

- Permissions (rbac.ts `PERMISSIONS`): `urlCheck:create`, `urlCheck:update`,
  `urlCheck:delete` → `EDITOR` (matches `component:*`); `monitoringSetup:update`
  → `EDITOR`; composite create uses `component:create` + `urlCheck:create`.
  Reads: `verifySession` only (GET convention).
- Error codes: `URL_CHECK_NOT_FOUND`, `MONITORING_SETUP_NOT_FOUND` (404),
  `CREDENTIAL_IN_USE` exists for dependent deletes, `AGENT_OFFLINE` exists for
  dispatch. New codes must join `ERROR_CODES`, `ERROR_TYPES`,
  `openapi.yaml Problem.code` enum, and `generate-api-doc.ts CODE_MEANINGS`.
- Audit: `entityType` `"url_check"` (+ `"monitoring_setup"`), actions
  `created|updated|enabled|disabled|deleted`; `namesFor` joins
  `url_checks → component_instances → components` for display names.
  Changes payloads carry no secret material.

**Rationale**: naming follows `resource:action` camelCase convention;
`EDITOR` matches catalog-authoring precedent (`component:*` are EDITOR).

## R9 — Observability

**Decision**: `url_check_probes_total{vantage,outcome,errorType}` counter and
`url_check_probe_duration_seconds{vantage}` histogram (bounded enum labels
only — FR-018). pino structured logs at dispatch/finalize include check id
and outcome; no URLs in metric labels (raw URL permitted in logs — it is
non-secret config — but no credential material ever). No tracing spans for
v1 probes beyond log correlation ids.

**Rationale**: ADR-069 cardinality rule; counters incremented at the same
finalize points as `agent_jobs_total`.

## R10 — Open surfaces closed by new ADR (ADR fidelity rule)

**Decision**: create `researches/adrs/ADR-124-url-check-execution-surfaces.md`
ratifying: `url_check.probe`/`url_check.probe.result` frames + protocol v4
(amends ADR-116), new permission names, new error codes, table columns,
`MISSED` outcome semantics, STORED-vs-AGENT_MANAGED vantage rule, metric
label policy. Index entry in `architecture-decisions.md` + back-pointer
amendment in ADR-116.

**Rationale**: AGENTS.md ADR-fidelity rule — enumerations presented as closed
by ADRs (protocol versions/frames, error codes) must be ratified in ADRs.

## R11 — Frontend structure

**Decision**: Component detail gains a "URL checks" card (checks table +
monitoring-setup summary/editor). Check detail is a nested route
`/components/:slug/checks/:checkId` (metric counter cards, observation strip
sparkline, observation table, edit/delete). Create-with-checks is a full page
`/components/new` (`FormPage` convention) reusing the component-create field
set + instance + repeated check rows + setup defaults. Auth section renders
only when `category === "API"`. No ux-rewrite-gaps flag needed — backend and
UI ship together; `docs/ux.md` gets a note documenting the dedicated check
editor (custom widget exception, already flagged as open decision there).

**Rationale**: card-in-grid matches `component-detail.tsx` structure with the
least surgery; a dedicated page for check detail follows the
`$id.runs.$runId.tsx` nested-route precedent.
