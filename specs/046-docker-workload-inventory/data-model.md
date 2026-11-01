# Phase 1 Data Model: Docker Workload Inventory

**Feature**: `046-docker-workload-inventory` | **Date**: 2026-11-01

No new tables — the feature reuses `importer_configs` (+ `agentId`),
`importer_sources`, `source_component_memberships`,
`source_instance_memberships`, `import_runs`, `components`,
`component_instances`, and `credentials` (AGENT_MANAGED). New persisted
shapes are config scope, registry profiles (agent-local file), and
asset payloads.

## Importer config scope (`importer_configs.scope`)

| Key | Type | Required | Notes |
|---|---|---|---|
| `targetId` | string (1–200) | yes | Names a profile in the Agent's `docker-targets.json`; `manifest.targetRefKey = "targetId"` |
| `environmentLabel` | string | no | Container/Compose label key read for environment mapping |
| `environmentMap` | record(string → ENVIRONMENTS) | no | Label value → Componode environment; unmapped → `OTHER` |
| `includeImages` | boolean | no (default `false`) | Opt-in local image inventory |
| `sourceKey` | string | no | Admin fallback source identity when `/info.ID` is unavailable |

Zod `.strict()` — unknown keys rejected at the route boundary (ADR-095).
The schema-driven form renders `targetId`/`environmentLabel`/`sourceKey`
as text, `includeImages` as boolean, `environmentMap` as a JSON editor —
no custom widgets.

## Agent-local target profile (`${SECRETS_DIR}/docker-targets.json`)

Envelope (already ratified, ADR-116 A6):
`{ "version": 1, "targets": { "<targetId>": <profile> } }` — the file's
contents are the complete allowlist; `targetId`s are immutable.

Typed profiles (new — validated importer-side, ratified in ADR-121):

| `transport` | Fields | Secret sources |
|---|---|---|
| `socket` | `path` (unix socket or `//./pipe/...` npipe) | none |
| `tcp` | `host`, `port`, `caCertKey?`, `clientCertKey`, `clientKeyKey` | `*Key` fields name `secrets` record keys resolved from AGENT_MANAGED refs; `caCertKey` optional only for public/system-CA daemons |
| `ssh` | `host`, `port` (default 22), `user`, `hostKeySha256`, `privateKeyKey`, `passphraseKey?` | key material via AGENT_MANAGED; pin is non-secret profile data |
| `context` | `name` | TLS files live in the Agent's context store — no `secrets` keys |

Non-secret values only — a profile never embeds key material; it names
secret keys. Validation rejects: unknown transports, plaintext hints,
`hostKeySha256` absent on `ssh`, `clientCertKey`/`clientKeyKey` absent on
`tcp`, `default`/`SkipTLSVerify` on `context`.

## Catalog mapping

| Docker fact | Componode target |
|---|---|
| Engine `/info.ID` | `ImporterSource.externalIdentity` = `docker-engine:{ID}`; `/info.Name` → `label` |
| Compose workload | `CONTAINER`/`DOCKER` Component; `externalId` = `compose:{project}:{service}` or `workload:{componode.component-id}` |
| Standalone container | `CONTAINER`/`DOCKER` Component; `externalId` = `{sourceIdentity}::{containerName}` |
| Concrete container | `ComponentInstance`; `externalId` = `{sourceIdentity}::{containerId}`; `environment` from configured label → map → `OTHER`; `status` from engine state |
| Cached image (opt-in) | `PACKAGE_REGISTRY`/`DOCKER` Component, `instances: []`; `externalId` = `docker-image:{repo}@{digest}` (`:{tag}` when digest absent) |

### Per-field persistence (allowlist — FR-012)

| Location | Contents |
|---|---|
| `asset.details` (canonical, shared) | `workloadKind` (`compose`\|`standalone`\|`override`), `composeProject`, `composeService`, `workloadId` when overridden, `imageRef` |
| `asset.sourceDetails` (per-source membership) | per-target compose labels, container names seen, restart policy name, network names — facts that may differ per environment |
| `instance.details` | `imageDigest`, `imageRef`, `containerName`, `state`, `exitCode?`, `startedAt?` |
| `instance.rawConfig` | allowlisted snapshot: `ports` (published), `networks` (names), `mounts` (`{type, destination, ref}` — bind sources rendered as opaque `bind:{instanceId}:{destination}` refs, never raw paths), `restartPolicy` |
| `instance.sourceDetails` | per-source container name/labels that differ per environment |
| logs / errors | key names and source types only — never values (existing scrubbing applies) |

**Never persisted**: container `Env`/`Config.Env`, `HostConfig` wholesale,
raw bind `Source` paths, `State.Health` output or `Healthcheck.Test`
commands, full inspect JSON, image config env.

### Status mapping (Wave C — engine state only)

| `State.Status` | `ComponentInstance.status` |
|---|---|
| `running` | `RUNNING` |
| `created`, `paused`, `exited` | `STOPPED` |
| `dead`, `restarting`, `removing` | `ERROR` |
| anything else | `ERROR` (fail closed) |

Health-check results do not influence Wave C status (clarified
2026-11-01); `dockerObservation` payload + health-aware rules = Wave D.

## Reconciliation semantics (inherited — no new logic)

- Run reports `docker-engine:{id}` → ImporterSource registered/matched
  (ADR-119); `import_runs.sourceId` attributed.
- Completed run retires only this Source's absent memberships; shared
  workload Components stay `ACTIVE` while any Source reports them.
- Config deletion → `configId` `NULL`, Source `UNMONITORED`, history
  preserved (ADR-047 A1).
- Any failed authoritative call (list/inspect/images-when-enabled)
  aborts the run → no retirement (ADR-036 A1).

## New contract shapes (not DB)

- `ImporterManifest.requiresAgent?: boolean` — backend enforcement flag.
- `testSecrets(secrets, config?, resolvedTarget?)` — third parameter
  receives the preflight-resolved `TargetProfile` on agents.
- `environmentMap` values constrained to `ENVIRONMENTS` enum.

## Validation rules

- `targetId` must be non-empty when present in scope (hub jobGate +
  agent preflight already enforce `targetRefKey` shape).
- `environmentMap` values must be members of `ENVIRONMENTS`; keys are
  label values matched verbatim.
- `sourceKey` non-empty when present; used only when `/info.ID` is
  absent — engine ID always wins when available.
