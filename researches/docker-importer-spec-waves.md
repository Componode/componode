# Docker Importer - Candidate Spec Waves

**Status:** Unnumbered planning only. These are dependency-ordered topics for future spec-kit work, not executable tasks. Feature numbering remains undecided.

## Wave A - Generic ImporterSource and reconciliation core

This foundation precedes Docker and becomes the standard for every in-tree importer.

- Add durable `ImporterSource` records with UUIDv7 IDs, provider-native external identity, display metadata, and `ACTIVE` / `UNMONITORED` / `RETIRED` lifecycle.
- Add a source-identification callback before asset yield. It must register a source even when a complete inventory returns zero Components.
- Bind one active `ImporterConfig` to one Source. Config deletion removes execution credentials/schedule, marks the Source `UNMONITORED`, and preserves Source/run history. Explicit Source retirement is separate; a Source can reactivate if the same identity returns.
- Add durable Source-to-Component and Source-to-ComponentInstance memberships, including per-Source Component details. These records survive ImportRun/config deletion.
- Add durable `sourceId` to ImportRuns and make `configId` nullable with `ON DELETE SET NULL`, so historical runs remain attributable after config deletion.
- On a successful full run, mark only that Source's missing memberships inactive/GONE. Keep a shared Component ACTIVE while any Source still reports it; retire it only when no active Source membership remains.
- Retain Components/Instances from incomplete sources; failed authoritative enumeration must not perform completed-run retirement.
- Add a generic Agent target resolver/target reference contract and Agent-local allowlist preflight for remote source execution. Docker is the first adopter; avoid provider-specific Agent policy.
- Ratify/amend ADR-036, ADR-056, ADR-116, and ADR-065 as required by the finalized contracts.

**Verification scenarios:** two Docker target Sources report the same logical Component in DEV and PROD; running one target never marks the other's instances GONE; retiring one Source preserves shared Components; retiring the final Source retires the Component; an empty inventory still identifies the Source; deleting a config leaves its Source and run history accessible.

## Wave B - Staged migration of current importers

Migrate existing in-tree importers in explicit, documented waves; do not silently leave them on legacy reconciliation.

- Establish the provider-native Source identity per importer (e.g. GitHub organization ID + base URL, cloud account/subscription identity, Kubernetes cluster identity, or canonical URL).
- Add identity that is missing from source-local `externalId` values before enabling multi-source Component sharing.
- Backfill Source memberships only when surviving run/config provenance makes the assignment defensible.
- Preserve `LEGACY_UNATTRIBUTED` records, existing external IDs, Product edges, and Component details when provenance or prior source collisions cannot be reconstructed. Do not auto-split, merge, or rekey.
- Document each importer migration, its identity key, scope boundary, and any legacy cleanup needed.

## Wave C - Docker Engine workload inventory

- Add `@componode/importer-docker`; register it in core, backend, and agent packages in lockstep.
- Execute only on an assigned Import Agent and resolve an allowlisted target profile from the versioned, read-only `${SECRETS_DIR}/docker-targets.json` registry.
- Use `targetId` in the Docker scope, declared by a manifest target-reference key; Agent validates it before importer execution and resolves the typed target profile through the target resolver.
- Support the selected socket/named pipe, verified mutual-TLS TCP, pinned-host-key SSH, and named Docker Context modes with the agreed Agent-local credential boundaries.
- Discover running and stopped containers; local image inventory stays opt-in. Compose Project and service names are metadata/filter values, not Componode entities or edges.
- Emit one `CONTAINER` Component per logical containerized workload and one Component Instance per concrete container. Use a canonical logical project/service identity plus a stable per-workload override; use target/daemon + container ID for Instance identity.
- Include the redacted bind-mount path/reference, safe ports/network/volume references, image reference/digest, and allowlisted source observations.

**Verification scenarios:** container rebuild preserves the Component/Product edge but creates a new Component Instance; same logical Compose workload from another environment updates the same Component without cross-source GONE; project/service rename with explicit stable ID preserves identity; incomplete target run does not retire prior source data.

## Wave D - Docker source health observations and Source UI

- Persist only Docker state and latest health-check facts under `ComponentInstance.rawConfig.dockerObservation`; never collect `/stats`, events, health output, test commands, full inspect JSON, or live history.
- Map source status into the existing InstanceStatus enum; test health, no health check, starting, exited, restarting, OOM, and GONE behavior; verify ADR-112 rollup on human-wired Products.
- Use existing Component Instance status badge and last-seen view; do not add a Docker-specific monitoring page.
- Add generic ImporterSource list/detail and lifecycle controls in the Importers operations area: identity, bound config, last complete run, UNMONITORED/RETIRED state, reattach, and explicit retire.
- Show Compose project/service values as optional tag suggestions in the existing Component edit flow. User confirmation is required; invalid/overlong suggestions are omitted, never truncated or auto-written.

## Wave E - Swarm inventory

- Auto-discover Swarm when `/info` reports active and the endpoint is a manager (`ControlAvailable`).
- Require Engine API v1.41+ and request `ServiceStatus` with `status=1`; require manager capability and fail an incomplete authoritative Swarm inventory.
- Model each logical Swarm Service as a `CONTAINER_ORCHESTRATION` Component with one aggregate Component Instance per environment; use stable service identity label/mapping or consistent stack namespace + service name. Component Instance identity includes the target/source and Swarm Service ID.
- Model Swarm Nodes as source-scoped `COMPUTE` Components. Model Swarm Secrets as metadata-only `SECRET` Components with no instances. Keep Swarm Config references on service details; no `CONFIG` Component or content import.
- Do not infer per-task health: Task objects lack health-check status and worker container inspect is node-local. Use manager service counts/task states; preserve node availability settings as observations.
- Treat Compose-to-Swarm transition as distinct Components because the categories differ; no automatic Product edge transfer.

## Cross-cutting delivery requirements

Every implementation wave follows `docs/importer-development.md`: core-only importer dependency, manifest/config schema, mode-aware credential validation, `testSecrets`, AbortSignal, `validateDiscoveredAsset` tests, backend integration tests, and a user guide at `docs/importers/docker.md`. Any API/manifest/source-ownership contract change requires ADR updates and OpenAPI synchronization where applicable.

The source-lifecycle migration is staged and must be documented per importer. The source-aware core contract is the intended standard; existing importers remain on legacy reconciliation only until their named migration wave is complete. Feature numbering and executable tasks remain undecided.
