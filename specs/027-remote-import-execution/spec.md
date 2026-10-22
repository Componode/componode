# Feature Specification: Remote Import Execution

**Feature Branch**: `feature/027-remote-import-execution`

**Created**: 2026-10-22

**Status**: Draft

**Input**: User description: "remote-import-execution — third spec of the
remote Import Agents work. Decisions ratified in
`researches/adrs/ADR-116-remote-import-agents.md`,
`researches/adrs/ADR-117-agent-managed-credentials.md`, and
`researches/remote-import-agents_research.md` §3–4, §8, §10–11. This spec
delivers config↔agent binding (the Execution selector), remote run dispatch
and execution over the agent stream (`job.assign`/`job.ack`/`asset.batch`/
`phase`/`run.complete`/`run.error`/`cancel`), session-bound failure
semantics, capability enforcement, and executor visibility — completing the
remote execution path."

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Admin binds an importer config to an agent (Priority: P1)

A catalog administrator editing an importer config sees a framework-level
**Execution** selector: `This hub (in-process)` (the default, unchanged) or a
named Import Agent. Selecting an agent filters the credential selector to
agent-managed credentials, flips helper copy to "Resolved on the agent",
warns inline when the agent is offline, and disables agents whose allowed
importers do not cover the config's importer. Saving a bound config persists
the binding; switching back to in-process clears it. Mismatched bindings —
an agent whose allowed set excludes the importer, a revoked agent, or
credentials of the wrong kind for the selected executor — are rejected at
save with a clear error.

**Why this priority**: Binding is the entry point to remote execution —
nothing can dispatch until a config names its executor. It is also where
every wrong-configuration class (capability mismatch, credential-kind
mismatch, dead executor) must be caught before a run ever starts.

**Independent Test**: Create an agent, open an importer config, bind it to
the agent, and save; verify the config card shows the executor. Attempt
each invalid binding (disallowed importer, revoked agent, stored credential
on an agent-bound config) and verify save-time rejection naming the
problem.

**Acceptance Scenarios**:

1. **Given** a connected agent `eu-k8s-prod` and an unbound kubernetes
   importer config, **When** the admin selects `Agent: eu-k8s-prod` in the
   Execution selector and saves, **Then** the config persists the binding
   and the credential choices offered are agent-managed only.
2. **Given** an agent whose allowed importers exclude the config's
   importer, **When** the admin attempts to bind it, **Then** the save is
   rejected with an incompatible-executor error naming the agent and
   importer.
3. **Given** a revoked agent, **When** an admin attempts to bind a config
   to it, **Then** the save is rejected — a credential-dead agent cannot
   accept work.
4. **Given** a bound config, **When** the admin switches Execution back to
   `This hub`, **Then** the binding clears and the credential selector
   returns to stored credentials.
5. **Given** an agent-bound config, **When** an admin links a stored
   credential, **Then** the save is rejected with a kind-mismatch error
   (spec-026 rule applied through the product surface).

---

### User Story 2 - A bound config's run executes on the remote agent (Priority: P1)

When a run starts on an agent-bound config — manually or from its schedule —
the run records which agent will execute it and waits for that agent to have
spare capacity. The hub assigns the job to the agent over the existing
stream; the agent accepts, resolves the config's agent-managed credential
references against its own environment, runs the importer against sources
the hub cannot reach, and streams discovered assets back in bounded batches.
The hub validates, upserts, reconciles, and stages edge suggestions exactly
as it does for in-process runs — the catalog outcome is indistinguishable
from a local run.

**Why this priority**: This is the feature. The entire agent program exists
so that a run can execute inside a restricted network while the hub keeps
ownership of validation and reconciliation.

**Independent Test**: Bind a config to a connected agent running against a
fixture source unreachable from the hub, trigger a run, and verify the run
completes with the same upsert/reconciliation/suggestion outcomes as an
equivalent in-process run — and that the run record names the agent.

**Acceptance Scenarios**:

1. **Given** a config bound to a connected agent with free capacity,
   **When** a run starts, **Then** the run is dispatched, the agent
   acknowledges, the run transitions to running, and the detail view shows
   the executing agent.
2. **Given** a remote run in progress, **When** the importer yields assets,
   **Then** they arrive in bounded batches and are validated and upserted
   through the identical hub-side path used by in-process runs — including
   invalid assets surfacing as per-asset errors rather than being filtered
   agent-side.
