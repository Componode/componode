# Docker Importer Hub Execution Research

**Status:** Research only. Grilling completed and design accepted on
2026-11-01. This remains informative input, not an ADR, feature specification,
implementation plan, or executable tasks. The execution handoff is tracked in
[`docker-importer-implementation-tracking.md`](./docker-importer-implementation-tracking.md)
Phase 6.

## Purpose

Research what must change to let the existing Docker importer execute either
inside the hub backend or on an Import Agent. The requested change was from
the ratified Agent-only rule. This memo records the evidence and initial
trade-offs; the accepted product/security decisions are summarized in Phase 6
of the implementation-tracking handoff.

## Scope

This is a repository architecture and implementation-path review. It covers
ADRs, runtime execution, persisted data, APIs, screens, deployment, security,
and the Docker-specific specifications. It does not change source code,
specifications, ADRs, API docs, deployment files, or UX-gap records.

## Bottom Line

The hub already has a general in-process importer path, and `agentId: null`
already means that a config/run executes in the hub. Docker is blocked from
that path by an explicit manifest flag and server-side checks. Removing that
flag alone will not work: the in-process `ImporterContext.resolveTarget` is a
throwing stub, and hub-side credential tests do not resolve or pass a target
profile.

The smallest coherent architecture appears to be executor-local target
preflight: retain `targetId` in scope and the existing typed Docker profile,
but allow the chosen executor (hub or Agent) to resolve it against its own
read-only allowlist before calling the importer. Hub execution would use the
existing `STORED` credential path; Agent execution would keep
`AGENT_MANAGED` references. This can avoid database and endpoint-schema
changes if target profiles remain deployment-provisioned files.

The material product/security decision is not the importer mapping; it is
what the hub may reach and how hub-side targets are provisioned. The project
does not currently mount the Docker socket into the hub, provide a hub target
registry, or provide UI/API management for target profiles. Docker socket
access is highly privileged, so the hub mode must not imply that the default
Compose deployment should mount the host socket.

## Current Ratified and Implemented Baseline

