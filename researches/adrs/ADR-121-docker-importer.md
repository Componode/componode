# ADR-121 — Docker importer: agent-bound execution, target profiles, and workload identity

**Status**: Ratified (2026-11-01, spec 046)
**Supersedes**: none
**Amends**: ADR-056, ADR-065, ADR-116, ADR-117 (see "Amendments to earlier ADRs")

## Context

Wave C of the Docker importer program (`researches/docker-importer-spec-waves.md`)
ships `@componode/importer-docker` — the first adopter of the
`targetRefKey`/`resolveTarget` machinery ratified in ADR-116 A5/A6 and the
first importer that can never run in-process. Several contract surfaces
did not exist in ratified form: the typed profile schema, agent-binding
enforcement, credential-test target resolution, Docker scope keys, and
identity/externalId formats.

## Decision

1. **`@componode/importer-docker` package** — core-only deps +
   `dockerode`; registered in `IMPORTER_PACKAGES` and backend/agent
   dependency manifests in lockstep (ADR-065 A1). Manifest declares
   `reportsSourceIdentity: true`, `targetRefKey: "targetId"`, and
   `requiresAgent: true`.
2. **`ImporterManifest.requiresAgent?: boolean`** — when true, config
   create/update with `agentId: null` is rejected (`400 VALIDATION_FAILED`)
   and in-process dispatch is refused. Docker is the first (only) setter.
3. **`testSecrets(secrets, config?, resolvedTarget?)`** — third parameter
   carries the preflight-resolved `TargetProfile`; the agent's
   `handleCredentialTest` performs the same `targetRefKey` →
   `loadTargetProfile` preflight as `job.assign` and passes it through
   (fail-closed `TARGET_RESOLUTION_FAILED` on unknown/malformed/
   unprovisioned targets). No protocol change — `credential.test` already
   carries `scope`; profiles never cross the wire.
4. **Typed `docker-targets.json` profile schema** — four transports,
   validated importer-side before any network use (the core envelope
   stays provider-agnostic):
   - `socket`: `{path}` — absolute unix path or `//./pipe/` npipe.
   - `tcp`: `{host, port, caCertKey?, clientCertKey, clientKeyKey}` —
     verified mTLS; client cert+key required; `caCertKey` only for
     private CAs; no plaintext/skip-verify mode exists.
   - `ssh`: `{host, port?, user, hostKeySha256, privateKeyKey, passphraseKey?}`
     — `docker system dial-stdio`; SHA-256 host-key pin required; no
     password-only auth or implicit OpenSSH config.
   - `context`: `{name}` — allowlisted on-disk Docker Context on the
     agent; rejects `default`, `SkipTLSVerify`, and `ssh://` endpoints.
   `*Key` fields name `secrets` record keys resolved from AGENT_MANAGED
   refs (ADR-117) — profiles carry no key material.
5. **Scope keys** — `targetId` (required), `environmentLabel`,
   `environmentMap` (label value → `ENVIRONMENTS`, unmapped → `OTHER`),
   `componentIdLabel` (default `componode.component-id`),
   `includeImages` (default `false`), `sourceKey` (fallback identity).
6. **Identity/externalId formats**:
   - Source: `docker-engine:{/info.ID}`; `docker-engine:{sourceKey}` when
     the engine reports no ID; run fails otherwise.
   - Component (`CONTAINER`/`DOCKER`): `workload:{componentIdLabel}` |
     `compose:{project}:{service}` | `{sourceIdentity}::{containerName}` —
     never the mutable container ID.
   - Instance: `{sourceIdentity}::{containerId}`.
   - Image (opt-in, `PACKAGE_REGISTRY`/`DOCKER`, `instances: []`):
     `docker-image:{repo}@{digest-or-tag}`.
7. **Status mapping (Wave C)** — engine `State.Status` only:
   `running`→`RUNNING`, `created`/`paused`/`exited`→`STOPPED`,
   `dead`/`restarting`/`removing`/unknown→`ERROR`. Health-check results
   do not influence Wave C status; `dockerObservation` and health-aware
   rules are Wave D.
8. **Data minimization** — allowlisted persistence: image ref/digest,
   published ports, network/volume names, mount `{type, destination,
   opaqueRef}` (bind sources as `bind:{containerId}:{destination}` refs),
   bounded label subset, state/exit facts. Never: `Env`, raw bind paths,
   inspect JSON, health output/test commands, secret material.
9. **Deferred** — `dockerObservation` + health-aware status + Source UI +
   tag suggestions (Wave D); Swarm (Wave E); `ssh://` context endpoints.

## Amendments to earlier ADRs

- **ADR-056** (importer contract): `testSecrets` gains the optional
  `resolvedTarget` parameter (item 3).
- **ADR-065** (package boundaries): `@componode/importer-docker` joins
  the in-tree lockstep set — anticipated by Amendment 1; now concrete.
- **ADR-116** (remote agents): first `targetRefKey`/`resolveTarget`
  adopter landed; typed docker profile schema ratified here (item 4);
  credential-test path performs target preflight (item 3).
- **ADR-117** (agent-managed credentials): profile `*Key` indirection
  composes AGENT_MANAGED refs with target profiles (item 4).

## Amendment 1 — Health-aware status and `dockerObservation` (spec 047)

Wave D replaces item 7's engine-state-only rule and extends item 8's
allowlist:

1. **`rawConfig.dockerObservation`** — each Instance persists an
   allowlisted snapshot: `state`, `exitCode` (non-zero only),
   `oomKilled`/`restarting` (true only), `startedAt`/`finishedAt`
   (Docker zero-time → `null`), and `health` = `{status, failingStreak?}`
   or `null` when no health check is configured (`"none"` → `null`).
   Still never: `/stats`, events, `Health.Log` (check output),
   `Config.Healthcheck.Test` (test command), full inspect JSON, history.
   The allowlisted fields render on the component detail's Instances
   table — no Docker-specific monitoring page.
2. **State × health → `InstanceStatus`** — `running` → `RUNNING` unless
   `Health.Status == "unhealthy"` (`ERROR`); `starting` health is
   inconclusive (`RUNNING`); `OOMKilled` overrides any state to `ERROR`
   (including `exited`); `created`/`paused`/`exited` → `STOPPED`;
   `dead`/`restarting`/`removing`/unknown/`undefined` → `ERROR`; absent
   from a completed run → `GONE` via unchanged source-scoped
   reconciliation. Non-zero `exitCode` alone does not escalate `exited`.
   ADR-112 derived product health consumes the emitted status — no
   rollup changes.
3. **Generic ImporterSource UI + tag suggestions** — `/sources` +
   `/sources/:id` surfaces on the existing API (no contract change);
   `compose:<project>`/`service:<project>.<service>` edit-dialog
   suggestions are user-confirmed, grammar-filtered derivations — no
   contract surface, recorded here for provenance only.
4. Item 9's deferred list shrinks: Swarm (Wave E) and `ssh://` context
   endpoints remain.
