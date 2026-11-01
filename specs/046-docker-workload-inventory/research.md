# Phase 0 Research: Docker Workload Inventory

**Feature**: `046-docker-workload-inventory` | **Date**: 2026-11-01

Resolves every open decision in the spec/plan Technical Context. Design
inputs already approved upstream: `researches/docker-importer-research.md`
(Docker API facts), `researches/docker-importer-plan.md` (confirmed
directions), `researches/docker-importer-scenarios.md` (acceptance
scenarios), ratified ADR-116 A5/A6 + ADR-117 + ADR-119 + ADR-065 A1.

## Decision 1 — Engine client: `dockerode@^5.0.1`

**Decision**: Pin `dockerode@^5.0.1` (published 2026-06-24 — well past
the 7-day vetting window; Apache-2.0; 0 known vulnerabilities; ~13M
weekly downloads). It brings `docker-modem@^5.x` and `ssh2@^1.x`
transitively; no direct `ssh2` dependency needed.

**Rationale**: Approved upstream in `docker-importer-research.md` as the
selected Node.js client baseline; the research gate required pinning an
actual release and verifying transport behaviors — done below.

- Socket/named pipe → `socketPath` (`/var/run/docker.sock`,
  `~/.docker/run/docker.sock`, `//./pipe/docker_engine` — all natively
  supported, including Windows `npipe` paths).
- mTLS TCP → `protocol: 'https'`, `host`, `port`, `ca`, `cert`, `key`,
  `checkServerIdentity` — full server verification; we never set a
  skip-verify path (there is no opt-out in our builder).
- SSH → `protocol: 'ssh'` uses docker-modem's built-in agent which execs
  `docker system dial-stdio` over ssh2; `sshOptions` are merged verbatim
  into `ssh2.connect()`, so we supply `privateKey`, `passphrase`,
  `username`, `host`, `port`, and critically `hostVerifier` for the
  SHA-256 host-key pin — ssh2 calls `hostVerifier(hash)` where `hash` is
  the hex md5/sha256 depending on `hostHash` option (`'sha256'` gives us
  hex SHA-256). Fail-closed: no pin → profile invalid before connecting.
- AbortSignal → docker-modem passes `options.abortSignal` into the HTTP
  request (`signal` option); long inspect loops also check
  `context.signal` between calls.

**Alternatives considered**: official Docker SDKs (Go/Python — wrong
language); raw `undici`/`node:http` client (re-implements pagination,
hijack semantics, modem edge cases for no gain); the `ssh2`-direct
dial-stdio stream + custom `http.Agent` (what docker-modem already does —
would duplicate it).

## Decision 2 — Named Docker Context resolution

**Decision**: Importer-local resolver inside `packages/importer-docker`.
A `context` profile names an allowlisted on-disk context; the importer
reads the Docker CLI context store on the Agent host
(`$DOCKER_CONFIG/contexts/meta/<sha256(name)>/meta.json`, falling back to
`~/.docker/contexts/meta/`), extracts `Endpoints.docker.Host`, and builds
dockerode options from it. `default` (in-memory) and any context with
`SkipTLSVerify: true` are rejected. TLS material resolves under
`$DOCKER_CONFIG/contexts/tls/<contextName>/docker/` (`ca.pem`,
`cert.pem`, `key.pem`).

**Boundary**: Wave C supports `unix`/`npipe`/`tcp` context endpoints
(with mTLS for `tcp`). `ssh://` context endpoints are **rejected** —
implicit OpenSSH config/agent resolution is exactly what the pinned-SSH
profile exists to replace; guide documents using a direct `ssh` profile
instead.

