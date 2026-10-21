# Feature Specification: Import Agents Foundation

**Feature Branch**: `feature/025-import-agents-foundation`

**Created**: 2026-10-21

**Status**: Draft

**Input**: User description: "Remote Import Agents — foundation spec (first
of four). Decisions ratified in
`researches/adrs/ADR-116-remote-import-agents.md`,
`researches/adrs/ADR-117-agent-managed-credentials.md`, and
`researches/remote-import-agents_research.md`. This spec delivers the Import
Agent entity, enrollment and credential lifecycle, the authenticated agent
connection channel, connection history, and the admin management surface —
everything except job dispatch, remote run execution, and agent-managed
credentials, which are separate specs."

## Clarifications

### Session 2026-10-21

- Q: When a second connection with the same credential supersedes a live
  session, what should the displaced agent process do? → A: Exit — log the
  supersede reason and terminate with a distinct exit status; a duplicate
  live credential is a deployment error, not a transient failure (prevents
  reconnect ping-pong between two agent copies).
- Q: Can credential rotation re-enable a revoked agent, or is revocation
  terminal for that identity? → A: Rotation re-enables — issuing a new
  enrollment token on a revoked agent clears its revoked state; revoke
  kills the credential and session, not the identity (a permanently dead
  identity is covered by Delete).
- Q: Where should the copy-ready install command get its hub URL? → A:
  The enrollment dialog presents the hub URL as an editable field
  prefilled from the browser origin — the admin corrects it to the
  agent-reachable address (e.g. internal ingress) before copying; no new
  settings surface.
- Q: When an admin sets `allowedImporters`, should the API reject entries
  that don't match a compiled importer's name? → A: Reject — unknown
  names fail save with a validation error; it is a policy field, so
  silent no-ops (typos) are worse than strict validation.
- Q: During credential rotation, when exactly does the previous durable
  credential stop working? → A: On re-enrollment — the old credential
  stays valid until the new enrollment token is exchanged (graceful
  overlap; rotation causes no downtime), then the superseded credential
  dies and any live session is dropped.
- Q: What happens to an agent's connection history when the agent record
  is deleted? → A: Cascade — `agent_sessions` rows are deleted with the
  agent; the `deleted` lifecycle audit entry (actor + timestamp) is the
  durable record. Deleting a connected agent closes its live session;
  reconnect attempts fail credential auth, which the agent treats as
  terminal (no retry).
- Q: What format constraints should agent names have? → A: k8s-label
  style — `^[a-z0-9]([a-z0-9-]*[a-z0-9])?$`, 1–63 chars; shell/env-safe
  by construction for install commands, audit actors (`agent:<name>`),
  and logs.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Register an agent and get enrollment material (Priority: P1)

A catalog administrator opens the Import Agents page, creates a named agent,
and immediately receives a single-use enrollment token plus a copy-ready
install command for the remote network (container run command with hub URL,
agent name, and token prefilled). The token is shown once and never
retrievable again.

**Why this priority**: Enrollment is the entry point to the entire feature.
Without a working create → token → install flow, nothing downstream —
connection, runs, secrets — can happen.

**Independent Test**: Create an agent through the admin UI, copy the install
command, and verify it contains a valid single-use enrollment token; confirm
the token cannot be retrieved again from any API or UI surface.

**Acceptance Scenarios**:

1. **Given** an admin on the Import Agents page, **When** they create an
   agent named "eu-k8s-prod", **Then** a show-once dialog presents the
   enrollment token and a ready-to-paste install command containing the hub
   URL, agent name, and token.
2. **Given** an enrollment token older than its TTL, **When** an agent
   attempts to enroll with it, **Then** enrollment is rejected with a clear
   error and no credential is issued.
3. **Given** an enrollment token already used once, **When** it is presented
   again, **Then** enrollment is rejected — the token is single-use.

---

### User Story 2 - Remote agent connects, authenticates, and stays visible (Priority: P1)

An operator deploys the agent container inside a restricted network with
only outbound connectivity. The agent enrolls, opens a persistent outbound
connection to the hub, identifies itself (protocol version, build version,
compiled importers, capacity), and appears in the hub's agent list as
connected — with live presence that reflects reality: when the connection
drops, the agent is shown offline within a bounded time.

