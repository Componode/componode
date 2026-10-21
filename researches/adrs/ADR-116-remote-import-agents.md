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
