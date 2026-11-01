# Research: Docker Swarm inventory (Wave E)

## Docker Engine API surface

- `/info` → `Swarm.{LocalNodeState, ControlAvailable}` — already fetched
  for engine identity (`importer.ts:58`); extend the cast, free gate.
- `/version` → `ApiVersion` string (e.g. `"1.45"`) — fetch only when
  Swarm detected.
- Services list `GET /services` exists since **v1.24**; `?status=1`
  populates `Service.ServiceStatus.{RunningTasks,DesiredTasks,CompletedTasks}`
  since **v1.41** → floor = **1.41** (fail-below, per wave doc).
- Nodes `GET /nodes` (v1.24), secrets `GET /secrets` (v1.30) — both
  covered by the 1.41 floor.
- Global-mode services: `ServiceStatus` reports `DesiredTasks` =
  eligible-node count — same ratio rule works for both modes.

## dockerode surface (`@types/dockerode@4.0.2`)

- `listServices({status: true})` → `Service[]` — `Spec.{Name,Labels,Mode{Replicated{Replicas}|Global},TaskTemplate}`, `ServiceStatus`, `UpdateStatus.State`, `Endpoint`.
- `listNodes()` → `any[]` — define local `SwarmNode` interface: `Spec.{Name,Role,Availability,Labels}`, `Status.{State,Addr}`, `ManagerStatus.{Reachability,Leader}`, `Version.Index`.
- `listSecrets()` → `Secret[]` — `ID`, `Spec.{Name,Labels}`, `Version.Index`.
- `version()` → `{ApiVersion}` — already used by `testSecrets`.
- Swarm responses are loosely typed/`any` → local allowlist interfaces
  (same pattern as `ContainerInspect` in `mapping.ts`).

## Code seams (verified)

- `importer.ts:43` `run()`: config.parse → `resolveTarget` → `new Docker`
  → `info()` → `reportSourceIdentity` → `listContainers` →
  inspect/mapping → `buildAsset` → `validateDiscoveredAsset` → yield.
  Swarm block slots between identity report and container inventory;
  abort checks reuse `context.signal` conventions.
- `test/importer.test.ts` mocks the `dockerode` class (`info`,
  `listContainers`, `listImages`, `getContainer`, `version`) — extend
  with `listServices`/`listNodes`/`listSecrets`.
- Backend integration (`docker-import.test.ts`) stubs `getImporter`
  with canned `DiscoveredAsset` generators — Swarm assets reuse this.
- Category constants `CONTAINER_ORCHESTRATION`/`COMPUTE`/`SECRET` exist
  in core; precedents: importer-kubernetes (`CONTAINER_ORCHESTRATION`),
  importer-aws (`COMPUTE` — one status-bearing instance + `rawConfig`).

## Decisions

- **Decision**: gate on `info().Swarm` — `LocalNodeState==="active"` AND
  `ControlAvailable===true`. **Rationale**: wave doc requires manager;
  worker-only or inactive endpoints get zero extra calls.
  **Alternatives**: separate `/swarm` endpoint probe — adds a call and
  fails on API <1.17 anyway.
- **Decision**: `swarmObservation` key (distinct from `dockerObservation`).
  **Rationale**: different schema/producer; keeps Wave D allowlist
  untouched. **Alternative**: shared `observation` shape — couples two
  contracts unnecessarily.
- **Decision**: service identity `Name` (stack-prefixed) for component
  externalId, `ID` for instance externalId. **Rationale**: stable names
  give component stability + reconciliation; ID-scoped instances keep
  rebuild semantics. **Alternative**: ID for component — rename churn.
- **Decision**: replica table `desired>0 && running===desired → RUNNING`,
  `desired>0 && running<desired → ERROR`, `desired===0 → STOPPED`.
  **Rationale**: matches spec ACs exactly; partial is degraded, never
  silently healthy. Global mode rides the same manager counts.
- **Decision**: node table `ready+active → RUNNING`, `drain|pause →
  STOPPED`, `down|disconnected|unreachable|unknown → ERROR`.
  **Rationale**: intentional lifecycle (drain/pause) vs failure states;
  fail-closed matches Wave C/D precedent.
- **Decision**: fail run on `ApiVersion < 1.41` (coded error propagated —
  no partial Swarm inventory). **Rationale**: wave doc "fail an
  incomplete authoritative Swarm inventory".
- **Decision**: new `src/swarm.ts` module (parallel to `mapping.ts`)
  rather than growing `mapping.ts` ~50% — one file per concern.