**Why this priority**: The connection is the feature's backbone — the admin
must be able to trust that "connected" means reachable and "offline" means
gone.

**Independent Test**: Run the agent container pointed at the hub, observe it
appear as connected in the admin UI with reported versions, then kill the
container and observe it transition to offline within the stale-connection
window.

**Acceptance Scenarios**:

1. **Given** a valid agent credential, **When** the agent connects, **Then**
   it completes a handshake declaring protocol version, agent version,
   compiled importer versions, and job capacity, and its status becomes
   connected.
2. **Given** an agent on a mismatched protocol or importer version, **When**
   it connects, **Then** the connection is rejected with a version-mismatch
   error visible to the agent operator (agent logs) and discoverable by the
   admin via hub logs and the `agent_stream_rejected_total` metric per FR-014
   (a dedicated UI surface for handshake failures is deferred).
3. **Given** a connected agent that stops heartbeating, **When** ~90 seconds
   pass without contact, **Then** the agent's status becomes offline.
4. **Given** a revoked agent credential, **When** a connection attempt uses
   it, **Then** the upgrade is rejected before any session is established.

---

### User Story 3 - Admin manages the agent fleet (Priority: P2)

The admin sees all agents in a list (name, status, version, bound config
count, last seen), opens an agent detail page (overview with reported
versions and capabilities, connection history), and performs lifecycle
actions: rotate the credential (new enrollment token, same identity), revoke
(drops the session, blocks future connects), and delete (only when nothing
is bound to it).

**Why this priority**: Day-2 operations — rotation, revocation, inventory —
are what make a deployed remote component governable.

**Independent Test**: Create two agents, connect one, rotate the other's
token, revoke the connected one and verify its session drops and it cannot
reconnect, and attempt to delete an agent that still has references.

**Acceptance Scenarios**:

1. **Given** a connected agent, **When** the admin revokes it, **Then** the
   session is dropped, the status becomes offline, and subsequent connect
   attempts are rejected.
2. **Given** an agent record, **When** the admin rotates its credential,
   **Then** a fresh single-use enrollment token is issued under the same
   agent identity and the previous credential stops working once
   superseded — supersession happens at enrollment exchange, so the old
   credential remains valid (and any session stays up) until the agent
   re-enrolls.
3. **Given** an agent with no bound importer configs, **When** the admin
   deletes it, **Then** the record is removed; **Given** an agent referenced
   by a config, **When** delete is attempted, **Then** it is blocked with a
   clear in-use error.
4. **Given** the agent list, **When** the admin views it, **Then** each row
   shows name, connection status, reported version, and last-seen time.

---

### User Story 4 - Admin audits agent lifecycle and connection history (Priority: P2)

Every consequential agent event is traceable: creation, enrollment,
credential rotation, revocation, and deletion appear in the activity feed
attributed to the acting admin (or the agent itself for enrollment); every
connection and disconnection is recorded with timestamps, disconnect reason,
remote address, and reported versions.

**Why this priority**: A remotely deployed executor is a security-relevant
asset — the admin must answer "when was it online, from where, running
what, and who touched it" without reading agent host logs.

**Independent Test**: Perform each lifecycle action and several
connect/disconnect cycles, then verify the activity feed shows the lifecycle
events with actors and the connection history shows sessions with reasons
and remote addresses.

**Acceptance Scenarios**:

1. **Given** lifecycle actions performed by an admin, **When** viewing the
   activity feed, **Then** entries exist for agent created, enrolled, token
   rotated, revoked, and deleted with the acting admin named.
2. **Given** an agent that disconnected due to a heartbeat timeout, **When**
   viewing its connection history, **Then** the session row shows connect
   and disconnect times plus the timeout reason and remote address.
3. **Given** rejected connection attempts (bad or revoked token, version
   mismatch), **When** checking the activity feed, **Then** no audit entries
   are created — unauthenticated traffic never writes audit records.

---

### User Story 5 - Operator deploys the agent package (Priority: P2)

A workspace package exists that a container image is built from: it reads
configuration exclusively from environment variables (hub URL, credential or
credential-file, secrets directory, CA bundle, max jobs, proxy variables),
connects, and reconnects with backoff after failures. In this spec it
executes no importer jobs — it is a live, authenticated shell proving the
channel.