**Alternatives considered**: shelling out to `docker context inspect`
(requires Docker CLI on the Agent — the agent image doesn't ship it);
supporting ssh contexts via `SSH_AUTH_SOCK` agent forwarding (expands the
trust surface and contradicts the "no implicit OpenSSH config" rule from
the direct-SSH mode); putting the resolver in `packages/agent` (violates
ADR-065 — importers own provider specifics; the agent stays
provider-agnostic per ADR-116 A5).

## Decision 3 — Agent-binding enforcement: `requiresAgent` manifest flag

**Decision**: Add `requiresAgent?: boolean` to `ImporterManifest`
(packages/core). When set, `importer-config-service` rejects
create/update with `agentId: null` (400 `VALIDATION`), and the run
service refuses in-process dispatch for defense in depth. Docker's
manifest sets it — it is the only importer that requires an agent.

**Rationale**: A name check (`if importerName === "docker"`) in backend
code hardcodes a catalog fact into the service layer; the manifest flag
keeps the rule generic for future agent-only importers and lets the
frontend later surface "requires agent" hints. Frontend needs no change —
the Execution selector exists and backend validation returns a normal
error.

**Alternatives considered**: config-schema-level sentinel (scope field
`execution: "agent"` — duplicates `agentId`, worse); silent dispatch to
agent when set (hides config errors); importer-side throw at run() start
(too late — the config exists and runs fail repeatedly).

## Decision 4 — `testSecrets` target resolution

**Decision**: Extend the contract — `testSecrets(secrets, config?,
resolvedTarget?)`. `handleCredentialTest` (packages/agent/client.ts)
reads the manifest's `targetRefKey`, performs the same
`loadTargetProfile` preflight as `job.assign`, and passes the resolved
profile as the third argument. Importers without `targetRefKey` are
unaffected (parameter stays `undefined`); in-process `testSecrets`
callers pass nothing.

**Rationale**: The remote credential-test payload already carries `scope`
(protocol schema unchanged — no protocol version bump). The only missing
link was the resolved profile. Passing it through the existing function
signature is the smallest correct change; the preflight failure reuses
`TARGET_RESOLUTION_FAILED`-style non-secret messages mapped to `{ok:false}`.

**Alternatives considered**: stuffing the profile into `scope` agent-side
(corrupts the hub-owned scope shape); letting the importer read
`docker-targets.json` itself (duplicates `loadTargetProfile`, bypasses
the sanctioned `resolveTarget` boundary, needs `SECRETS_DIR` plumbing the
contract doesn't provide); new `testTargetSecrets` hook (bigger surface
for the same job).

## Decision 5 — Typed `docker-targets.json` profile schema

**Decision**: The importer validates the resolved profile against a
typed Zod schema before any network use — inside `run()` (before client
construction) and inside `testSecrets`. Transports: `socket` ({path}),
`tcp` ({host, port, ca?}), `ssh` ({host, port, user, hostKeySha256}),
`context` ({name}). Full schema in `contracts/docker-target-profiles.md`.

**Rationale**: The core `parseTargetRegistry` envelope is deliberately
loose (provider-agnostic, ADR-116 A6); transport-specific fields are the
importing importer's contract. Validation still happens **before network
access** (FR-004), which is the security guarantee — the agent's
allowlist check rejects unknown IDs at preflight, and the typed check
rejects malformed/forbidden fields at client construction.

**Alternatives considered**: `targetProfileSchema` on the manifest so
the agent validates typed profiles at preflight (bigger contract change;
provider-specific schema in the generic agent path — rejected); trusting
the envelope (insufficient — a `tcp` profile without certs must fail).

## Decision 6 — Config scope shape

**Decision**:

```jsonc
{
  "targetId": "prod-docker-1",              // required — manifest.targetRefKey = "targetId"
  "environmentLabel": "com.componode.env",  // optional — container/compose label key
  "environmentMap": {                       // optional — label value → ENVIRONMENTS value
    "prod": "PRODUCTION", "dev": "DEVELOPMENT"
  },
  "includeImages": false,                   // optional — opt-in local image inventory
  "sourceKey": "prod-docker-1"              // optional — admin fallback source identity
}
```

`environmentLabel` + `environmentMap` are used together; a label value
absent from the map (or no label configured) → `OTHER`. Compose
`com.docker.compose.project`/`service` are read automatically for
grouping/metadata — not configurable.

**Rationale**: Matches `docker-importer-plan.md` ("explicitly configured
environment label key/value mapping; mapping shape makes clear which
labels are keys and which values map to Componode environments") and the
wave-B `sourceKey` precedent (ADR-120) for the admin fallback.

## Decision 7 — Identity & externalId formats

**Decision**:

| Object | externalId / identity | Notes |
|---|---|---|
| ImporterSource | `docker-engine:{/info.ID}` | Fallback `docker-engine:{sourceKey}` when `/info.ID` absent — never display name; label = `/info.Name` |
| Compose workload Component | `compose:{project}:{service}` | Project/service normalized to the compose-label values verbatim (they're already slug-safe); `componode.component-id` label overrides → `workload:{value}` |
| Standalone Component | `{sourceIdentity}::{containerName}` | Container **name** (leading `/` stripped), not ID — survives rebuilds but not renames |
| ComponentInstance | `{sourceIdentity}::{containerId}` | Daemon-scoped; rebuild → new instance |
| Image (opt-in) | `docker-image:{repo}@{digest}` or `docker-image:{repo}:{tag}` when no digest | Canonical — shared across sources via memberships |

**Rationale**: Compose/override keys deliberately omit daemon identity so
environments share one Component (scenarios 1–4); standalone fallback is
daemon-qualified because bare names collide across hosts. This mirrors
the wave-B `{identity}::{id}` qualification precedent (ADR-120).

## Decision 8 — Status mapping (Wave C)

**Decision** (clarified in spec session 2026-11-01): engine `State.Status`
only — `running`→`RUNNING`; `created`, `paused`, `exited`→`STOPPED`;
`dead`, `restarting`, `removing`→`ERROR`; unrecognized→`ERROR` (fail
closed). `State.Health` is ignored entirely in Wave C — the
`dockerObservation` payload and health-aware mapping are Wave D.

## Decision 9 — Inventory algorithm

**Decision**: `GET /version` (negotiate: use server's `ApiVersion` clamped
to [advertised `MinAPIVersion`, max we need]) → `GET /info` (source
identity `ID`, label `Name`, Swarm state for logging) → report source →
`GET /containers/json?all=1` (running+stopped) → bounded-concurrency
`GET /containers/{id}/json` inspect (default 8, needed for mounts/
network details/RepoDigests) → optional `GET /images/json` when
`includeImages`. One `DiscoveredAsset` per logical workload containing
all its container Instances; one per image when enabled.

Incomplete-inventory rule: any failed list/inspect call aborts the run —
no partial snapshot may trigger retirement (FR-015).

## Decision 10 — Package dependencies & lockstep

**Decision**: `packages/importer-docker/package.json` deps:
`@componode/core` (workspace), `dockerode@^5.0.1`; dev: types, vitest.
Registered in `IMPORTER_PACKAGES` (core), backend `package.json` +
`pnpm-workspace`/lockstep agent `package.json` — the agent handshake
(`hello` importer list) must carry exactly the hub's set (ADR-116 #7):
all three packages import the new manifest in lockstep.

## Contract surface ratified in ADR-121 (same change)

- `docker-targets.json` typed profile schema per transport
- `ImporterManifest.requiresAgent` + enforcement behavior
- `testSecrets(secrets, config?, resolvedTarget?)` signature
- Docker scope keys (`targetId`, `environmentLabel`, `environmentMap`,
  `includeImages`, `sourceKey`)
- Identity/externalId formats (Decision 7) + status rules (Decision 8)
- Data-minimization allowlist (see `contracts/identity-and-mapping.md`)
- Back-pointers: ADR-056 (importer contract additions), ADR-065
  (lockstep set gains member — already anticipated by Amendment 1),
  ADR-116 (first `targetRefKey`/`resolveTarget` adopter, context
  transport boundary), ADR-117 (credential-test target resolution).

## Open items deliberately deferred

- `dockerObservation` payload + health-aware status (Wave D)
- Source list/detail UI, `compose:`/`service:` tag suggestions (Wave D)
- Swarm services/nodes/secrets (Wave E)
- ssh:// Docker Context endpoints (guide documents `ssh` profiles)
- Image→workload provenance edges (v2 candidate-edge feature)
