### ADR-116 — Remote import execution via outbound Import Agents

> **Status:** Ratified

**Context**: Importers execute in-process inside the `app` container, which
requires the hub to reach every discovery source (cloud control planes,
Kubernetes API servers, internal endpoints). Deployments with restricted
inbound networks, private cloud endpoints, or egress-only corporate zones
make that impossible: the hub cannot reach the source, but a process *inside*
that network can — and can make outbound connections. The model is the
established outbound-agent pattern (GitHub Actions self-hosted runners, Azure
DevOps agents). See `researches/remote-import-agents_research.md` for the
full proposal.

**Decision**:

1. **Import Agent entity.** A first-class `import_agents` table (UUID v7 id,
   name, status, agentVersion, protocolVersion, importerVersions, hashed
   credential, lastSeenAt, timestamps). "Import Agent" is the canonical
   domain term — recorded in `CONTEXT.md`.

2. **Dumb, stateless agent.** The agent runs the existing importer packages
   and streams `DiscoveredAsset` batches to the hub; it persists only
   `{hubUrl, agentToken, name}` — no configs, no run state, no asset cache.
   The hub retains validation (`validateDiscoveredAsset`), upsert,
   reconciliation, run history, and edge suggestions unchanged. The
   `AsyncGenerator<DiscoveredAsset>` contract (ADR-056/057) is the wire
   boundary; agents forward *every* yielded asset, including invalid ones.

3. **Outbound-only WebSocket.** The agent initiates all connections; the hub
   never dials the agent. A single `wss://` channel at
   `GET /api/v1/agent/stream` carries control *and* data: framed JSON
   envelopes `{type, runId?, payload}` — `hello`, `job.assign`, `job.ack`,
   `asset.batch` (≤ ~100 assets or ~1 MB/frame), `phase`, `run.complete`,
   `run.error`, `cancel`, `heartbeat` (~30 s), `credential.test` /
   `credential.test.result`. No separate ingest endpoint. Protocol types and
   Zod schemas live in `packages/core` (`contracts/agent-protocol.ts`);
   message-level spec in `docs/agent-protocol.md`; route registered in
   `docs/openapi.yaml` per ADR-104.

4. **Opt-in per config.** `importer_configs.agentId` nullable FK binds a
   config to a named agent; null = in-process execution (the default,
   unchanged). No label pools or any-agent scheduling in v1.

5. **Dispatch & lifecycle.** `startRun` on a bound config inserts `PENDING`
   and stamps `import_runs.agentId`; the run waits for agent capacity
   (`maxConcurrentJobs` advertised in `hello`, default 1) up to a dispatch
   timeout (~10 min, configurable) → `FAILED`/`AGENT_UNAVAILABLE`. Cancel
   propagates via `cancelRequestedAt` **plus** a `cancel` frame to the
   agent's `AbortController`.

6. **Session-bound runs.** The WebSocket session is the run's lifeline:
   disconnect → in-flight runs `FAILED` (`AGENT_LOST`) and the agent aborts
   its local jobs. No resume-on-reconnect — the generator is not
   checkpointed; resumable remote runs are deferred (needs a seq-cursor
   protocol).

7. **Version lockstep.** `hello` carries `{protocolVersion, agentVersion,
   importers: [{name, version}]}`; the hub rejects mismatched protocol or
   importer versions. Parity is a monorepo build-time property, not runtime
   negotiation.