3. **Given** a remote run that finishes, **When** completion arrives,
   **Then** reconciliation, retired-component handling, and edge-suggestion
   staging run unchanged, and the run record carries the executing agent's
   identity.
4. **Given** a config bound to an agent at full job capacity, **When** a
   second run starts, **Then** it waits pending until capacity frees or the
   dispatch bound elapses.
5. **Given** a bound config on a schedule, **When** the schedule fires,
   **Then** the run dispatches to the bound agent exactly as a manual run
   does — scheduling stays hub-side.
6. **Given** a remote run, **When** its assignment is delivered, **Then**
   the payload carries the importer name, run scope, and credential
   *reference* maps — no secret values ever cross the channel in either
   direction.

---

### User Story 3 - Failures are named, bounded, and never silent (Priority: P1)

Every way a remote run can fail has a defined outcome the admin can act on:
a bound agent that is offline or busy fails the run after a bounded wait
with an agent-unavailable error; an agent that refuses the job fails it with
an incompatible-executor error echoing the agent's reason; a dropped
connection fails all of that agent's in-flight runs with an agent-lost
error while the agent aborts its local work; a single asset too large for a
frame becomes a per-asset error while the run continues. A run is never
left pending or running forever.

**Why this priority**: Remote execution adds a network to the run's
lifeline. Without ratified, bounded failure semantics, remote runs would be
strictly less reliable than in-process ones — and silent hangs would erode
trust in the whole feature.

**Independent Test**: Start runs against an offline agent, an agent that
rejects the job, and an agent killed mid-run; verify each reaches a
terminal state with the correct named error in bounded time, and that
agent-side work is aborted on disconnect.

**Acceptance Scenarios**:

1. **Given** a run started on a config bound to an offline agent, **When**
   the dispatch bound (~10 minutes by default) elapses without capacity,
   **Then** the run fails with an agent-unavailable error — it does not
   wait forever.
2. **Given** an agent-bound run dispatched and acknowledged, **When** the
   agent's connection drops, **Then** the run fails with an agent-lost
   error within the stale-connection window and the agent aborts its local
   job; reconnecting does not resume it.
