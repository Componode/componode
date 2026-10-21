# Remote Import Agents Research

> **Purpose**: Define an architecture for running Componode importers in a
> separate, remotely deployed container — the **Import Agent** — for
> environments where the Componode hub cannot reach the external source but a
> process inside that network can.
>
> **Scope**: Architecture proposal distilled from a grilling session
> (2026-10-21). Covers topology, execution model, wire protocol, credential
> model, security model, schema deltas, and packaging. No code changes.
>
> **Relationship to existing work**: Extends the importer execution model
> ([ADR-022](./adrs/ADR-022-importer-execution-scheduled-on-demand.md),
> [ADR-056](./adrs/ADR-056-importer-interface-signature.md),
> [ADR-058](./adrs/ADR-058-importer-cancellation.md)–[ADR-062](./adrs/ADR-062-importer-run-progress-reporting.md))
> with a remote execution path; the `AsyncGenerator<DiscoveredAsset>` contract
> and hub-side reconciliation ([ADR-035](./adrs/ADR-035-instance-reconciliation-orphan-missing-instances.md)–[ADR-038](./adrs/ADR-038-importer-run-resume-strategy.md),
> [ADR-057](./adrs/ADR-057-discoveredasset-final-shape.md)) are unchanged.
> Extends the credential store ([ADR-107](./adrs/ADR-107-credential-store.md))
> with a reference-only credential flavor. Ratified decisions are recorded in
> [ADR-116](./adrs/ADR-116-remote-import-agents.md) and
> [ADR-117](./adrs/ADR-117-agent-managed-credentials.md).

---

## Executive Summary

1. **The Import Agent is a dumb, stateless, outbound-only executor.** It runs
   the existing importer packages inside a restricted network, initiates all
   connections to the hub over a single WebSocket, and streams
   `DiscoveredAsset` batches back. The hub keeps validation, upsert,
   reconciliation, run bookkeeping, and edge suggestions — the importer
   contract is the wire boundary.
2. **Secrets never cross the wire.** A new `AGENT_MANAGED` credential flavor
   stores per-key *references* (`env`/`file` names), not ciphertext. The agent
   resolves them against its own environment at job start. Rotating a cloud
   key is invisible to the hub.
3. **Remote execution is strictly opt-in per importer config.** A nullable
   `agentId` on `importer_configs` binds a config to a named agent; unbound
   configs run in-process exactly as today.
4. **The WebSocket session is the run's lifeline.** A disconnect fails
   in-flight runs (`AGENT_LOST`) on both sides; no resume-on-reconnect in v1.
5. **Agents ship as one image containing all importers**, built from the same
   monorepo — version parity is a build-time property enforced by a connect
   handshake.

---

## 1. Problem & scenarios

Today importers execute in-process inside the single `app` container
(`import-run-service.ts` iterates the generator, resolves secrets, upserts).
This requires the hub to reach every discovery source: GitHub, cloud control
planes, Kubernetes API servers, MCP endpoints.

Real deployments break that assumption:

- **Restricted inbound networks** — a Kubernetes cluster or VPC with no
  internet ingress and no inbound firewall rules the hub can use.
- **Cloud APIs with no public surface** — AWS/Azure APIs reachable only
  through private endpoints inside the account's network.
- **Egress-only corporate zones** — outbound HTTPS permitted (often through a
  proxy), inbound forbidden.

In every case the fix is the same: run the importer *inside* the reachable
network and let it phone home. This is the established pattern of GitHub
Actions self-hosted runners, Azure DevOps agents, and HashiCorp Boundary
workers.

## 2. Topology

