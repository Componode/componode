# Docker Importer - Planning Scenarios

**Status:** Unnumbered research input only; not a feature spec. See [research](./docker-importer-research.md), [planning notes](./docker-importer-plan.md), and [candidate spec waves](./docker-importer-spec-waves.md). Feature numbering remains undecided.

## Scenarios to validate in the later implementation waves

1. **Compose service across environments:** A Compose project named `commerce` contains `web`, `api`, and `db`. Each logical containerized workload is a `CONTAINER` Component; its concrete Docker container IDs in DEV/STAGING/PRODUCTION are Component Instances. The project is not a Component. Project/service values are source metadata and optional user-confirmed tag suggestions.
2. **Container rebuild:** The `commerce/api` container is rebuilt and gets a new Docker ID. The next complete import creates a new Instance under the same logical Component, marks the old Instance GONE for that Source, and leaves the Product's `DEPENDS_ON_COMPONENT` edge intact.
3. **Multiple Docker targets:** DEV and PROD Sources report the same canonical logical workload ID. A DEV run marks only DEV-owned instances GONE; it must not orphan PROD instances or retire the shared Component. Source identity is independent of Component identity.
4. **Project/service rename:** A project or service name changes but the logical workload remains the same. An explicit stable workload ID label/mapping preserves the Component ID; without it the changed key is a new Component and no Product edge is transferred automatically.
5. **Source-reported health:** Docker reports a running container with an unhealthy health check. The Instance status becomes ERROR and its allowlisted source observation/time is retained. A Product receives ADR-112 rollup only if a person wired it to that Component.
6. **No health check / stale observation:** `State.Health` is absent or no recent import has occurred. The catalog distinguishes not-configured from healthy and exposes last-seen time without claiming live status.
7. **Swarm health boundary:** A replicated Swarm Service wants three tasks and the manager reports two running. Its aggregate Instance is ERROR. Per-task health-check status is not available from manager Task objects and is not fetched from worker nodes in this scope.
8. **Partial source failure:** A selected manager/list/inspect operation fails. The run fails rather than appearing as a complete empty inventory; it does not retire the Source's prior records.
9. **Source offboarding/reactivation:** Deleting an ImporterConfig removes its schedule/credentials but leaves the Source UNMONITORED with its run history and memberships. Explicit source retirement withdraws only that Source's memberships; if the same provider identity returns, the Source and eligible Components reactivate.
10. **Tag suggestions:** Compose project/service values appear as valid optional tag suggestions in Component edit. Users click to add and save; no tags are automatically written, and values that cannot fit tag rules/length remain only as source metadata.
11. **Target profile rotation:** A new immutable target profile/Agent route connects to the same verified Docker Engine identity. The config reattaches to the same `ImporterSource`; transport-profile changes do not duplicate logical Components or erase run history.
12. **Swarm service across clusters:** The same logical Swarm workload has different engine-level service IDs in DEV and PROD. A stable service identity label/mapping produces one `CONTAINER_ORCHESTRATION` Component with one aggregate Instance per Source; without an identity match, keep them separate.
13. **Compose-to-Swarm change:** A workload moves from Compose to Swarm. Its Component category changes (`CONTAINER` to `CONTAINER_ORCHESTRATION`), so the importer does not transfer the human-curated Product edge automatically.

## User-facing value to verify

- Can an operator identify a logical workload Component and its container Instances across environments and Docker targets?
- Can a Product owner see source-reported failure through the existing Instance status and ADR-112 when the Product is manually wired?
- Do stable identity labels/mappings preserve Product dependencies across rebuilds and environment deployments?
- Does the catalog avoid exposing raw host paths, container environment variables, health output, secret contents, and noisy local image caches?
- Do Source status, last complete run, and ImportRun history make freshness, unmonitored sources, and incomplete imports clear?
- Can an administrator distinguish best-effort legacy Source attribution from verified memberships after the staged migration?
