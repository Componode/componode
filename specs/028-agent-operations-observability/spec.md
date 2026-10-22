# Feature Specification: Agent Operations Observability

**Feature Branch**: `028-agent-operations-observability`

**Created**: 2026-10-22

**Status**: Draft

**Input**: User description: "agent-operations-observability"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Operator observes the agent process locally (Priority: P1)

An operator runs the Import Agent container inside their private network.
Today the only signal the agent emits is structured log output on stdout —
there is no way for Docker, Kubernetes, or a monitoring stack to answer
"is the agent process alive, is it connected to the hub, and how much work
has it done" without reading logs. The operator needs a standard,
machine-consumable operations surface on the agent itself: a health probe
orchestrators can consume and metrics a Prometheus-compatible scraper can
collect.

**Why this priority**: The agent is the only Componode component deployed
outside the operator's sightline on the hub side *and* outside the hub's
reach on the agent side — the hub cannot dial in. A remote agent that is
crash-looping, disconnected, or silently doing no work is invisible to both
parties unless the agent itself exposes its state. Process-level health and
metrics are the foundational observability surface every other story builds
on.

**Independent Test**: Deploy the agent container, then query its health and
metrics endpoints directly (or rely on the container runtime's healthcheck
status). Delivers value even if the hub never displays the data: the
operator's own monitoring stack can scrape and alert on it immediately.

**Acceptance Scenarios**:

1. **Given** a running agent container, **When** a container runtime health
   probe executes, **Then** it reports healthy while the process is alive
   and functioning — including during reconnect backoff — without any extra
   configuration.
2. **Given** a running agent, **When** an operator queries its readiness
   surface, **Then** it distinguishes "stream established with the hub"
   from "connecting or in backoff", so a temporary hub outage does not look
   like a dead process.
3. **Given** a running agent, **When** a Prometheus-compatible scraper
   requests its metrics surface, **Then** it receives series covering
   connection state, sessions and reconnects by outcome, jobs received and
   completed by result, assets streamed, remote credential-test dispatches,
   secret-resolution failures (counts only), and process uptime.
4. **Given** the operations listener is disabled or its port is
   unavailable, **When** the agent runs, **Then** enrollment, streaming,
   and job execution continue normally — observability can never take down
   the thing it observes.
5. **Given** the operations surfaces, **When** an operator inspects every
   response, **Then** no secret values, file paths, environment variable
   names, or credential material appear — only state and numeric counters.

---

### User Story 2 - Hub admin sees agent-reported operational state (Priority: P1)

A hub administrator manages Import Agents from the product UI but has no
access to the remote networks the agents run in. When an agent shows
"Connected", the admin cannot tell whether it is actually working — the
connection status only proves a socket exists. The admin needs the agent to
report its own operational state over the existing stream — heartbeat
freshness, uptime, and cumulative work counters — displayed on the agent
record and clearly labeled as agent-reported.

**Why this priority**: This is the product-visible half of the same gap —
equally critical. "Is the remote agent actually alive and doing work" is
the most common operational question a hub admin asks, and today it
requires remote-network access they do not have. The data must come from
the agent itself; the hub can only see connection metadata.

**Independent Test**: Connect an agent, let it process jobs, then open its
detail page and verify reported uptime, heartbeat freshness, and work
counters appear — all deliverable without touching the agent's local
endpoints (US1) since reporting rides the existing stream.

**Acceptance Scenarios**:

1. **Given** a connected agent, **When** the admin opens its detail page,
   **Then** they see how long ago the last heartbeat arrived and can tell
   at a glance whether it is fresher or older than the expected interval.
2. **Given** a connected agent that has run jobs, **When** the admin views
   its reported state, **Then** they see agent-reported uptime, currently
   active jobs, and cumulative counters (jobs by result, assets streamed,
   reconnects since start) labeled as agent-reported.
3. **Given** an agent build that does not report the snapshot, **When** the
   admin views its detail page, **Then** the surfaces degrade to a clear
   "not reported by this agent" state — never blank or misleading data.