```text
┌─────────────────────────────┐         ┌──────────────────────────────┐
│  Restricted network         │         │  Hub network                 │
│                             │         │                              │
│  ┌───────────────────────┐  │  wss    │  ┌────────────────────────┐  │
│  │ Import Agent          │──┼────────►│  │ app (Fastify)          │  │
│  │  - all importer pkgs  │  │ outbound│  │  - agent sessions      │  │
│  │  - secret resolver    │  │ only    │  │  - run orchestration   │  │
│  │  - WS client          │  │         │  │  - reconciliation      │  │
│  └──────────┬────────────┘  │         │  └───────────┬────────────┘  │
│             │               │         │              │               │
│             ▼               │         │              ▼               │
│   K8s API / cloud APIs /    │         │         PostgreSQL           │
│   internal endpoints        │         │                              │
└─────────────────────────────┘         └──────────────────────────────┘
```

- **Agent-initiated, outbound-only.** The hub never dials the agent — required
  for every scenario above.
- **Single WebSocket** carries control plane (hello, job.assign, cancel,
  heartbeat, test requests) *and* data plane (asset batches, completion).
  No separate REST ingest endpoint.
- **Dumb agent.** No configs, no run state, no asset cache — it persists only
  `{hubUrl, agentToken, name}`. A `job.assign` frame carries everything the
  run needs.

## 3. Execution model

### 3.1 Dispatch flow

1. Admin creates an `import_agents` record → enrollment token (see §5.2).
2. `ImporterConfig.agentId` binds a config to the agent (null = in-process).
3. `startRun` inserts `import_runs` row `PENDING` (unchanged) plus `agentId`.
4. Hub sends `job.assign {runId, importerName, scope, credentialRefs}` when
   the agent has capacity; agent ACKs → run `RUNNING`.
5. Agent executes `importer.run(scope, resolvedSecrets, ctx)` and streams
   `asset.batch` frames; hub validates + processes each asset exactly as the
   in-process loop does today.
6. `run.complete` finalizes: reconciliation, retired-component pass, edge
   suggestions — all unchanged.

### 3.2 Concurrency & waiting