3. **Given** an agent that cannot accept a job (importer not compiled or
   version-mismatched at the agent's own check), **When** it answers the
   assignment, **Then** the run fails with an incompatible-executor error
   carrying the agent's reason.
4. **Given** a remote run where one asset exceeds the frame limit, **When**
   the agent encounters it, **Then** that asset becomes a per-asset
   too-large error on the run and remaining assets continue streaming.
5. **Given** an assignment the agent never acknowledges, **When** a bounded
   acknowledgment wait elapses, **Then** the run fails rather than hanging
   between dispatch and running.
6. **Given** in-flight remote runs when the hub restarts, **When** the hub
   comes back, **Then** those runs are failed agent-lost on boot — the
   session that owned them is gone.

---

### User Story 4 - Admin cancels a remote run (Priority: P2)

Cancelling a remote run works exactly like cancelling an in-process run from
the admin's side: the same action, the same requested state. Hub-side, the
cancel request is recorded as today and additionally signaled to the agent,
which aborts the importer's cancellation token; the run reaches cancelled
when the agent confirms. If the agent is already gone, the disconnect path
resolves the run instead.

**Why this priority**: Cancellation is the run-control guarantee. A run
the admin cannot stop — executing inside a network they cannot reach — is
an operational liability.

**Independent Test**: Start a remote run against a slow fixture importer,
cancel it mid-stream, and verify the run reaches cancelled, the agent's
local job aborts, and no further assets are processed.

**Acceptance Scenarios**:

1. **Given** a running remote run, **When** the admin cancels, **Then** the
   cancel signal reaches the agent over the stream, the agent aborts the
   job, and the run reaches cancelled.
2. **Given** a pending remote run still waiting for capacity, **When** the
   admin cancels, **Then** the run is cancelled without ever being
   dispatched.
3. **Given** a cancelled remote run, **When** the agent had already
   buffered assets, **Then** late-arriving batches for the dead run are
   discarded.
4. **Given** a cancel requested on a run whose agent disconnects before
   confirming, **When** the disconnect resolves, **Then** the run is failed
   agent-lost rather than left in a cancelling limbo.

---

### User Story 5 - Admins can see where runs execute (Priority: P2)

Where a run executes is visible everywhere runs surface: the run detail
header shows "Ran on agent `<name>`" (or "In-process"), a pending remote
run shows "Waiting for agent `<name>`", config cards show "Runs on:
`<agent>`" with a warning when that agent is offline, the agent detail page
lists its in-flight jobs and recent runs, and the dashboard's attention
items flag an offline agent that still has bound configs.

**Why this priority**: Executor attribution is how admins debug remote runs
and notice a dead executor before a scheduled run fails on it. Without
surfaces, remote execution is invisible until something breaks.

**Independent Test**: With a bound config and its agent in connected,
offline, and busy states, verify the executor is named on the run detail,
the config card, the agent's run list, and the dashboard attention item —
without opening agent host logs.

**Acceptance Scenarios**:

1. **Given** a completed remote run, **When** the admin opens its detail,
   **Then** the header names the executing agent; a non-admin sees the name
   as plain text.
2. **Given** a remote run waiting for capacity, **When** viewed in run
   lists or detail, **Then** it displays as waiting for the named agent.
3. **Given** an offline agent with bound configs, **When** the admin views
   the dashboard, **Then** an attention item flags the offline agent and
   its bound configs.
4. **Given** a connected agent executing jobs, **When** the admin opens the
   agent detail, **Then** in-flight jobs appear with run identity, config,
   phase, and elapsed time; the agent's run history tab lists recent runs
   executed there.

---

### User Story 6 - Capability policy stays honest over time (Priority: P3)

An agent's allowed-importers set is hub policy enforced continuously, not
just at binding time: when an admin narrows an agent's allowed set, or a
reconnecting agent advertises a different compiled set, configs bound to
that agent whose importer is no longer covered are flagged on the config
card and agent detail — and their next runs fail fast instead of
dispatching work the agent cannot or may not run.

**Why this priority**: Policy drift is inevitable (admin edits, rebuilt
images). Catching it at flag-and-fail-fast time keeps a stale binding from
becoming a confusing midnight dispatch failure.

**Independent Test**: Bind a config to an agent, then narrow the agent's
allowed importers to exclude it; verify the config is flagged and its next
run fails fast with the incompatible-executor error.

**Acceptance Scenarios**:

1. **Given** a bound config whose agent's allowed importers are narrowed to
   exclude the config's importer, **When** the edit saves, **Then** the
   config is flagged in the UI and its next run fails fast with the
   incompatible-executor error.
2. **Given** an in-flight run when the agent's allowed set is edited,
   **Then** the in-flight run is unaffected — enforcement applies to new
   dispatches.
3. **Given** a revoked agent still referenced by configs, **When** runs
   start on those configs, **Then** they fail fast as unavailable rather
   than waiting out the dispatch bound for a credential that can never
   connect.

---

### Edge Cases

- Bound agent has never connected → the run waits pending, then fails
  agent-unavailable at the dispatch bound.
- Agent at capacity → pending runs queue; each dispatches when a slot frees
  or fails at its own dispatch bound.
- Disconnect between assignment and acknowledgment → the run fails
  agent-lost; the agent discards the unacknowledged job on reconnect.
- Agent sends frames for a run the hub already considers finished (late
  batches after cancel or disconnect) → discarded, never resurrected.
- Config rebound to a different agent (or back to in-process) while a run
  is in flight → the in-flight run keeps its original executor attribution;
  the new binding applies to subsequent runs.
- Two configs bound to the same agent → they share its advertised job
  capacity; the agent never receives more concurrent jobs than it declared.
- Agent resolves a credential reference that no longer exists on its host →
  the run fails naming the key and source, never a value (spec-026
  resolver semantics applied at run start).
- Malformed or protocol-violating frames mid-run (unknown run id,
  out-of-order completion, oversized batch envelope) → rejected
  fail-closed; a session that cannot be trusted is closed and its runs
  resolve through the disconnect path.
- Hub shutdown while remote runs are in flight → sessions close with the
  shutdown reason; runs are failed agent-lost on the next boot.
- Non-admin views a run or config with an executor → the agent name is
  plain text, not a link to the admin surface.

## Requirements _(mandatory)_

### Functional Requirements

#### Binding & capability policy

- **FR-001**: Importer configs MUST gain an executor selection — `This hub
  (in-process)` (default, behavior unchanged) or a named Import Agent —
  persisted on the existing `importer_configs.agentId` column. Rebinding to
  another agent and unbinding back to in-process MUST both be supported.
- **FR-002**: Saving a bound config MUST reject a binding whose target
  agent's allowed importers do not cover the config's importer, and MUST
  reject binding to a revoked agent — each with a clear, actionable error.
- **FR-003**: Changing a config's executor MUST re-validate its linked
  credentials against the spec-026 kind rules: an agent-bound config
  requires agent-managed credentials; an in-process config requires stored
  credentials.
- **FR-004**: The Execution selector MUST disable agents whose allowed set
  does not cover the config's importer, MUST warn inline when the selected
  agent is offline, and MUST disable the agent option entirely (with a
  pointer to agent management) when no agents exist.
- **FR-005**: When an agent's allowed importers change or its advertised
  compiled set drifts, the system MUST re-evaluate configs bound to it,
  flag incompatible bindings on the config card and agent detail, and fail
  their subsequent runs fast at dispatch.
- **FR-006**: Runs on configs bound to a revoked agent MUST fail fast as
  unavailable rather than consuming the dispatch wait.

#### Dispatch & remote run lifecycle

- **FR-007**: Starting a run on an agent-bound config MUST create the run
  in a pending state stamped with the target agent (`import_runs.agentId`),
  identical for manual and scheduled triggers — scheduling remains
  hub-side.
- **FR-008**: The hub MUST dispatch the job to the bound agent over the
  agent stream only when the agent is connected and has spare advertised
  capacity (`maxConcurrentJobs`); a run that cannot be dispatched within a
  bounded wait (~10 minutes, hub-configurable) MUST fail with
  `AGENT_UNAVAILABLE`.
- **FR-009**: A job assignment MUST carry the run identity, importer name,
  run scope, and the merged secret *reference* maps of the config's
  agent-managed credentials — never secret values. The agent MUST resolve
  references locally at run start (spec-026 resolver); a resolution failure
  MUST fail the run naming the key and source, never a value.
- **FR-010**: Agent acknowledgment transitions the run to running; an agent
  refusal MUST fail the run with `AGENT_INCOMPATIBLE` echoing the agent's
  reason. The acknowledgment wait MUST be bounded — an unacknowledged
  assignment fails rather than hanging.
- **FR-011**: The agent MUST execute the importer through the unchanged
  `AsyncGenerator<DiscoveredAsset>` contract and MUST forward every yielded
  asset to the hub, including invalid ones — agent-side filtering is
  forbidden; hub validation remains the contract boundary.
- **FR-012**: Asset batches MUST respect the frame bound (~100 assets or
  ~1 MB); a single asset exceeding it MUST surface as a per-asset
  `ASSET_TOO_LARGE` error while the run continues.
- **FR-013**: Streamed assets MUST flow through the identical
  validation/upsert path as in-process runs; progress phases, per-asset
  errors, and completion MUST drive the same run-record transitions;
  reconciliation, retired-component handling, and edge-suggestion staging
  MUST run unchanged at completion.
- **FR-014**: The agent session is the run's lifeline — on disconnect or
  heartbeat timeout, all in-flight runs on that agent MUST fail with
  `AGENT_LOST` and the agent MUST abort its local jobs. There is no
  resume-on-reconnect in v1.
- **FR-015**: On hub startup, remote runs left in a non-terminal state by a
  previous shutdown MUST be failed `AGENT_LOST` — no run may appear running
  without a live session.
- **FR-016**: Cancelling a remote run MUST record the hub-side cancel
  request as today and signal the agent over the stream; the agent MUST
  abort the job's cancellation token and the run MUST reach cancelled on
  agent confirmation. A pending (undispatched) remote run MUST cancel
  immediately without dispatch. Frames arriving for a dead run MUST be
  discarded.
- **FR-017**: The hub MUST never assign an agent more concurrent jobs than
  its advertised `maxConcurrentJobs`, and MUST only dispatch jobs for
  importers in the agent's allowed set.

#### Observability & visibility

- **FR-018**: Every run record MUST carry its executor; run detail MUST
  display "Ran on agent `<name>`" or "In-process", and a pending remote run
  MUST display "Waiting for agent `<name>`".
- **FR-019**: The agent detail page MUST expose the agent's in-flight jobs
  (run, config, phase, elapsed) from hub dispatch state and a run history
  of runs executed on it; the agents list MUST show a running-count.
- **FR-020**: Config cards MUST show their bound executor ("Runs on:
  `<agent>`") with a warning indicator when that agent is offline or the
  binding is flagged incompatible.
- **FR-021**: The dashboard attention items MUST include *offline agent
  with bound configs*.
- **FR-022**: Metrics MUST include `agent_jobs_total{agent,result}` and
  `agent_assets_received_total{agent,importer}` following existing series
  discipline; `runId` MUST remain the end-to-end correlation key between
  hub run rows and agent logs.
- **FR-023**: Agent names MUST render as plain text (no links) on surfaces
  visible to users without agent-management permission.

#### Protocol, errors & docs

- **FR-024**: The run-execution frames (`job.assign`, `job.ack`,
  `asset.batch`, `phase`, `run.complete`, `run.error`, `cancel`) MUST be
  activated in the shared protocol contract and fully documented —
  payloads, ordering, and failure semantics — in `docs/agent-protocol.md`.
- **FR-025**: `ERROR_CODES` MUST gain `AGENT_LOST`, `AGENT_UNAVAILABLE`,
  `AGENT_INCOMPATIBLE`, and `ASSET_TOO_LARGE` (`AGENT_OFFLINE` already
  landed in 026), ratified in the same change per ADR-fidelity rules.
- **FR-026**: `docs/openapi.yaml` MUST be updated for every new or changed
  endpoint per ADR-104; `docs/agents.md` MUST document remote run execution
  (capacity, dispatch bound, failure behavior); `docs/ux.md` and
  `CONTEXT.md` are updated in the same change where their surfaces change.

### Key Entities

- **ImporterConfig** (extended): gains an executor — `agentId` null means
  in-process (default); set means the run executes on that Import Agent.
  Credential linkage unchanged; kind rules bind to the selected executor.
- **ImportRun** (extended): gains `agentId` recording the executing agent
  (independent of later config rebinding); remote runs pass through pending
  → running → terminal exactly as in-process runs do.
- **Job assignment**: the hub→agent dispatch unit — run identity, importer,
  scope, and credential reference maps — acknowledged or refused by the
  agent.
- **ImportAgent** (existing, spec 025): now an execution resource — its
  advertised `maxConcurrentJobs` caps dispatched work; its
  `allowedImporters` policy is enforced at binding and at dispatch.
- **AgentSession** (existing, spec 025): the lifeline of every run it
  carries — session loss fails its in-flight runs.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: A remote run on a bound config produces catalog outcomes
  identical to the same importer run in-process — same upserts, same
  reconciliation, same per-asset errors, same staged suggestions (verified
  by a parity exercise on a fixture source).
- **SC-002**: Zero secret values transit the hub↔agent channel during
  dispatch or execution — inspection of every frame finds reference names
  only.
- **SC-003**: 100% of remote runs reach a terminal state in bounded time —
  including agent-offline, at-capacity, refused, disconnected, cancelled,
  and hub-restart scenarios; zero runs remain pending or running
  indefinitely.
- **SC-004**: 100% of invalid bindings (capability-uncovered importer,
  revoked agent, wrong credential kind) are rejected at save with an
  actionable message.
- **SC-005**: A disconnected agent's in-flight runs fail within the
  stale-connection window and the agent aborts its local jobs — confirmed
  on both sides.
- **SC-006**: An admin can identify which executor ran any run and why a
  pending run is waiting using only product UI surfaces — no log access
  required.
- **SC-007**: A cancellation requested on a running remote run aborts
  agent-side work and reaches the cancelled state within a bounded window
  on a healthy connection.

## Assumptions

- Pending remote runs on one agent dispatch in run-creation order as
  capacity frees (FIFO is a reasonable default, not a contract).
- The dispatch bound defaults to ~10 minutes and is hub-configurable; the
  acknowledgment bound is a short protocol constant. Ratified values live
  in `docs/agent-protocol.md`.
- `import_runs.agentId` ships in this spec's migration — deferred from 025
  per ADR-116 Amendment 1; `importer_configs.agentId` already exists.
- No resume-on-reconnect (ratified, ADR-116); agent pools, label
  scheduling, log streaming, standalone binaries, mTLS, long-poll, and
  external secret-manager references remain non-goals per research §12.
- The spec-026 dispatch infrastructure (pending-request map over the agent
  stream) and the agent-side secret resolver are the substrate job
  execution builds on.
- The agent-side job-accept check covers compiled-set and version only —
  the agent holds no allowlist policy; `allowedImporters` is enforced
  exclusively hub-side (ADR-116 item 13).
- Importer `ctx.logger` output stays agent-local; the hub receives
  structured events only — no log shipping in v1.