| Surface | Current behavior | Evidence |
|---|---|---|
| Docker policy | Docker's manifest says it runs through an Agent and sets `requiresAgent: true`; ADR-121 says configs without an Agent are rejected and in-process dispatch is refused. | [Docker manifest](../packages/importer-docker/src/manifest.ts#L6-L16); [ADR-121, decisions 1-2](adrs/ADR-121-docker-importer.md#L19-L27) |
| Hub execution | `agentId: null` is already the in-process Hub selector. The backend runs all unbound importers through its worker, but Docker's `requiresAgent` guard rejects that path. | [Importer config schema](../packages/core/src/schemas/importer-config.ts#L12-L39); [run dispatch](../packages/backend/src/services/import-run-service.ts#L1117-L1123) and [agent requirement gate](../packages/backend/src/services/import-run-service.ts#L1160-L1182) |
| Target resolution | Agent jobs load `${SECRETS_DIR}/{importerName}-targets.json`, validate `targetId`, and resolve the profile before the importer runs. The in-process context always throws from `resolveTarget`. | [Agent target registry](../packages/agent/src/target-registry.ts#L19-L47); [Hub importer context](../packages/backend/src/services/import-run-service.ts#L957-L962); [ADR-116 Amendments 5-6](adrs/ADR-116-remote-import-agents.md#L417-L494) |
| Docker transport | Docker has typed `socket`, mTLS `tcp`, pinned-host-key `ssh`, and named `context` profiles. The importer maps profile key names to the executor-provided `secrets` record. | [Docker profile schema](../packages/importer-docker/src/target-profile.ts#L3-L78); [transport construction](../packages/importer-docker/src/transport.ts#L18-L74) |
| Credentials | Hub-bound configs use hub-resolved `STORED` credentials; Agent-bound configs use `AGENT_MANAGED` credentials. The backend enforces this pair in config validation. | [Config credential validation](../packages/backend/src/services/importer-config-service.ts#L20-L88); [frontend credential filtering](../packages/frontend/src/ux/components/importers/importer-form.tsx#L352-L357); [ADR-117](adrs/ADR-117-agent-managed-credentials.md#L18-L41) |
| Source identity and reconciliation | Docker reports `docker-engine:{/info.ID}` before assets. `ImporterSource` identity is provider identity, not target ID or executor identity; reconciliation is source-scoped. | [Docker importer run](../packages/importer-docker/src/importer.ts#L47-L72); [ImporterSource contract](../packages/core/src/contracts/importer-source.ts#L4-L33); [ADR-119](adrs/ADR-119-importer-source-identity-and-lifecycle.md#L21-L70) |
| Data model | Docker's current data model adds no tables: it reuses importer config/run/source/membership and catalog records. Target profiles are currently an Agent-local file. | [spec 046 data model](../specs/046-docker-workload-inventory/data-model.md#L1-L45); [run executor column](../packages/backend/src/db/migrations/018_remote_run_agent.ts#L3-L23) |
| API shape | Config create/update already carry nullable `agentId`; scope already carries `targetId`. No target-profile CRUD API exists. | [OpenAPI importer config](../docs/openapi.yaml#L737-L880); [API routes](../packages/backend/src/routes/importers.ts#L1-L60) |
| UX | The config form already has an Execution selector with Hub and Agents. It disables Hub for `requiresAgent` manifests and auto-selects an Agent when one is available. It has a schema-rendered text field for `targetId`, not a target picker. | [Importer form selector](../packages/frontend/src/ux/components/importers/importer-form.tsx#L121-L128) and [selection behavior](../packages/frontend/src/ux/components/importers/importer-form.tsx#L470-L545) |
| Source/UI model | Importer run details already show whether a run was in-process on the Hub or ran on an Agent. Docker's health/source UI and Swarm inventory are described as later waves but already have dedicated specs/ADRs. | [run detail executor](../packages/frontend/src/ux/components/importers/run-detail.tsx#L176-L197); [ADR-121 Amendments 1-2](adrs/ADR-121-docker-importer.md#L86-L153) |

The agent-only behavior is repeated in current implementation artifacts, not
only in the user guide: spec 046 rejects unbound Docker configs, its data model
calls the profile Agent-local, and spec 048 says Swarm discovery is for
agent-bound endpoints. The shipped Docker guide also says every config runs
on an Agent. These artifacts must be revised as part of a future feature; the
research memo does not supersede them. See [spec 046 scenarios
and requirements](../specs/046-docker-workload-inventory/spec.md#L28-L47),
[spec 046 data model](../specs/046-docker-workload-inventory/data-model.md#L12-L45),
[spec 048 requirements](../specs/048-docker-swarm-inventory/spec.md#L108-L147),
and [Docker setup guide](../docs/importers/docker.md#L83-L112).

## Likely Execution Model

### Keep the Existing Executor Selector

The existing nullable `agentId` expresses the needed choice:

- `agentId: null`: execute Docker in the Hub's in-process worker.
- `agentId: <id>`: dispatch to that Import Agent.

`import_runs.agentId` is already nullable and records which Agent executed a
run; null is the in-process case. There is no evident need for a new
`executionMode` column or run field solely to represent this choice. Preserve
the existing `requiresAgent` capability for any future importer that truly
cannot execute in the Hub; Docker would stop declaring it. Do not remove the
generic enforcement mechanism just to enable Docker. [Core manifest
contract](../packages/core/src/importer-registry.ts#L1-L32);
[run schema migration](../packages/backend/src/db/migrations/018_remote_run_agent.ts#L3-L23).

### Resolve Profiles on the Selected Executor

A `targetId` must remain an opaque selector, not an arbitrary endpoint or
credential value submitted through importer scope. A likely minimal design:

1. Provision a versioned, read-only target registry for the Hub runtime as
   well as the existing Agent-local registry. The registry contents remain
   the allowlist; `targetId` remains immutable and distinct from Source and
   Component identity.
2. Load and validate the profile before any Docker network access, both for a
   run and a credential test. Fail closed for a missing registry, unknown ID,
   malformed profile, or transport policy violation.
3. Make `ImporterContext.resolveTarget` return the selected executor's
   preflight-resolved profile. The Docker importer and its four transport
   mappings can then remain executor-agnostic.
4. Resolve profile `*Key` values from that executor's `secrets` record:
   hub `STORED` values for Hub execution; Agent-local references for Agent
   execution. Do not put private key/certificate bytes in the profile or
   send them over the Agent wire protocol.

The Agent already uses `SECRETS_DIR` for its target registry. The backend
also uses `SECRETS_DIR` to find the credential-encryption master-key file.
That may be a suitable shared mount location for a Hub registry, but the
registry path and mount policy need an explicit decision; do not assume that
an Agent's registry is shared with the Hub. [Agent registry path](../packages/agent/src/target-registry.ts#L9-L17);
[backend keyring path](../packages/backend/src/utils/credential-crypto.ts#L119-L140).

This extends the current Agent-only reading of ADR-116's target registry.
ADR-056 Amendment 1 already describes a resolver validated by the executor
("hub or Agent"), but Amendment 2 and ADR-116 Amendments 5-6 explicitly narrow
target resolution to the Agent. ADR-121 then makes Docker the Agent-only
adopter. The new design must reconcile those statements rather than treating
the broad wording in ADR-056 as already-implemented Hub support. [ADR-056
Amendments 1-2](adrs/ADR-056-importer-interface-signature.md#L27-L78);
[ADR-116 target registry](adrs/ADR-116-remote-import-agents.md#L417-L494);
[ADR-121](adrs/ADR-121-docker-importer.md#L19-L47).

### Profile Provisioning Alternatives

| Option | Scope and trade-off |
|---|---|
| Executor-local files | Keep deployment-owned allowlists and the current `targetId` scope. Add a Hub-side file path/loading mechanism; no target table or CRUD API. Low product/API scope, but operators must provision profiles separately on the Hub and Agent and keep their IDs/configuration aligned. |
| Hub-local Docker only | Offer only a fixed local socket target (or a narrowly configured local target). Lower network/credential scope, but does not meet a broader interpretation of "Hub can import any Docker target" and still requires a deliberate socket mount. |
| Hub-managed target UI/API | Store Hub targets and expose create/read/update/delete plus allowlist validation, role checks, auditing, and a target picker. Better discoverability, but adds a new data model, migration, API/OpenAPI contract, authorization, UX, lifecycle, and secret-reference decisions. If this is required, it is a new backend capability and must follow the repo's UX-gap governance rather than being faked in the form. |

The research supports choosing the provisioning model in the grilling session.
Avoid placing host/URL/port/cert material directly in `scope`: that would
turn a config form into a route-selection authority and bypass the
executor-side allowlist boundary.

## Impact by Surface

| Surface | Likely change if profiles remain deployment-provisioned | Decision or caveat |
|---|---|---|
| ADR-121 | Amend the Docker `requiresAgent` decision; specify both supported executors, Hub target preflight, credential-test preflight, where each registry is provisioned, and which transports are supported in Hub mode. Keep asset identity, lifecycle, status, minimization, and Swarm mappings unchanged unless execution changes their behavior. | Directly changes the core ratified decision. |
| ADR-056 | Amend the in-process `resolveTarget` stub rule and the `resolvedTarget` note on `testSecrets` to include Hub execution. | Must define fail-closed behavior and make the executor boundary explicit. |
| ADR-116 | Amend its Agent-only registry language to define the Hub-local path while retaining Agent preflight and the existing wire protocol. | No protocol change appears necessary: remote jobs already carry scope and resolve profiles locally on the Agent. |
| ADR-117 | Probably no behavior change if Hub configs keep using `STORED` credentials and Agent configs keep using `AGENT_MANAGED`. Update the ADR only if the credential-kind boundary or references crossing the wire are changed. | Docker profile `*Key` fields currently name keys supplied through Agent-managed credentials in ADR-121. |
| ADR-098 | Reassess the trust boundary for importing against a Docker daemon from the backend process. The ADR defers process sandboxing; explicit Hub socket/egress access is a privileged capability, not a harmless transport detail. | The Hub contains backend process environment and credentials. Hub target access must be deployer-controlled and narrowly allowlisted. |
| ADR-028 | Only amend if the supported default Compose deployment is changed to mount a Docker socket or otherwise exposes Hub Docker access by default. | Current Compose `app` has no Docker socket or Docker target volume. Do not silently add a default host socket mount. |
| ADR-022 | No new execution architecture appears necessary if Hub mode uses the existing in-process worker; Agent remains the optional remote executor. | This relies on preserving the existing scheduled/on-demand Hub path. |
| ADR-065 | No apparent dependency-graph amendment: Docker importer is already in the lockstep set and the backend and Agent both compile the importer. | Preserve importer/core boundary and Agent lockstep handshake. |
| ADR-119 / ADR-120 | No apparent domain-model change: source identity comes from Docker `/info.ID`, not `targetId` or executor. | Add cross-executor source-sharing and target-switch scenarios to tests. |
| ADR-104 / API docs | Update OpenAPI descriptions and generated API docs if behavior/semantics are changed, even if request/response shapes stay the same. New target CRUD endpoints require full API contract and permission coverage. | Endpoint presence and JSON payloads may remain unchanged in the file-provisioned option. |
| User docs / deployment | Update the Docker setup guide and any deployment instructions for Hub-side target files, credentials, supported transports, and optional socket mounts. | Keep Agent provisioning instructions for remote execution; do not imply the Hub socket is available by default. |
| ADR index and back-pointers | Update the ADR index, amends lists, and `**Amended by ADR-XXX**` links for every ratified contract amended. | Required by repository ADR fidelity rules. |

ADR source references: [ADR-121](adrs/ADR-121-docker-importer.md#L19-L85);
[ADR-056](adrs/ADR-056-importer-interface-signature.md#L27-L78);
[ADR-116](adrs/ADR-116-remote-import-agents.md#L417-L494);
[ADR-117](adrs/ADR-117-agent-managed-credentials.md#L18-L70);
[ADR-098](adrs/ADR-098-importer-sandboxing.md#L5-L25);
[ADR-028](adrs/ADR-028-deployment-docker-compose-only-for-v1.md#L18-L28);
[ADR-022](adrs/ADR-022-importer-execution-scheduled-on-demand.md);
[ADR-065](adrs/ADR-065-package-dependency-graph.md#L7-L39);
[ADR-119](adrs/ADR-119-importer-source-identity-and-lifecycle.md#L21-L70);
[ADR-104](adrs/ADR-104-api-documentation-sync.md).

## Data Model

### No New Database Model Is Evident for File-Provisioned Profiles

The existing `ImporterConfig.agentId` and `ImportRun.agentId` represent Hub
versus Agent execution. The importer scope already stores `targetId` and
Docker options. `ImporterSource`, run history, source memberships,
Components, and ComponentInstances remain execution-location agnostic.
Therefore no table, migration, entity, or new config/run column appears
necessary if Hub profiles live outside the database. [Importer config
contract](../packages/core/src/contracts/importer-config.ts#L1-L26);
[DB types](../packages/backend/src/db/types.ts#L160-L173) and
[ImportRun fields](../packages/backend/src/db/types.ts#L248-L260);
[Docker data model](../specs/046-docker-workload-inventory/data-model.md#L1-L45).

The data-model artifact must still be updated: its `targetId` description,
target-profile ownership, and profile credential sources currently say
"Agent-local" / `AGENT_MANAGED`. If database-managed Hub targets are chosen,
the no-new-table conclusion no longer applies.

### Credential Compatibility

Execution and credential kind are already coupled by server-side validation:
Hub requires hub-resolvable credential material; Agent-bound configs require
Agent-managed references. An existing Docker config can remain Agent-bound
without migration. Switching an existing config from Agent to Hub while it
still links an `AGENT_MANAGED` credential should fail under current rules;
operators would need to unlink it, and provision a `STORED` credential if
the selected Hub transport needs secret material. Socket/context-only
setups may not need a credential. Do not silently convert, copy, or expose
secret values between credential kinds.
[Credential-kind validation](../packages/backend/src/services/importer-config-service.ts#L20-L88)
and [update revalidation](../packages/backend/src/services/importer-config-service.ts#L427-L454).

The target profile's `*Key` fields are strings naming keys in the importer
`secrets` object. Reusing that contract for Hub therefore looks compatible
with `STORED` credentials; the profile itself can remain secret-free. The
current ADR-121 text specifically says the references are resolved from
`AGENT_MANAGED` refs, so that statement needs refinement if the same profile
schema is to work in both modes. [ADR-121 profile rules](adrs/ADR-121-docker-importer.md#L34-L47);
[Docker transport secret lookup](../packages/importer-docker/src/transport.ts#L18-L74).

## API and Run Behavior

### Likely No New Endpoint for File-Based Profiles

- `POST`/`PATCH /api/v1/importer-configs` already carry `agentId`, and
  `null` already denotes in-process Hub execution. `targetId` remains a
  normal Docker scope field.
- Run creation already stores the selected `agentId`, then chooses the
  remote dispatcher or Hub worker.
- `GET /api/v1/importers` already returns importer manifests to the form,
  including the `requiresAgent` capability used by the UI.
- `POST /api/v1/credentials/{id}/test` already carries importer scope. Its
  Hub `STORED` path currently calls `testSecrets` without a resolved target;
  this path must preflight `targetId` and pass the resolved profile just as
  the Agent credential-test path does.

So the file-profile option likely requires behavioral changes and OpenAPI
description updates, not new endpoint shapes. The target-test path is the
important omission: simply permitting `agentId: null` will make both runs and
credential tests fail on the in-process target stub / absent target profile.
[Config API contract](../docs/openapi.yaml#L737-L880);
[credential-test contract](../docs/openapi.yaml#L904-L942);
[Hub credential-test implementation](../packages/backend/src/services/credential-service.ts#L219-L270)
and [current in-process call](../packages/backend/src/services/credential-service.ts#L414-L445);
[Agent target test preflight](../packages/agent/src/client.ts#L148-L170).

### Preflight and Failure Semantics

The Agent already rejects unknown/malformed profiles before network access
with `TARGET_RESOLUTION_FAILED`. Hub runs should get the same guarantee and a
stable run error rather than surfacing a generic importer exception. Hub
credential testing should return a sanitized failed probe, not leak profile
paths, secret values, host details, or stack traces. Existing Docker tests
already sanitize secret values in `testSecrets`; preserve that guarantee.
[ADR-116 Amendment 6 target NACK](adrs/ADR-116-remote-import-agents.md#L466-L494);
[Docker `testSecrets`](../packages/importer-docker/src/importer.ts#L232-L250).

The remote protocol itself appears unchanged: only the Hub's own execution
context gains target resolution. Agent-bound jobs continue to preflight and
resolve target profiles on the Agent; profiles and credential values should
not be added to wire frames.

## Screens and UX

### Existing Screens to Reuse

- **Importer create/edit:** the Execution selector already contains Hub and
  named Agents. Hub is disabled only when `requiresAgent` is true, and
  importer selection may auto-select an Agent under that same condition.
  Docker can use the existing selector once its manifest no longer requires
  an Agent.
- **Credentials:** the form already filters credentials by execution mode:
  `STORED` for Hub, `AGENT_MANAGED` for Agents. Selecting a different
  executor clears the selected credential, which is appropriate because
  credential kind changes.
- **Scope:** schema-driven fields already render `targetId` as text. Its
  current description is Agent-centric; it needs to explain which
  executor-local registry supplies the ID.
- **Importer/run detail:** the importer detail and run detail already
  identify Hub versus Agent, so a new execution screen is not required.
- **Sources and Catalog:** no Docker-specific Source or instance page is
  implied. Health/source lifecycle UI and the component observation remain
  the generic surfaces already ratified in ADR-121 Amendments 1-2.

Sources: [form mode and credential logic](../packages/frontend/src/ux/components/importers/importer-form.tsx#L121-L128),
[execution selector](../packages/frontend/src/ux/components/importers/importer-form.tsx#L470-L545),
[importer detail](../packages/frontend/src/ux/components/importers/importer-detail.tsx#L145-L164),
[run detail](../packages/frontend/src/ux/components/importers/run-detail.tsx#L176-L197),
[Docker scope schema](../packages/importer-docker/src/config.ts#L6-L23).

### UX Questions

If profiles remain file-provisioned, the form can retain a plain `targetId`
field, but users need clear executor-specific setup instructions and an
actionable missing-target error. A UI-managed target list would be a separate
capability: decide its permissions, credential linkage, read/write lifecycle,
and whether it belongs in Importers, Credentials, or another Admin surface.
The repo says a missing backend capability needed by UX must be recorded in
`researches/ux-rewrite-gaps.md` with a matching frontend feature flag; this
memo intentionally does not create either artifact.

Copy should make the boundary clear: Hub execution runs in the backend
process and requires Hub network/filesystem/socket access; Agent execution
runs in the selected Agent's environment. Avoid describing both simply as
"local" because "local" means a different host/container in each mode.

## Deployment and Security

### Hub Reachability Is Not the Same as Agent Reachability

The current Compose `app` service has no Docker socket mount or
Docker-target-registry mount. The backend image runs as non-root user
`componode`. A socket profile path is interpreted inside the executor's
filesystem/network namespace; for the typical Linux Compose deployment,
`/var/run/docker.sock` must be deliberately mounted into `app`, and the
process must have socket permissions. [Compose `app` and volumes](../docker-compose.yml#L19-L40)
and [backend image user](../Dockerfile#L5-L24).

Docker's existing research classifies Docker Engine access as high trust and
socket access as highly privileged. The official Docker references called
out there cover [Engine security](https://docs.docker.com/engine/security/),
[remote daemon access](https://docs.docker.com/engine/daemon/remote-access/),
[SSH access](https://docs.docker.com/engine/security/protect-access/), and
[Docker contexts](https://docs.docker.com/engine/manage-resources/contexts/).
The safe default is not to mount the host socket into the Hub service
automatically. If a socket option is offered, document its host-level
authority and make deployment opt-in. Existing Docker transport design
already calls socket access highly privileged and recommends restricting
Agent egress too. [Docker importer research, target/security boundary](docker-importer-research.md#L56-L71).

For TCP and SSH profiles, the Hub must be able to reach those hosts and its
network egress policy becomes part of the trust boundary. Retain verified
mTLS and pinned SSH host keys; never add plaintext TCP, TLS skip-verify, or
password-only SSH. A named Docker Context also needs the Hub's context-store
metadata and TLS files. The current resolver reads `~/.docker` only and does
not honor an explicit `DOCKER_CONFIG` path. [Docker profile schema](../packages/importer-docker/src/target-profile.ts#L8-L65);
[Context store behavior](../packages/importer-docker/src/context-store.ts#L7-L15)
and [Context resolution](../packages/importer-docker/src/context-store.ts#L32-L98).

### File-System Policy Mismatch to Resolve

The existing Docker Context helper imports `node:fs` and reads context
metadata/TLS files from the executor's home directory. ADR-098 says importer
packages must not use filesystem imports, while the current ESLint patterns
ban bare `fs` and `fs/*` but do not match `node:fs`. This is a pre-existing
policy/code mismatch relevant to both executors; Hub support would make the
backend's filesystem boundary especially important. Resolve it deliberately
(for example, move Context resolution into the executor adapter or ratify a
narrow exception); do not let Hub support silently broaden importer
filesystem access. [ADR-098](adrs/ADR-098-importer-sandboxing.md#L5-L20);
[Docker Context helper](../packages/importer-docker/src/context-store.ts#L1-L15);
[ESLint importer restriction](../eslint.config.js#L19-L53).

The backend already decrypts Hub `STORED` credential values for in-process
importers. However, Hub-side target/profile configuration must not be treated
as an API user-supplied endpoint: keep route allowlisting under deployer
control, enforce profile-schema validation before access, and retain
secret-redaction rules. [Hub secret resolution](../packages/backend/src/utils/secret-resolver.ts#L100-L155);
[secret logging policy](adrs/ADR-090-no-secrets-in-logs.md).

## Source, Catalog, and Compatibility Effects

The importer emits the same Components, ComponentInstances, Docker
observations, and Swarm entities regardless of executor. Its Source key is
the Docker Engine identity (`/info.ID`), not the target profile or execution
location. Therefore the domain model and health rollup need no change if
those emitted identities stay unchanged.

Important scenarios for review:

- Running the same engine through Hub and Agent should match the same
  `(importerName, externalIdentity)` Source and must not create duplicate
  memberships.
- Changing executor but keeping the same engine identity should preserve
  Source ownership and history.
- Pointing the config at a different engine changes Source identity. The
  existing rebind-on-report rule unbinds the prior Source and leaves it
  `UNMONITORED`; this is not an implicit retirement/GONE operation. The new
  behavior must not auto-retire the old source's memberships.
- Multiple configs or profiles that reach the same engine still resolve to
  the same provider Source; `targetId` must not be mistaken for a unique
  Docker environment identity. ADR-119 allows one active config per Source,
  with the latest reporting config becoming bound; alternating configs for
  one engine can therefore change the displayed bound config.
- All existing Agent-bound Docker configs should remain Agent-bound after
  the change. Do not silently change `agentId`, credential kind, source
  binding, or profile placement on upgrade.

Evidence: [Docker Source identity decision](adrs/ADR-121-docker-importer.md#L53-L60);
[source matching/rebinding](../packages/backend/src/services/importer-source-service.ts#L101-L115)
and [config rebinding behavior](../packages/backend/src/services/importer-source-service.ts#L235-L275);
[source-scoped Docker reconciliation](../specs/046-docker-workload-inventory/data-model.md#L84-L93).

Wave D and Wave E specs currently say their health/Swarm work runs on
Agent-bound configs/endpoints. If the Hub option is intended to cover the
whole Docker importer, including Docker observations and Swarm inventory,
update those constraints and test the same execution matrix; otherwise name
the Hub-supported subset explicitly. [Spec 047 scope](../specs/047-docker-source-health/spec.md#L1-L15);
[spec 048 agent-bound scope](../specs/048-docker-swarm-inventory/spec.md#L6-L35)
and [requirements](../specs/048-docker-swarm-inventory/spec.md#L108-L147).

## Candidate Verification Scenarios

These are research findings to carry into the eventual spec, not current
implementation tasks:

1. A Hub-bound Docker config with an allowlisted local socket imports
   containers; the same daemon is still importable remotely through an Agent.
2. Hub run and Hub credential test reject missing, malformed, or unknown
   `targetId` before network access and do not leak profile or secret details.
3. Hub mode uses `STORED`; Agent mode uses `AGENT_MANAGED`; invalid
   credential-kind/executor pairs remain rejected at create and update.
4. Each selected transport is tested on every supported executor. Unsupported
   combinations (notably Hub named Context or Windows named pipe if the
   supported Hub runtime cannot provide them) fail clearly before access.
5. A run failure or cancellation in Hub mode does not reconcile missing
   assets; completed runs retain the existing source-scoped reconciliation.
6. Same engine through Hub and Agent maps to one Source. Different engine
   identity moves the config binding without implicitly retiring the old
   Source.
7. Swarm-manager detection, API floor handling, health mapping, and
   data-minimization behavior are identical in Hub and Agent modes if both
   modes are supported for the full importer.
8. The default Compose deployment remains unchanged unless an explicit
   socket/target opt-in is chosen; verify socket permissions with the
   non-root backend user.

## Grilling Questions - Resolved

All questions below were resolved by the user accepting the recommendations
through the interview rounds. The accepted decisions are summarized in
Phase 6 of the implementation-tracking handoff; this section is retained as
the record of which trade-offs were tested.

1. Is Hub execution local-daemon-only, or should it support all existing
   target transports when the Hub already has network reachability?
2. Should Hub target profiles be deployer-provisioned files, a single
   explicit local target, or Hub-managed records with a UI/API?
3. Is mounting `/var/run/docker.sock` into the backend acceptable at all?
   If yes, must it be opt-in and outside the default Compose profile?
4. Does "Hub" include Docker Context support? If so, where does the Hub's
   context store live, should a configured `DOCKER_CONFIG` path be added,
   and should the Hub target registry share `SECRETS_DIR` with its keyring?
5. Should the typed profile be shared verbatim across Hub and Agent, with
   separate profile files, or should Hub profiles be more restricted?
6. Is creating a separate `STORED` credential for Hub mode acceptable when
   migrating a current Agent-bound config, or is there a desired migration
   experience that does not copy secret material?
7. Should new Docker configs default to Hub, keep the current execution
   choice explicit, or prefer an available Agent? Existing configs should
   not be rebound automatically.
8. Should Hub support include Waves D/E (health observations and Swarm), or
   only ordinary container inventory?
9. Which security warnings and deployment checks are required before an
   admin can select Hub execution?

## Likely Follow-On Sequence

The handoff is to start the next numbered feature through `speckit-auto`,
with the ADR change map and verification matrix in
[`docker-importer-implementation-tracking.md`](./docker-importer-implementation-tracking.md)
Phase 6. The existing ADR-121, ADR-056, ADR-058, ADR-116, ADR-119, and
Docker specs are the main conflict points. Do not implement from this
research memo; implementation authority comes from the generated
`specs/{NNN-feature-name}/tasks.md`.

**Primary repository sources:** ADR-121, ADR-056, ADR-116, ADR-117,
ADR-098, ADR-028, specs 046-048, `packages/backend/src/services/import-run-service.ts`,
`packages/backend/src/services/credential-service.ts`,
`packages/agent/src/target-registry.ts`, `packages/importer-docker/src/`,
`packages/frontend/src/ux/components/importers/`, and
`docker-compose.yml`.