- Agent advertises `maxConcurrentJobs` in `hello` (default 1).
- If the agent is offline or busy, the run sits `PENDING` ("waiting for
  agent") until a dispatch timeout (configurable, default ~10 min) →
  `FAILED` with `AGENT_UNAVAILABLE`.

### 3.3 Cancellation

Hub sets `cancelRequestedAt` (as today) **and** sends a `cancel` frame; the
agent's `AbortController` fires. Run → `CANCELLED` on agent confirmation.

### 3.4 Failure semantics

| Event | Result |
|---|---|
| WS disconnect | All in-flight runs on that agent → `FAILED` (`AGENT_LOST`); agent aborts its local jobs |
| Agent offline at dispatch | Run `PENDING` → dispatch timeout → `FAILED` (`AGENT_UNAVAILABLE`) |
| Credential test while agent offline | `AGENT_OFFLINE` |
| Single asset exceeds frame cap | Per-asset run error `ASSET_TOO_LARGE`; run continues |
| Agent revoked | Session dropped; bound configs flagged; new runs fail fast |

**No resume-on-reconnect.** The generator is not checkpointed; resumable runs
would need a seq-cursor protocol + generator restart — deferred.

## 4. Wire protocol

- **Transport**: `wss://<hub>/api/v1/agent/stream`, HTTP upgrade authenticated
  by the agent bearer credential (dedicated middleware, not `verifySession`).
- **Framing**: JSON envelopes `{type, runId?, payload}`; schema in
  `packages/core` (`contracts/agent-protocol.ts`) shared by hub, agent, tests.
- **Message types** (v1): `hello`, `job.assign`, `job.ack`, `asset.batch`,
  `phase`, `run.complete`, `run.error`, `cancel`, `heartbeat`,
  `credential.test` / `credential.test.result`, close-with-error.
- **`hello`** on connect: `{protocolVersion, agentVersion,
  importers: [{name, version}], maxConcurrentJobs}`. Hub rejects mismatched
  protocol or importer versions — version parity is enforced at handshake,
  not negotiated.
- **Framing limits**: `asset.batch` ≤ ~100 assets or ~1 MB, whichever first.
- **Liveness**: agent heartbeat ~30 s; hub marks offline + fails in-flight
  runs after ~90 s silent.
- **Reconnect**: exponential backoff; each reconnect is a fresh session.
- **Full spec**: `docs/agent-protocol.md`; route registered in
  `docs/openapi.yaml` per ADR-104.

## 5. Credential model

### 5.1 `AGENT_MANAGED` credentials

A `credentials.kind` discriminator: `STORED` (today's AES-256-GCM payloads) |
`AGENT_MANAGED`. Agent-managed records store a plaintext **`secretRefMap`**:

```json
{ "token": { "env": "PROD_GH_TOKEN" }, "clientSecret": { "file": "gh-secret" } }
```

- Key names drive `assertSecretCoverage` unchanged; `credentialIds` on
  configs works uniformly — no new config field, no resurrection of
  deprecated `secretRefs`.
- The map is *not* secret (names, not values); plaintext jsonb is fine.
- `job.assign` ships the refs; the agent resolves them against its own
  env / `SECRETS_DIR` at run start.
- Per-credential refs avoid the collision a flat env convention would create
  (two GitHub creds, both key `token`, on one agent).

### 5.2 Agent-side protection (ratified in grilling)

- **Sources**: `env` + files under `SECRETS_DIR` only, behind a resolver seam
  for future `vault|ssm|…` ref types.
- **Docs steer production to file mounts** (docker secrets, k8s secret
  volumes); env leaks via `/proc`, `docker inspect`, crash dumps.
- **Lifecycle**: resolved at job start, in-memory for run duration, never
  persisted, never logged; `redactSecrets` discipline mirrored on the agent.
- **Rotation**: entirely agent-side — update the env var or remount the file;
  the hub record never changes. `expiresAt` remains advisory metadata.
- **Audit**: agent logs resolution *events* (key + source type, never
  values); hub already stamps `credentialIds` on runs.
- **Encryption at rest is delegated to the deployment platform** — the agent
  implements no crypto. Co-located key+ciphertext on one host is
  obfuscation, not security; the recommended path is the platform's own
  protection: Kubernetes `encryptionConfiguration`/KMS-encrypted secrets,
  Docker Swarm secrets (encrypted in raft), Vault agent injection or AWS
  SSM → plaintext *files* under `SECRETS_DIR`. The agent never learns or
  cares; the resolver seam leaves room for future `vault:`/`ssm:` ref types
  or a hub-brokered encrypted-store `store:` ref (parked — see §12).
- **The agent token is a secret too** — it grants catalog injection and is
  arguably the highest-value asset on the host. It receives the *same*
  protection guidance as importer credentials: prefer a mounted token file
  over `AGENT_TOKEN` env, mounted via the platform's secret mechanism —
  protecting importer secrets while the token sits plaintext beside them is
  a half-measure.

### 5.3 Credential test

`testSecrets` is routed to the bound agent (`credential.test` frame →
`credential.test.result`, ~30 s timeout). Agent offline → `AGENT_OFFLINE`.

## 6. Security model

### 6.1 Enrollment & token lifecycle

- Admin creates agent (name only) → **single-use enrollment token** (TTL
  ~24 h). First connect exchanges it for a durable agent credential, shown
  once, stored hashed hub-side.
- Rotation = new enrollment token on the same agent record (identity/audit
  continuity). Revoke = credential killed + session dropped.

### 6.2 Transport

- TLS mandatory for `wss://`; plaintext WS permitted only for `localhost`
  (dev/loopback). `CA_BUNDLE` env/file for internal CAs and TLS-inspecting
  proxies — a hard requirement in restricted networks.
- No insecure-skip-verify flag.

### 6.3 Threat model

| Threat | Mitigation / accepted risk |
|---|---|
| Stolen agent token | Jobs only dispatch to their *bound* agent → token yields env/file *names* only; forged-asset injection is the residual risk — mitigated by revocation + normal reconciliation path; documented |
| Agent host compromise | Agent host holds the agent token + plaintext importer secrets — inherent to the model; deployer hardening responsibility. Docs steer to platform secret mounts (token file, k8s KMS-encrypted secrets) so casual-read primitives (`docker inspect`, `/proc`, env dumps) yield nothing |
| Asset payloads exfil source data | `details`/`rawConfig` may embed sensitive values — pre-existing contract issue, not introduced by remote execution; importer-author guidance in `importer-development.md` |
| Corp proxy breaks WS | Accepted v1 limitation; long-poll fallback is future work |

## 7. Schema deltas

- `import_agents`: id (UUID v7), name, status, agentVersion,
  protocolVersion, importerVersions jsonb, **allowedImporters jsonb**
  (hub-managed per-agent capability, empty = all), credential hash,
  lastSeenAt, timestamps.
- `agent_sessions`: id, agentId FK, connectedAt, disconnectedAt,
  disconnectReason, remoteAddress, agentVersion, protocolVersion —
  operational connection history (not trigger-protected append-only).
- `importer_configs.agentId` nullable FK → `import_agents`.
- `import_runs.agentId` nullable — records the executor for audit (config
  binding may change later).
- `credentials.kind` (`STORED` | `AGENT_MANAGED`) + `secretRefMap` jsonb.
- New error codes in `packages/core`: `AGENT_LOST`, `AGENT_UNAVAILABLE`,
  `AGENT_OFFLINE`, `AGENT_INCOMPATIBLE`, `ASSET_TOO_LARGE`.

## 8. Management & UX surface

### 8.1 API

- `GET/POST /api/v1/agents`, `GET/DELETE /api/v1/agents/{id}`,
  `POST /api/v1/agents/{id}/enroll` (session-auth + `agent:*` permission).
- `/api/v1/agent/stream` — WS upgrade, agent-token auth (ADR-097 amendment).
- Importer manifests still served hub-side for config UX — the agent embeds
  the same packages, so schemas never diverge.

### 8.2 Information architecture (ratified in grilling)

- **Placement**: `/agents` + `/agents/:id` under the **Admin** sidebar
  section — alongside Credentials/Sessions (admin-managed infrastructure).
  Importer cross-links connect it to Sources.
- **Pages**: standard list template (Name, Status, Version, Importers, Bound
  configs, Last seen, actions) + standard detail template with tabs
  **Overview** (agent/protocol/importer versions, last seen), **Configs**
  (bound importer configs), **Runs** (recent runs on this agent).
- **Enrollment**: "Add agent" → name dialog → show-once dialog with the
  enrollment token **and a copy-ready `docker run` snippet** (HUB_URL, name,
  token prefilled) + k8s docs link.
- **Config binding**: framework-level **Execution** selector in the config
  form — `This hub (in-process)` (default) | `Agent: <name>` — above the
  credential selector. Selecting an agent filters credentials to
  `AGENT_MANAGED`, flips helper copy to "Resolved on the agent", warns
  inline if the agent is offline, and disables agents whose
  `allowedImporters` doesn't cover the config's importer.
- **Credential form**: "Where do the values live?" selector —
  `Stored in Componode` (key→value) | `Resolved on an Import Agent`
  (per-key rows: key + `env`/`file` + reference name). Agent-managed
  credentials carry a badge in `/credentials`.
- **Status badges**: `Connected` (green-ish), `Offline` (muted),
  `Never connected` (neutral) — same color semantics as the existing map.
  Freshness via TanStack Query `refetchInterval` (~15 s); no frontend WS.
- **Run/config integration**: run detail header shows `Ran on agent <name>`
  (link for admins, text for viewers) or `In-process`; `PENDING` remote runs
  display "Waiting for agent <name>"; config cards show
  `Runs on: <agent>` with a warning indicator when offline.
- **Lifecycle actions**: **Rotate token** (new enrollment token, show-once),
  **Revoke** (confirm dialog listing bound configs; binding kept, runs fail
  `AGENT_UNAVAILABLE` until re-pointed/re-enrolled), **Delete** (blocked
  while configs bound — the `CREDENTIAL_IN_USE` precedent).
- **Permissions**: `agent:read|create|update|delete` (ADR-054 amendment);
  agent names render as plain text on non-admin surfaces.
- **Dashboard**: "Attention needed" gains *offline agent with bound configs*.
- **Empty states**: `/agents` empty explains the feature + links docs;
  Execution selector with zero agents disables the option + hints to
  `/agents`.
- `docs/ux.md` (nav diagram, route map, badges, execution-target section) is
  updated in the same implementation change, per ADR-103.

## 9. Packaging & dependencies

- **`packages/agent`** workspace package: thin host (WS client, resolver,
  job executor) depending on `core` + all 8 importer packages — same
  manifest-import pattern as backend; requires ADR-065 amendment.
- **`importer-registry.ts` moves to `packages/core`** — shared by backend
  and agent; no duplication.
- Published image `componode-agent`, configured by env: `HUB_URL`,
  `AGENT_TOKEN` — **or preferably a mounted token file**
  (`AGENT_TOKEN_FILE`) — `SECRETS_DIR`, `CA_BUNDLE`, `MAX_JOBS`.
  Container only — no standalone binary in v1.
- Docs: `docs/agents.md` deployment + k8s manifest example + hardening
  guide that treats token and importer secrets uniformly (platform secret
  mounts over env vars; encryption at rest via the platform).

## 10. Agent settings & capability model

### 10.1 Agent plumbing (ratified in grilling)

- **Environment variables only in v1** — `HUB_URL`, `AGENT_TOKEN`/token
  file, `SECRETS_DIR`, `CA_BUNDLE`, `MAX_JOBS`, `HTTPS_PROXY`/`NO_PROXY`.
  No config file, no hot-reload — one surface, same as the hub's `.env`.
- **Outbound proxy is first-class**: the agent honors `HTTPS_PROXY`/
  `NO_PROXY` for the hub channel; restricted networks routinely require a
  proxy for egress. Per-importer SDK proxy support varies — caveats are
  documented in each importer guide.
- **No agent-side importer tuning** — importer behavior lives exclusively
  in `config.scope` on the hub, identical regardless of executor. Agent
  env is plumbing only; two tuning surfaces would guarantee drift.

### 10.2 Importer capability (hub-managed, ratified in grilling)

- **`import_agents.allowedImporters`** (jsonb; empty = all importers) is a
  **hub-side per-agent setting** managed in the admin portal — not an
  agent env var. Rationale: which importers an agent may run is a hub
  policy decision; the restricted host operator should not be the one
  deciding it. An agent inside a k8s cluster can legitimately serve
  `kubernetes` *and* any other importer that network reaches (internal
  GitLab, internal cloud endpoints).
- **`hello` still advertises the compiled importer set + versions** — used
  for version matching, not for allowlisting.
- **Enforcement is hub-side at dispatch**: `job.assign` is only sent for
  importers in the agent's allowed set. The Execution selector and
  save-time validation read the same field and reject incompatible
  bindings with `AGENT_INCOMPATIBLE`.
- **The agent-side NACK covers compiled-set + version only** — the agent
  holds no allowlist policy; it validates "can I run this importer at the
  right version" before ACK, and a NACK fails the run
  `AGENT_INCOMPATIBLE` with the reason echoed.
- **Drift reconciliation**: when `allowedImporters` changes (admin edit)
  or advertised versions shift (reconnect/hello), the hub re-evaluates
  bound configs; mismatches are flagged on the config card + agent detail
  and future runs fail fast until fixed.
- **One credential, many agents**: an `AGENT_MANAGED` credential's refs
  are agent-relative and resolve on whichever host runs the job — one
  credential can serve configs bound to different agents when both hosts
  define the same env/file names (documented pattern); divergent agents
  get separate credentials.
- **Agent detail Overview displays the allowed set + advertised versions**
  (labeled agent-reported for the latter) — "what will this agent accept"
  is visible without reading agent logs; the allowed set is editable there
  by admins.

## 11. Versioning

## 11. Logging, audit & traceability

### 11.1 Audit split (ratified in grilling)

- **Lifecycle → `entity_changes`** (`entityType: "import_agent"`, surfaced in
  `/activity`): `created`, `enrolled`, `token_rotated`, `revoked`, `deleted`,
  `credential_test_dispatched`. Actors: admin name for management actions,
  `agent:<name>` for agent-originated events.
- **Connections → `agent_sessions`** (operational, not audit): `agentId`,
  `connectedAt`, `disconnectedAt`, `disconnectReason` (`client_close`,
  `heartbeat_timeout`, `revoked`, `shutdown`), `remoteAddress`,
  `agentVersion`, `protocolVersion`. High-frequency reconnects must never
  flood the append-only audit tables; no retention policy in v1.
- **Rejected upgrades never write audit rows** — unauthenticated traffic
  into append-only tables is a spam vector. Bad/expired/revoked tokens and
  version mismatches → Pino warn + metrics only.

### 11.2 Traceability

- **`runId` is the end-to-end correlation key**: assigned hub-side, sent in
  `job.assign`, stamped in the agent's `ctx.runId` and stdout logs, recorded
  on the hub's run row. Debug path: `docker logs`/`kubectl logs` filtered by
  runId ↔ hub run detail.
- **Executor attribution**: import-driven asset changes keep the
  `importer:<name>` actor; `import_runs.agentId` records who executed — the
  run row is the join point between what ran and where.
- **`agent_sessions` captures remoteAddress + versions per connection** —
  "what code ran from where" is answerable per session. No IP-anomaly
  alerting in v1; the raw material is there for external alerting.

### 11.3 Live visibility

- Agent detail shows **in-flight jobs** (runId, config, phase, elapsed)
  from hub dispatch state — no agent query needed; `/agents` list shows a
  running-count column.
- Agent detail tabs: Overview | Configs | Runs | **Sessions**
  (`agent_sessions` history); agent audit entries appear in global
  `/activity`.
- Dashboard "Attention needed" keeps the single ratified item: *offline
  agent with bound configs* — no flapping/auth-failure alerting.

### 11.4 Metrics & logs

- New Prometheus series (existing plugin, existing label discipline):
  `import_agents_connected` gauge, `agent_jobs_total{agent,result}`,
  `agent_sessions_total{agent,reason}`, `agent_assets_received_total{agent,importer}`.
- Importer `ctx.logger` output stays **agent-local** (agent stdout);
  resolution events log key names + source types only, never values. The
  hub receives structured events only: phases, per-asset errors, warnings,
  completion. No log shipping in v1.

## 12. Non-goals (explicitly deferred)

- Run resume / re-dispatch after disconnect (needs seq-cursor protocol).
- Label-based agent pools / any-matching-agent scheduling.
- Agent log streaming to the hub.
- Standalone (non-container) agent binary; per-importer agent images.
- mTLS agent authentication.
- Long-poll fallback for WS-hostile proxies.
- External secret-manager ref types (`vault`, `ssm`, …) — resolver seam left.
- Agent-local encrypted secret store (co-located or hub-brokered key,
  `store:` ref type) — real split-key value but kills the idiomatic
  secret-mount workflow; parked pending a concrete deployment need.
- Hub-push of decrypted secrets to agents (rejected — secrets must not cross
  the wire).

## 13. ADR impact

- **ADR-116** (new): remote import execution model + wire protocol.
- **ADR-117** (new): agent-managed credentials.
- Amendments: ADR-022 (execution gains a remote path), ADR-055 (resolution
  may be agent-side), ADR-065 (`packages/agent` joins the allowed
  aggregator set; registry moves to core), ADR-097 (agent stream route added
  to session-auth exceptions), ADR-107 (`kind` discriminator + `secretRefMap`).
- Unaffected by design: ADR-035–038 (reconciliation), ADR-056/057 (importer
  contract — the agent *is* the contract's transport), ADR-113 (suggestions
  run hub-side post-run).