**Why this priority**: The deployable artifact is the other half of the
channel — without a real agent process, "connected" is untestable.

**Independent Test**: Build and run the agent against a local hub with a
valid credential; interrupt connectivity and confirm exponential-backoff
reconnect; point it at an `https` hub with an internal CA bundle and confirm
the channel comes up.

**Acceptance Scenarios**:

1. **Given** correct env configuration, **When** the agent starts, **Then**
   it enrolls or authenticates and holds a session until stopped.
2. **Given** a dropped connection, **When** the agent retries, **Then** it
   backs off exponentially rather than hammering the hub.
3. **Given** a hub behind an internal CA, **When** a CA bundle path is
   provided, **Then** the TLS connection succeeds; without it, it fails
   closed.
4. **Given** a plaintext `ws` URL to a non-localhost host, **When** the
   agent starts, **Then** it refuses — TLS is mandatory except loopback.

---

### Edge Cases

- Enrollment token presented after TTL expiry or a second time → rejected,
  no credential issued.
- Two agents connecting with the same credential → the later connection
  supersedes the earlier session (single active session per agent
  identity); the displaced agent process exits with a clear supersede
  reason rather than retrying.
- Agent name collision on create → clear duplicate-name error.
- Agent connects from a different remote address than previous sessions →
  allowed; the session history records the differing addresses for audit.
- Hub restarts while agents connected → agents reconnect automatically;
  each reconnect is a new recorded session.
- Non-admin user attempts to reach agent management surfaces → permission
  denied; agent names shown on read surfaces are plain text, not links, for
  non-admins.
- `allowedImporters` set to a subset on an agent → stored and displayed;
  no dispatch exists yet in this spec so no run-time effect.
- Delete a connected (but unbound) agent → allowed: the live session is
  closed and its connection history cascades with the record — the
  `deleted` audit entry is the durable trace. The agent's next connect
  fails credential auth → terminal, no retry.

## Requirements _(mandatory)_

### Functional Requirements

#### Entity & lifecycle

- **FR-001**: The system MUST provide a first-class `ImportAgent` entity
  (unique name, status, reported versions, allowed-importers list,
  timestamps) managed through admin APIs. Names MUST match
  `^[a-z0-9]([a-z0-9-]*[a-z0-9])?$` (1–63 chars) — safe for env vars,
  audit actors, and log contexts.
- **FR-002**: Creating an agent MUST issue a single-use enrollment token
  with a bounded TTL (~24 h), shown exactly once in the API response/UI.
- **FR-003**: Successful enrollment MUST exchange the enrollment token for a
  durable per-agent credential (shown once, stored hashed server-side).
- **FR-004**: Admins MUST be able to rotate an agent's credential (new
  enrollment token, same identity) and revoke it (active session dropped,
  future connects rejected). Revocation is credential-terminal but not
  identity-terminal: rotating a revoked agent re-enables it for
  enrollment.
- **FR-005**: Agent deletion MUST be blocked while any importer config
  references the agent.
- **FR-006**: `ImportAgent.allowedImporters` MUST restrict which importer
  names the agent is permitted to serve (empty = all); stored and editable
  by admins in this spec. Entries MUST validate against the known importer
  names — unknown names are rejected at save.

#### Connection channel

- **FR-007**: The system MUST expose a WebSocket upgrade endpoint under
  `/api/v1/` authenticated by the agent credential (dedicated middleware —
  not the session-auth used by human users).
- **FR-008**: On connect, the agent MUST send a handshake declaring protocol
  version, agent version, compiled importer names + versions, and maximum
  concurrent jobs; the server MUST reject mismatched protocol or importer
  versions with a clear error.
- **FR-009**: The agent MUST send periodic heartbeats (~30 s); the server
  MUST mark the agent offline after ~90 s without contact.
- **FR-010**: A single active session per agent identity — a second
  connection with the same credential supersedes the first.
- **FR-011**: TLS MUST be required for remote connections; plaintext
  WebSocket is permitted only for loopback/localhost. Custom CA bundles
  MUST be supported on the agent side; no insecure-skip-verify option.

#### Connection history & audit

- **FR-012**: Every connection MUST create a session record capturing
  connect/disconnect timestamps, disconnect reason (`client_close`,
  `heartbeat_timeout`, `revoked`, `shutdown`, `superseded`), remote
  address, and reported versions.
