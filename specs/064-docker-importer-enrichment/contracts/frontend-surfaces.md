# Contract: frontend rendering surfaces (spec 064)

Bounded, allowlist-only rendering in `packages/frontend` — no generic
`rawConfig`/`details` dump anywhere.

## Instance-row expander (`component-detail.tsx`)

Today the expander renders only when `rawConfig.dockerObservation` exists.
It generalizes to "any known allowlisted block present", rendering named
sections for whichever exist:

| `rawConfig` key | Section | Contents |
|---|---|---|
| `dockerObservation` | Observation (existing, unchanged) | state, health, exit/OOM/restart, started/finished |
| `swarmObservation` | Observation | mode (incl. job modes), desired/running/completed, updateState, observedAt |
| `imageRef`/`imageDigest`/`imageId` | Image | deployed image ref, digest, immutable ID (US1) |
| `hostConfig` | Host config | memory, CPUs, pids limit, restart policy, privileged/RO-rootfs, log driver |
| `healthcheck` | Health check definition | interval/timeout/retries/start-period (seconds) |
| `ports` | Ports | protocol/target/published(/publishMode) entries — swarm shape |
| `networks` | Networks | network target list (names or IDs) |

Fields with no recognized allowlist entry never render. The expander
appears when ≥1 known block is present (containers: `dockerObservation`
+ new keys; swarm services: `swarmObservation` + `ports`/`networks`;
swarm nodes: `swarmNodeObservation` — unchanged unless already rendered).

## Component Details card — resourceType-keyed sections

| `resourceType` | Section | `details` keys rendered |
|---|---|---|
| `docker-engine` | Engine | serverVersion, apiVersion, os, arch, kernelVersion, cgroupDriver, runtimes, registryMirrors, swarmNodeState, swarmControlAvailable, swarmManagers |
| `image` | Image provenance | ociLabels (key→value list), exposedPorts, user, entrypoint, workingDir, volumes, architecture, os |

Other resourceTypes: Details card unchanged (resourceType, group, owner,
sunset, last seen). Unknown `details` keys never render.

## Implementation shape

New module `ux/components/catalog/docker-details.tsx` holds the typed
shapers (`hostConfigOf`, `healthcheckOf`, `engineDetailsOf`,
`imageDetailsOf`, …) + section components, mirroring the existing
`dockerObservationOf`/`ObservationDetails` pattern. `view-types.ts`
needs no changes (`details`/`rawConfig` are already
`Record<string, unknown>`).