8. **Enrollment & authentication.** Admin creates the agent record →
   single-use enrollment token (~24 h TTL) → exchanged on first connect for
   a durable bearer credential (shown once, stored hashed). Rotation issues
   a new enrollment token on the same record; revocation kills the
   credential and drops the session. The stream route uses dedicated
   agent-token middleware — an amendment to ADR-097's session-auth rule.
   TLS mandatory (`wss://`); plaintext WS allowed only for `localhost`
   loopback; `CA_BUNDLE` env supports internal CAs; no insecure-skip-verify.
   The agent token is itself a secret — `AGENT_TOKEN_FILE` (mounted token
   file via the platform's secret mechanism) is the documented-preferred
   delivery over the `AGENT_TOKEN` env var; docs treat token and importer
   secrets with uniform protection guidance.

9. **Packaging.** New workspace package `packages/agent` (thin host)
   depending on `core` + all importer packages — an amendment to ADR-065.
   `importer-registry.ts` moves into `packages/core`, shared by backend and
   agent. Single published `componode-agent` image configured by env
   (`HUB_URL`, `AGENT_TOKEN`/`AGENT_TOKEN_FILE`, `SECRETS_DIR`, `CA_BUNDLE`,
   `MAX_JOBS`, `HTTPS_PROXY`/`NO_PROXY`); container only, no standalone
   binary in v1.

10. **Observability.** Importer logger output stays agent-local; the hub
    receives structured events (phases, per-asset errors, warnings,
    completion). New error codes in core: `AGENT_LOST`, `AGENT_UNAVAILABLE`,
    `AGENT_OFFLINE`, `ASSET_TOO_LARGE`.

11. **UX surface.** `/agents` + `/agents/:id` under the **Admin** sidebar
    section — standard list + detail templates. Enrollment is a show-once
    dialog carrying the token plus a copy-ready `docker run` install
    snippet. The importer-config form gains a framework-level **Execution**
    selector (`This hub` | named agent) that filters credentials to
    `AGENT_MANAGED` and warns when the agent is offline; the credential form
    gains a matching `Resolved on an Import Agent` mode. Executor is
    visible on run detail, config cards, and (as an attention item, when
    offline with bound configs) the dashboard. Lifecycle actions: Rotate
    token / Revoke / Delete — delete blocked while configs are bound.
    Agent status badges (`Connected`/`Offline`/`Never connected`) follow the
    existing status color map; freshness via query polling, no frontend
    WebSocket. `docs/ux.md` is updated in the same change (ADR-103).
    Detailed UX decisions: research doc §8.2.

12. **Audit & traceability.** Agent lifecycle events
    (`created`/`enrolled`/`token_rotated`/`revoked`/`deleted`/
    `credential_test_dispatched`) are audited in `entity_changes`
    (`entityType: "import_agent"`) — admin actor for management actions,
    `agent:<name>` for agent-originated events. Connection history lives in
    an operational `agent_sessions` table (connectedAt/disconnectedAt,
    disconnectReason, remoteAddress, versions) — high-frequency reconnects
    must never flood append-only audit. Rejected upgrades (bad/revoked
    token, version mismatch) log + count metrics only — unauthenticated
    traffic never writes audit rows. `runId` is the end-to-end correlation
    key (hub run row ↔ agent stdout); `import_runs.agentId` is the executor
    record. New Prometheus series: `import_agents_connected`,
    `agent_jobs_total`, `agent_sessions_total`,
    `agent_assets_received_total`. Detail: research doc §11.

13. **Hub-managed capability model.** `import_agents.allowedImporters`
    (jsonb; empty = all) is set in the admin portal per agent — *not* an
    agent env var: which importers an agent may run is hub policy, not the
    remote host operator's decision. The hub enforces it at dispatch
    (`job.assign` only for allowed importers), at binding (save-time
    `AGENT_INCOMPATIBLE`), and on drift (admin edits or version changes
    re-validate bound configs; flagged in UI). `hello` advertises the
    *compiled* importer set + versions for version matching only; the
    agent's job-accept check covers compiled-set + version — it holds no
    allowlist policy. Agent-side config is environment variables only
    (plumbing: `HUB_URL`, `AGENT_TOKEN`, `SECRETS_DIR`, `CA_BUNDLE`,
    `MAX_JOBS`, `HTTPS_PROXY`/`NO_PROXY`) with no per-importer tuning —
    importer behavior config lives solely in `config.scope`.

**Amendments to earlier ADRs**:

- **ADR-022** — importer execution gains a remote path beside scheduled +
  on-demand in-process execution; scheduling stays hub-side.
- **ADR-055** — secret resolution may occur agent-side when a config's
  credentials are `AGENT_MANAGED` (ADR-117); the resolver interface is
  unchanged.
- **ADR-058** — cancellation extends across the process boundary via the
  `cancel` frame; hub `cancelRequestedAt` remains the source of truth.
- **ADR-060/061** — run coordination gains an agent-capacity dimension;
  `maxConcurrentJobs` on the agent replaces `IMPORTER_MAX_CONCURRENCY` for
  remote runs.
- **ADR-052** — the three-tier audit model gains the `import_agent` entity
  type for lifecycle transitions; high-frequency connection events are
  recorded in the operational `agent_sessions` table instead — the same
  "consequential transitions audited, routine noise is not" asymmetry.
- **ADR-054** — RBAC matrix gains the `agent:read|create|update|delete`
  permission set (admin default), governing `/api/v1/agents[...]`.
- **ADR-100** — `agent_sessions` is explicitly outside the append-only
  trigger protection: it is operational telemetry, not an audit guarantee.
- **ADR-065** — `packages/agent` joins backend as a permitted importer
  aggregator (manifest import only); `importer-registry` moves to core.
- **ADR-097** — `/api/v1/agent/stream` is authenticated by agent bearer
  credential middleware, not `verifySession`; added to the exception list.
- **ADR-107** — `credentials` gains `kind` (`STORED` | `AGENT_MANAGED`) +
  `secretRefMap` (see ADR-117).

**Rationale**: Pull-model importers plus an outbound-only agent solve the
unreachable-source problem without relaxing the network's security posture —
no inbound holes, no VPN requirement. Keeping the agent dumb preserves every
hub-side invariant (ADR-035–038, 113) and makes the `Importer` contract the
single seam; the agent is plumbing, not policy. Session-bound runs and
lockstep versioning deliberately trade availability features (resume,
mixed-version fleets) for a v1 protocol that is small enough to get right.

**Alternatives considered**:

- **Hub-initiated inbound connection** — impossible in the stated scenarios
  (no ingress); rejected.
- **Hub pushes decrypted secrets to the agent** — moves plaintext across the
  trust boundary and expands compromise blast radius; rejected in favor of
  agent-local resolution (ADR-117).
- **Long-poll instead of WebSocket** — survives WS-hostile proxies but adds
  latency to every control message and complicates heartbeat/cancel;
  documented as a future fallback.
- **Resume-on-reconnect via seq cursors** — real protocol complexity for a
  retryable failure mode; deferred.
- **Per-importer agent images** — same code with different flags; no benefit
  over one image.

## Amendment 1 — Foundation-slice implementation refinements (2026-10-21, spec 025)

Refinements ratified during `025-import-agents-foundation` planning; each
extends a surface this ADR defined without changing its intent:

- **Enrollment exchange mechanism.** The enrollment token → durable
  credential exchange happens on a dedicated public endpoint
  `POST /api/v1/agent/enroll` (`{token}` → `{agentToken, agentId, name}`),
  not inside the WS handshake. The stream route's middleware therefore
  validates exactly one credential kind, and single-use semantics
  (`enrollmentTokenUsedAt`) live in one transactional write.
- **Agent env list extended.** In addition to the list in item 9:
  `AGENT_ENROLLMENT_TOKEN` / `AGENT_ENROLLMENT_TOKEN_FILE` (first-boot
  enrollment material, distinct from the durable credential) and
  `AGENT_STATE_DIR` — the writable dir where the exchanged credential is
  persisted (`agent-token`, mode 0600). Persistence is mandatory: a
  single-use token cannot be re-exchanged, so an agent that cannot write
  its state dir fails at startup with a clear error rather than losing
  its identity on restart.
- **`disconnectReason` gains `superseded`.** A second connect with the
  same credential closes the incumbent session with reason `superseded`
  (single-active-session edge case); the four values in item 12 were not
  exhaustive.
- **Schema sequencing.** `importer_configs.agentId` (nullable FK,
  `ON DELETE RESTRICT`) ships with the foundation migration — the delete
  block gets its guarantee from the FK itself, matching the
  `CREDENTIAL_IN_USE` precedent — while `import_runs.agentId` ships with
  the execution spec that writes it. The *ability to bind* still arrives
  in 027.
- **Management error codes.** `ERROR_CODES` gains `AGENT_NOT_FOUND`,
  `AGENT_NAME_TAKEN`, `AGENT_IN_USE`, `AGENT_ENROLLMENT_INVALID`,
  `AGENT_CREDENTIAL_INVALID`, `AGENT_VERSION_MISMATCH` in 025; the
  execution codes (`AGENT_LOST`, `AGENT_UNAVAILABLE`, `AGENT_OFFLINE`,
  `AGENT_INCOMPATIBLE`, `ASSET_TOO_LARGE`) land with 026/027.
- **Amends ADR-087**: routes under `/api/v1/agent/` are exempt from
  double-submit CSRF — they authenticate by bearer credential, never by
  the session cookie the check exists to protect (see ADR-087
  Amendment 2).
- **Credential rotation clears revocation.** `POST
  /api/v1/agents/{id}/enroll` (rotate) issues a new enrollment token on
  the same identity and clears `revokedAt` — rotation is how a revoked
  agent identity is re-enabled; the superseded credential stays dead.
- **Rotation is a graceful overlap.** The previous durable credential
  remains valid until the new enrollment token is *exchanged* — rotation
  alone never drops a live session; the exchange replaces
  `credentialHash` and closes any session running under the old
  credential with `disconnectReason: "replaced"`.
- **`disconnectReason` gains `replaced`.** `superseded` means a second
  connection arrived reusing the *same* credential (single-active-session
  rule); `replaced` means the credential itself was superseded by a
  rotation exchange. The `close` wire enum already carried both values —
  this records the reason on `agent_sessions` with the same distinction.

## Amendment 2 — Remote-execution surfaces ratified (spec 027)

The execution slice activates the wire frames item 3 reserved and fills in
surfaces the foundation deferred; each extends a surface this ADR defined
without changing its intent:

- **Job frame payloads are now strict Zod schemas** in
  `contracts/agent-protocol.ts` (replacing the `FUTURE_AGENT_MESSAGE_TYPES`
  placeholder): `job.assign{importerName,scope,secretRefMap?}`,
  `job.ack{accepted,reason?}`, `asset.batch{assets[]}` (≤100 assets or
  ~1 MB per frame), `phase{name≤200}`, `run.error{assetExternalId?,
  errorType,errorMessage}`, `run.complete{result:COMPLETED|CANCELLED|FAILED,
  errorType?,errorMessage?}`, `cancel{runId}`. `runId` in the envelope is
  required on every job frame and is the correlation key (item 12).
- **Two new hub env tunables** join the item-5 dispatch lifecycle:
  `AGENT_DISPATCH_TIMEOUT_MS` (default 600 000 — the "~10 min dispatch
  timeout" is now named and bounded) and `AGENT_JOB_ACK_TIMEOUT_MS`
  (default 15 000 — a dispatched-but-unacknowledged job fails
  `AGENT_UNAVAILABLE`, freeing the capacity slot).
- **NACK reason → run `errorType` mapping.** A `job.ack` reason beginning
  `SECRET_RESOLUTION_FAILED` fails the run with `errorType:
  SECRET_RESOLUTION_FAILED` (the agent resolved refs *before* acking, so
  a missing env var/file is a dispatch-level rejection, not a mid-run
  crash); a reason beginning `AGENT_UNAVAILABLE` (transient refusals such
  as capacity) fails `AGENT_UNAVAILABLE`; every other NACK reason fails
  `AGENT_INCOMPATIBLE` with the reason echoed into `errorMessage`.
- **Dispatch-time policy gate.** Item 13's "hub enforces at dispatch" is
  concrete: `enqueue`/`tryDispatch` re-load the run plus agent
  `revokedAt`, `allowedImporters`, linked-credential status, and manifest
  secret coverage — revoked agent → `FAILED`/`AGENT_UNAVAILABLE`;
  importer outside a non-empty policy → `FAILED`/`AGENT_INCOMPATIBLE`;
  a revoked `AGENT_MANAGED` credential → `FAILED`/`CREDENTIAL_REVOKED`
  (in-process parity; `lastUsedAt` is never stamped); a required secret
  key absent from the merged refs → `FAILED`/`CREDENTIAL_MISSING_KEY`.
  Drift therefore never persists state — the `agentIncompatible` flag on
  config responses is read-time derived.
- **Ordered frame handling.** The session service processes agent→hub
  frames serially per session so a batch's writes fully land before a
  following `run.complete` finalizes — protecting the ADR-100 terminal-
  state immutability trigger from benign out-of-order writes.
- **Dead-run frame registry.** Frames for a run the hub *never* assigned
  on a session remain a protocol violation (error + close), but frames
  for a run the hub already finalized — the zombie case after
  ack-timeout/cancel — are discarded (warn-log), so a stray agent job
  cannot take down the session and its collateral in-flight runs.
- **Bounded transitions.** The hub sends `cancel` on ack-timeout so a
  zombie job aborts instead of streaming into the void; a cancel request
  arms a confirmation deadline (`AGENT_JOB_ACK_TIMEOUT_MS`) that fails
  the run `AGENT_LOST` if the agent never answers; the PENDING→RUNNING
  transition on `job.ack` is conditional (`WHERE status='PENDING'`), so
  a cancel racing dispatch can never be overwritten — and a
  `run.complete{COMPLETED}` landing after a cancel request finalizes as
  `CANCELLED`, matching in-process semantics. Cancel wins everywhere: a
  stamped `cancelRequestedAt` on a queued run finalizes `CANCELLED`
  without ever dispatching, and a `job.ack` refusal landing after a
  cancel request finalizes `CANCELLED` rather than the refusal's
  errorType — both mirroring the in-process worker's
  `cancelRequestedAt` handling.
- **New management endpoints and response fields** (item 11's surface,
  now enumerated): `GET /api/v1/agents/{id}/configs` (bound configs +
  `agentIncompatible`), `GET /api/v1/agents/{id}/runs` (run history —
  `import_runs.agentId` is intentionally **not** a foreign key; run rows
  are history and outlive the agent), `GET /agents/{id}` gains
  `activeRuns[]`, `GET /agents` gains `runningJobs`; `ImportRun` payloads
  carry `agentId` + `agentName` (left-joined, `null` when the agent row
  is gone); `importer_configs` responses carry `agent{ id,name,status }`
  + `agentIncompatible`; create/update importer-config bodies accept
  `agentId` (uuid or `null` to unbind) and reject `CREDENTIAL_KIND_MISMATCH`
  when credential kinds disagree with the execution mode — including
  deprecated `secretRefs` on a bound config (they resolve hub-side and
  could never ship to the agent); converting legacy refs on a bound
  config produces an `AGENT_MANAGED` credential carrying the same
  references, never a `STORED` one.
- **`OFFLINE_AGENT` dashboard attention kind** — an agent `OFFLINE` with
  `boundConfigCount > 0` surfaces as an attention item (item 11's
  "attention item, when offline with bound configs"), ranked above the
  sunset kinds.

## Amendment 3 — Agent operations observability surfaces (spec 028)

Ratifies the operational-telemetry surfaces spec 028 adds on both ends of
the stream. Nothing here changes the outbound-only architecture (item 2)
or the secret-material boundary (item 6, ADR-117) — every new surface
carries state and counters only, and the agent-local listener serves no
secret values, credential fields, or reference contents.

- **Agent-local operations listener.** The agent process runs an
  unauthenticated, GET-only HTTP server (config:
  `AGENT_OPS_HOST`/`AGENT_OPS_PORT`/`AGENT_OPS_DISABLED`; defaults
  `0.0.0.0:9464`, enabled) exposing `/healthz` (200 with
  `{status:"ok",uptimeSeconds}` once config is loaded — alive through
  reconnect backoff), `/readyz` (200 only while a stream is established
  post-`hello.ok`; 503 with `state` = `connecting` | `backoff` |
  `no-credential`), and `/metrics` (Prometheus exposition). Other paths
  → 404, non-GET → 405. Listener bind/start failure is a warn-log and
  the agent continues — it is never a reason to exit. The unauthenticated
  posture mirrors the hub `/metrics` exception (ADR-097); network
  restriction is the operator's job (loopback bind, sidecar scraping,
  network policy). `Dockerfile.agent` gains a `HEALTHCHECK` against
  `/healthz`; disabling the listener therefore requires overriding the
  healthcheck in the deployment.
- **Protocol bump to v2.** `AGENT_PROTOCOL_VERSION` is 2 (item 8's
  lockstep rule makes this a hard gate — a v1 peer is refused
  `protocol_mismatch` and must rebuild from the same commit as the hub).
  The `heartbeat` payload gains an optional strict `ops` snapshot:
  `reportedAt`, `uptimeSeconds`, `activeJobs`,
  `jobs{assigned,completed,failed,cancelled}`, `assetsStreamed`,
  `credentialTests{dispatched,succeeded,failed}`,
  `secretResolutionFailures`, `reconnects` — all int≥0 process-lifetime
  counters from the agent's metrics registry. Heartbeats without `ops`
  stay valid (degradation rule: hub read surfaces show
  `reportedStatus: null` — "not reported by this agent").
- **`import_agents."reportedStatus" jsonb`** (migration 019) persists the
  latest snapshot replace-on-write with a hub-stamped `receivedAt` —
  agent clocks are never trusted for freshness. No CHECK constraint: the
  shape is Zod-validated at the wire boundary and read back verbatim.
  The snapshot survives disconnects; freshness remains the separate
  `lastContactAt`/`lastSeenAt` signal.
- **Read-surface deltas** (item 11's surface, extended):
  `GET /api/v1/agents/{id}` gains `reportedStatus`,
  `lastHeartbeatAt` (live-session `lastContactAt`; `null` with no
  session), `lastDisconnectReason` (latest closed session's reason);
  `GET /api/v1/agents` gains `lastDisconnectReason`, `lastHeartbeatAt`,
  and `reportedStatus` (the row is already loaded — same snapshot as
  detail). The detail page
  renders an "Agent-reported" block labeled as such, plus a
  last-disconnect column on the list.
- **New hub metrics** (item 10's enumeration, extended):
  `agent_dispatch_wait_seconds{agent}` (histogram — run created →
  `job.assign` sent), `agent_remote_job_duration_seconds{agent,importer}`
  (histogram — assign → finalize),
  `agent_session_duration_seconds{agent,reason}` (histogram — session
  lifetime at close), `agent_last_contact_timestamp_seconds{agent}`
  (gauge — unix time of last accepted frame). Agent-local series:
  `agent_stream_connected`, `agent_sessions_total{reason}`,
  `agent_reconnects_total{outcome}`, `agent_jobs_received_total`,
  `agent_jobs_completed_total{result}`, `agent_jobs_active`,
  `agent_assets_streamed_total{importer}`,
  `agent_credential_tests_total{result}`,
  `agent_secret_resolution_failures_total`.
- **No new audit events.** Operational telemetry is not a lifecycle
  transition (ADR-052 asymmetry) — `agent_sessions` already holds the
  operational side.

## Amendment 4 — Dashboard attention detail + agent read-surface fields (spec 040)

Ratifies the dashboard-intelligence surfaces spec 040 adds to the
attention queue and the agent read model. Nothing here changes the
outbound-only architecture or the secret-material boundary — the new
fields are read-only compositions over data already stored.

- **`CREDENTIAL_EXPIRING` dashboard attention kind** — an `ACTIVE`
  credential whose `expiresAt` is already past or inside the 30-day
  warning window (the G5 credentials-table convention) surfaces as an
  attention item: `href` `/credentials/{id}`, `at` = `expiresAt`,
  warning tone. It ranks **below** the operational failure kinds
  (`FAILED_RUN` / `PRODUCT_ERROR` / `INSTANCE_*` / `OFFLINE_AGENT`) and
  **above** the display-only sunset kinds — the same "actionable kinds
  outrank sunsets" rule Amendment 2 applied to `OFFLINE_AGENT`.
- **`AttentionItem.detail: string | null`** — a server-composed one-line
  context per row (run `errorType`/`errorMessage` for `FAILED_RUN`,
  last-contact + `disconnectReason` for `OFFLINE_AGENT`, status +
  last-seen for `INSTANCE_*`, expiry distance for `CREDENTIAL_EXPIRING`,
  `null` when the kind has nothing to add). Composed from data already
  fetched for the row — no per-row N+1; never carries secret material.
- **`GET /agents` read-surface gains** (item 11's surface, extended):
  `createdBy` — the enrolling person's display name resolved read-side
  (`COALESCE(displayName, username)` on `import_agents.createdBy`;
  `null` when unset or unresolvable — a raw person id never ships as
  the name) — and `enrollmentExpiresAt`, the live pending-enrollment
  token's expiry (`null` when `pendingEnrollment` is false). Token
  material stays hash-only per item 6.
- **`GET /dashboard/summary` gains `deltas`** — trailing-7-day created
  counts per stat card (`products`, `components`, `instances`), each
  scoped to the same population as its headline total — plus
  `importerIssues`, the number of importer-related attention items
  (`FAILED_RUN` + `OFFLINE_AGENT`) in the FULL queue, computed before the
  `ATTENTION_LIMIT` truncation so clients cannot derive it from the
  capped array. Read-only aggregates; the GET stays side-effect-free
  (ADR-094).

## Amendment 5 — Agent-local target registry and preflight (2026-10-31, via ADR-119)

**Context**: Remote importers need to reach provider endpoints inside the
restricted network — a Docker daemon, later other remote APIs — without
the hub ever holding or transmitting the access route. ADR-117 already
moves *secret values* agent-side; the remaining surface is the
**non-secret route descriptor** (endpoint, transport, TLS pinning
parameters): where it lives, who validates it, and when it fails.

**Refinement**:

- **Target profiles live on the Agent**, in a versioned, read-only JSON
  registry under `SECRETS_DIR` (convention `<name>-targets.json`, e.g.
  `docker-targets.json` for the first adopter). The hub never stores
  target profiles; the file is provisioned with the Agent like other
  `SECRETS_DIR` material.
- **`targetId` is an immutable access-route identifier.** Changing an
  endpoint, transport, or pinning parameter means creating a new profile
  ID — never editing in place. A `targetId` is distinct from
  `ImporterSource` identity and from catalog `Component` identity.
- **Importer configs reference targets indirectly**: the config scope
  carries a plain `targetId`; `ImporterManifest.targetRefKey` (ADR-056
  Amendment 1) declares which scope key holds it. The Agent validates the
  reference and resolves the typed profile through
  `context.resolveTarget(targetId)` **before** invoking the importer.
- **Preflight fails before network access**: an unknown, malformed, or
  disallowed profile rejects the job with a non-secret reason; the Agent
  stays ready for other importers. Egress allowlists remain
  defense-in-depth, not the primary gate.
- **Credentials compose, not redefine**: a profile may reference
  `AGENT_MANAGED` credential bundles (ADR-117) for keys/certs; the
  credential mechanism itself is unchanged.
- The contract is provider-agnostic. Docker is the first adopter
  (socket/named-pipe, mutual-TLS TCP, pinned-host-key SSH, allowlisted
  named Context); transport-specific fields live in the typed profile
  schema, not in this contract.

---

**Amended by ADR-119**: the Agent gains a versioned, read-only,
Agent-local target registry with immutable `targetId`s and
fail-before-network preflight — see Amendment 5.