4. **Given** a restarted agent, **When** its counters reset to zero,
   **Then** the displayed uptime contextualizes the reset ("since agent
   start"), so counters are never misread as lifetime totals.

---

### User Story 3 - Hub metrics answer remote-execution questions (Priority: P2)

An operator building dashboards and alerts on the hub's metrics endpoint
needs to answer operational questions about remote execution that today's
series cannot: how long runs wait for agent capacity, how long remote jobs
take per agent, and how often sessions drop for infrastructure reasons
versus operator action. The hub's metric series gain the dimensions needed
to answer those questions with standard queries.

**Why this priority**: Valuable but not blocking — the existing series
(`agent_jobs_total`, `agent_sessions_total`, `import_agents_connected`)
already cover counts and outcomes. This story adds the latency and
gap-detection depth needed for SLO-style monitoring and capacity planning.

**Independent Test**: Run remote jobs through a dispatch → complete cycle,
scrape the hub metrics endpoint, and query the new series — fully testable
without any UI or agent-local surface.

**Acceptance Scenarios**:

1. **Given** remote runs that queued before dispatch, **When** they are
   assigned, **Then** a duration series records the wait time per agent so
   "how long do runs wait for capacity" is answerable.
2. **Given** completed remote jobs, **When** metrics are scraped, **Then**
   a duration series records per-agent job time so "how long do remote runs
   take" is answerable.
3. **Given** sessions that ended, **When** metrics are scraped, **Then**
   session-duration and disconnect-reason data distinguish infrastructure
   drops (heartbeat timeout) from deliberate actions (revoked, replaced)
   per agent.
4. **Given** the new series, **When** they are compared to existing agent
   series, **Then** label naming and cardinality follow the same discipline
   — agent name labels, bounded value sets, no per-run cardinality.

---

### User Story 4 - Operator runs monitoring end-to-end from the docs (Priority: P3)

An operator deploying agents in a restricted network follows the
documentation to stand up the full observability path: enable or restrict
the agent's operations listener, wire container healthchecks, scrape
agent-local and hub metrics, and configure basic alerts. The documentation
describes every surface, every configuration field, and the recommended
alerting signals.

**Why this priority**: The feature is only realized when someone can
operate it. Documentation lands last because it describes the settled
behavior of the earlier stories, but it is required for the feature to be
considered complete.

**Independent Test**: Follow the documentation on a fresh deployment to
verify every described surface behaves as written — testable entirely by
reading and exercising the described steps.

**Acceptance Scenarios**:

1. **Given** the agent operations documentation, **When** an operator
   follows it, **Then** they can enable, rebind, or disable the operations
   listener and understand its security posture (unauthenticated,
   internal-only, state-and-counter-only).
2. **Given** the documentation, **When** an operator configures monitoring,
   **Then** they find the full metric catalog, the healthcheck wiring, and
   guidance for scraping an agent inside an egress-only network.
3. **Given** the protocol documentation, **When** a reader inspects the
   agent-reporting section, **Then** the reported payload, cadence, and
   degradation rules match the implementation.

---

### Edge Cases

- What happens when the agent's operations listener port is already in use
  or its bind address is invalid? The agent warns loudly and continues —
  import execution is never blocked by an observability surface.
- What happens when an agent is rebuilt from an older commit without the
  reporting payload? The hub displays "not reported by this agent" rather
  than zeros or stale data (in practice lockstep versioning rebuilds both
  sides together, but reads degrade gracefully).
- What happens when the agent restarts? Process-lifetime counters reset;
  the reported uptime makes the reset window legible, and session history
  on the hub records the disconnect/reconnect pair.
- How is readiness interpreted during a hub outage? The agent is alive but
  not ready — liveness stays healthy (no restart loop), readiness reports
  disconnected until the stream re-establishes.
- What happens when an agent is behind a network its own operator cannot
  scrape directly? Documentation covers co-located scraper and
  port-forwarding patterns; the listener remains a local surface — the hub
  never dials the agent for it.
- What happens if heartbeats report while a session is being closed? The
  hub keeps the freshest snapshot on the agent record; a closing session
  never erases or corrupts the latest-reported state.

## Requirements *(mandatory)*

### Functional Requirements

#### Agent-local operations surface

- **FR-001**: The agent MUST expose an HTTP operations listener offering a
  liveness surface that reports the process as alive and correctly
  configured while it is running — including during reconnect backoff — so
  container runtimes can healthcheck it.
- **FR-002**: The agent MUST expose a readiness surface that distinguishes
  "stream established with the hub" from "enrolled but connecting/backoff",
  so orchestrators and operators can tell a dead process from a
  disconnected one.
- **FR-003**: The agent MUST expose a metrics surface in a
  Prometheus-compatible text format covering at minimum: current connection
  state, sessions and reconnects by outcome, jobs received and completed by
  result, currently active jobs, assets streamed, remote credential-test
  dispatches, secret-resolution failures (counts only), and process uptime.
- **FR-004**: The operations listener MUST be configurable — listen
  address, port, and an off switch — via agent environment configuration,
  enabled by default, and MUST serve only state and counters: no secret
  values, file paths, environment variable names, or request bodies
  accepted.
- **FR-005**: Failure of the operations listener (port in use, bind
  failure, runtime error) MUST be logged as a warning and MUST NOT prevent
  or interrupt enrollment, streaming, or job execution.
- **FR-006**: The agent container image MUST define a healthcheck that
  consumes the liveness surface so `docker`/runtime health status works
  with no extra configuration, while remaining correct when the operator
  disables the listener (documented trade-off).

#### Agent-reported operational state

- **FR-007**: The agent MUST report an operational snapshot to the hub over
  the existing stream on a bounded cadence, carrying: reported-at
  timestamp, process uptime, active job count, and cumulative counters for
  jobs by result, assets streamed, credential-test dispatches, and
  reconnects since process start.
- **FR-008**: The reported payload MUST contain only state and numeric
  fields — no error text, paths, environment names, or any material that
  could carry secret-adjacent content.
- **FR-009**: The hub MUST retain only the latest reported snapshot per
  agent — operational telemetry is read-mostly state, not timeseries —
  alongside the connection/session tracking that already exists.
- **FR-010**: The hub MUST expose each agent's reported snapshot and
  last-heartbeat freshness on the existing agent read surfaces, and the
  agent detail page MUST display them labeled as agent-reported.
- **FR-011**: When an agent has never reported a snapshot (older build,
  never connected), display surfaces MUST show an explicit "not reported"
  state rather than zeros or fabricated values.
- **FR-012**: The reporting mechanism MUST be an additive extension of the
  existing agent stream protocol — no new channel, no inbound connection to
  the agent — consistent with the outbound-only model.

#### Hub-side operational depth

- **FR-013**: The hub metrics endpoint MUST gain series answering: how long
  remote runs wait in queue before dispatch (per agent), how long remote
  jobs execute (per agent), and how sessions end (duration and reason per
  agent) — following the existing series and label discipline.
- **FR-014**: The agents list and agent detail surfaces MUST expose
  last-seen freshness and the most recent disconnect reason so triage of
  an unstable agent does not require paging through connection history.
- **FR-015**: All new read surfaces MUST remain side-effect-free `GET`s,
  authenticated per the existing route rules; the agent's operations
  listener is the documented exception — an unauthenticated,
  network-restricted local surface like the hub's metrics endpoint.
- **FR-016**: `docs/agents.md` MUST gain an operations-observability
  section covering every new surface, configuration field, security
  posture, and scraping guidance for restricted networks;
  `docs/agent-protocol.md` MUST document the reporting payload and
  cadence; `docs/openapi.yaml` MUST reflect any endpoint changes per
  ADR-104.

### Key Entities

- **ImportAgent** (extended): gains a latest-reported operational snapshot
  (uptime, cumulative counters, reported-at) — display-oriented state that
  contextualizes the existing status/last-seen fields.
- **AgentSession** (existing): continues to record connection episodes;
  the live session additionally carries heartbeat freshness used by the
  staleness display.
- **Agent operations listener** (new process surface, not a domain
  entity): the agent-local health/readiness/metrics endpoint set.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A containerized agent reports healthy/unhealthy through the
  container runtime's standard health mechanism with zero additional
  configuration — verified via `docker inspect` or equivalent on a running
  deployment.
- **SC-002**: 100% of the agent's operations responses contain only state
  and numeric fields — inspection finds zero secret values, file paths, or
  environment variable names across the liveness, readiness, and metrics
  surfaces.
- **SC-003**: A hub admin can determine a connected agent's last-heartbeat
  age, reported uptime, and jobs processed using only product UI surfaces —
  no remote-network access or log access required.
- **SC-004**: The agent completes enrollment, streaming, and job execution
  identically with the operations listener enabled, disabled, or bound to
  an unavailable port — zero functional regression attributable to the
  observability surface.
- **SC-005**: The hub metrics endpoint can answer "how long remote runs
  wait for agent capacity" and "how long remote jobs run per agent" via
  standard metrics queries over the new series.
- **SC-006**: Following only the documentation, an operator can go from a
  deployed agent to scraped agent metrics plus a working healthcheck —
  every documented surface behaves as written.

## Assumptions

- The operations listener is enabled by default on a conventional metrics
  port with a configurable bind address; operators in sensitive
  environments can rebind or disable it. Exact names/defaults are
  ratified during planning (the agent's env-var list is an
  ADR-116-enumerated surface — new variables require an amendment).
- Agent-reported counters are process-lifetime values that reset on
  restart; the reported uptime contextualizes resets, and no attempt is
  made to stitch counters across restarts (the hub's own series already
  record per-session and per-job history).
- The reporting cadence rides the existing heartbeat interval (~30 s) —
  frequent enough for freshness display without new traffic volume; the
  snapshot replaces on write rather than accumulating history in the
  database.
- Lockstep versioning means hub and agent are built from the same commit,
  so protocol changes ship on both sides together; the "not reported"
  degradation exists for reads of historical or anomalous records.
- Non-goals carried forward from the Import Agents research: no agent log
  shipping to the hub, no alerting engine in the product, no agent-side
  trace export, and no hub-initiated connections to the agent — the
  operations listener is a local surface and the reporting rides the
  agent's own outbound stream.
- `agent_sessions` retention remains unchanged — operational tables grow
  per existing policy; retention tooling is out of scope.