- **FR-013**: Agent lifecycle events (`created`, `enrolled`,
  `token_rotated`, `updated`, `revoked`, `deleted`) MUST be written to the append-only
  audit feed, attributed to the acting admin (or `agent:<name>` for
  enrollment).
- **FR-014**: Rejected connection attempts (bad/expired/revoked credential,
  version mismatch) MUST be logged and counted in metrics but MUST NOT
  write audit records.

#### Agent package

- **FR-015**: A dedicated `packages/agent` workspace package MUST exist that
  connects, enrolls/authenticates, heartbeats, and reconnects with
  exponential backoff — depending only on `packages/core` and the importer
  packages (manifest imports for the version handshake).
- **FR-016**: The agent MUST be configured solely via environment variables:
  hub URL, `AGENT_TOKEN` or `AGENT_TOKEN_FILE` (file preferred), secrets
  directory, CA bundle, max jobs, proxy variables. No config file.
- **FR-017**: The agent MUST NOT execute importer jobs in this spec — job
  messages are not yet part of the protocol it handles.

#### UI & permissions

- **FR-018**: An `/agents` admin page MUST list agents with status badges
  (`Connected`/`Offline`/`Never connected`), version, and last-seen; an
  `/agents/:id` detail page MUST show overview (reported versions,
  allowed importers, capacity) and connection history tabs.
- **FR-019**: The enrollment dialog MUST present the token plus a
  copy-ready install command (hub URL + name + token prefilled) and a docs
  link — shown once. The hub URL field is editable (prefilled from the
  browser origin) so the generated command carries the address agents
  will actually dial.
- **FR-020**: A new `agent:read|create|update|delete` permission set MUST
  gate all agent management surfaces (admin role by default).
- **FR-021**: `docs/openapi.yaml` MUST be updated for every new endpoint
  (management routes + the stream route) per ADR-104; the agent protocol
  message shapes MUST be documented in `docs/agent-protocol.md`.
- **FR-022**: `docs/ux.md` (nav, route map, badges) and `CONTEXT.md` MUST be
  updated in the same change.

### Key Entities

- **ImportAgent**: a remotely deployed executor identity — name, connection
  status, reported agent/protocol/importer versions, `allowedImporters`
  list, credential reference (hashed), last-seen, timestamps.
- **AgentSession**: one connection episode of an agent — connect and
  disconnect times, disconnect reason, remote address, versions.
- **Enrollment token**: single-use, TTL-bound secret shown once; exchanged
  for the durable agent credential on first connect.
- **Agent credential**: durable bearer secret authenticating the stream
  endpoint; stored hashed; revocable.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: An admin can go from "no agents" to "agent deployed and shown
  connected" in under 15 minutes using only the UI-provided install command.
- **SC-002**: Agent connect/disconnect state is reflected in the UI within
  15 seconds on connect and within 90 seconds on silent loss.
- **SC-003**: 100% of lifecycle actions (create, enroll, rotate, revoke,
  delete) produce audit entries attributable to the actor; 0% of rejected
  connection attempts produce audit entries.
- **SC-004**: A revoked or deleted agent cannot establish a session — 100%
  of its connection attempts are rejected.
- **SC-005**: The agent survives hub restarts and network blips,
  reconnecting automatically without operator intervention.

## Assumptions

- Agents and hub are built from the same monorepo release; version parity is
  enforced at handshake rather than negotiated (ADR-116).
- Job dispatch, remote run execution, and `AGENT_MANAGED` credentials are
  explicitly out of scope — delivered by the follow-on specs
  (026-agent-managed-credentials, 027-remote-import-execution).
- `agent_sessions` is operational data, not append-only-audit — it carries
  no integrity-trigger requirements (ADR-100 amendment in ADR-116).
- The WebSocket channel is the only agent transport in v1; no long-poll
  fallback (documented limitation for WS-hostile proxies).
- Importer configs cannot yet be bound to agents in this spec — the
  `agentId` binding arrives with execution (027); the entity carries
  `allowedImporters` now so the capability model exists before enforcement.
- Agent status freshness in the UI is polling-based (~15 s refetch), not a
  frontend push channel.
