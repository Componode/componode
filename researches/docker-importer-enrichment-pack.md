# Docker Importer — Enrichment Pack (specs 064 + 065)

**Status:** Grilled and ratified (design decisions settled in agent session;
awaiting spec-kit artifacts). Not yet specced — no `specs/064-*` or
`specs/065-*` directories exist. Feature numbering is sequential
(`.specify/init-options.json`), so these take 064 and 065 after
`063-docker-importer-onboarding`.

**Origin:** Follow-up to the question "what Docker API data would be
valuable?" — answered by inventorying Engine API surfaces against the
catalog model, then stress-tested through a structured grilling session.
Every decision below was explicitly confirmed by the user.

**Governing docs:** ADR-121 (importer contract, data minimization
allowlist), ADR-122 (dual Hub/Agent executor — inventory parity is
mandatory on both), `researches/docker-importer-research.md` (redaction
rules), `researches/docker-importer-spec-waves.md` (wave structure —
this pack continues it as Waves F and G).

---

## Pack structure

| Spec | Scope | ADR impact |
| ---- | ----- | ---------- |
| `064-docker-importer-enrichment` | Observation enrichment + engine component + image inspect + bounded UI | ADR-121 Amendment 3 |
| `065-docker-infra-inventory` | `NETWORK`/`STORAGE` components from `/networks` + `/volumes` | ADR-121 Amendment 4 (written when specced) |

**Sequencing:** spec-kit artifacts for both may be drafted now; implementation
strictly after spec 063's PR merges (both touch `importer-docker`), in order
064 → 065.

**Motivation (ratified):** operators currently cannot see deployed image
provenance, engine versions, resource limits, or Swarm published ports —
facts the API already returns and the importer discards. Scope is
operational truth + bounded catalog completeness, not metrics collection
or security scanning.

---

## Spec 064 — docker-importer-enrichment

### Observation bundle (zero new endpoints, zero config keys)

All additions are bounded `rawConfig`/`details` fields inside the existing
ADR-121 allowlist philosophy — facts, not scanning; no `Env`, no host
paths, no health output, no test commands.

**Container instances** (`rawConfig` additions):

- `imageId` — from container `inspect.Image` (`sha256:` ID); enables join
  to `PACKAGE_REGISTRY` image assets via `details.imageId`.
- `hostConfig` — `{memoryBytes?, nanoCpus?, pidsLimit?,
  restartPolicy{mode,maxRetries?}, privileged?, readOnlyRootfs?,
  logDriver?}` — per-container capacity/posture facts.
- `healthcheck` — `{intervalSeconds?, timeoutSeconds?, retries?,
  startPeriodSeconds?}` — nanoseconds → seconds; `Test` command stays
  excluded (ADR-121).
- `dockerObservation` stays pure state/health-status — config facts do
  not mix into it.

**Swarm service instances** (from `listServices` `Spec` — no extra calls):

- `Spec.EndpointSpec.Ports` → `published`/`target`/`protocol` arrays on
  the instance `rawConfig` (parity with container `ports` shape).
- `Spec.Networks` targets → `networks: [names]`.
- `swarmObservation.mode` extended with `replicated-job`/`global-job` when
  `Spec.Mode` is a job type. Job services stay `CONTAINER_ORCHESTRATION`
  — no `JOB` components.

### Engine component

One `COMPUTE`/`docker-engine` Component per source, **always emitted**
(Swarm or not, all transports), one `RUNNING` instance carrying
`engineObservation`.

- `externalId` = the source identity itself — it already is
  `docker-engine:{id}`; do **not** double-prefix.
- `details`: `{serverVersion, apiVersion, os, arch, kernelVersion,
  cgroupDriver?, runtimes[], registryMirrors[], swarmNodeState?,
  swarmControlAvailable?, swarmManagers?}`.
- **Excluded:** `DockerRootDir` (host path), `HttpProxy`/`NoProxy`/
  `FtpProxy` (may embed credentials), `Plugins`, `SecurityOptions`
  detail, `Warnings`.
- Sourced from `/info` + `/version` calls already made — zero extra API
  calls.

### Image inspect (opt-in via existing `includeImages` flag)

- When `includeImages=true`: dedupe `GET /images/{id}/json` calls by
  unique image `Id` across all emitted image assets; merge into each
  asset's `details`: `{ociLabels, exposedPorts[], user?, entrypoint?,
  workingDir?, volumes[], architecture?, os?}`.
- `ociLabels`: bounded allowlist of ~10 standard
  `org.opencontainers.image.*` keys (source, revision, version, vendor,
  licenses, description, title, url, documentation, source-label) —
  not an unbounded namespace passthrough.
- `includeImages=false` → no extra calls, unchanged behavior.
- Note: `GET /images/json` already returns `Labels`/`Created`/`Size`
  free — a cheaper list-only path was considered and rejected in favor
  of full inspect.

### UI surfacing (bounded)

Required because `component-detail.tsx` renders component `details`
**not at all** today, and instance `rawConfig` renders only
`dockerObservation`'s known keys via the field-specific
`ObservationDetails` component.

- Extend observation rendering for `hostConfig`/`healthcheck`/Swarm
  ports-networks.
- Add allowlisted rendering for image `ociLabels` and engine `details`.
- Explicit named sections per resourceType — **no generic rawConfig
  dump**, consistent with the existing allowlist philosophy.

### Explicitly out of scope for 064

`/networks`, `/volumes`, `/configs` endpoints; all external APIs (see
Cut list); new config keys; API/contract changes.

---

## Spec 065 — docker-infra-inventory

`GET /networks` → `NETWORK`/`DOCKER` components;
`GET /volumes` → `STORAGE`/`DOCKER` components. Both `instances: []`
(image/swarm-secret precedent — no per-environment instances;
point-in-time facts live in `details`). `resourceType`: `network` /
`volume`. **Always emitted** — two cheap list calls, low cardinality, no
opt-in flags.

### Identities

- `{sourceIdentity}:network:{scope}:{name}` — scope-qualified because a
  `frontend` bridge and `frontend` swarm network can coexist.
- `{sourceIdentity}:volume:{name}` — volume names are daemon-unique.
- Component `name` = the Docker name.

### Field allowlists (ratified after explicit review)

**Network `details`:** `{driver, scope, internal, attachable, ingress,
configOnly, enableIPv6, createdAt, attachedCount,
attachedContainers(names), labels(allowlisted)}`

Excluded from `/networks` response:
- `IPAM.Config` (Subnet/Gateway/AuxAddresses) — internal addressing plan,
  "avoid unnecessary address detail" per research doc.
- Per-endpoint `MacAddress`, `IPv4Address`/`IPv6Address`/`GlobalIPv6*`,
  `EndpointID` — dynamic/churning address detail; only endpoint `Name`
  is kept (→ `attachedContainers`).
- `Options` — driver knobs (bridge interface names, `host_binding_ipv4`
  host IPs, iptables flags); arbitrary driver options can embed
  anything.
- `Id` — networks cannot be renamed; name+scope is already stable.

**Volume `details`:** `{driver, scope, createdAt, sizeBytes?,
refCount?, reclaimable?, labels(allowlisted)}`

Excluded from `/volumes` response:
- `Mountpoint` — raw host filesystem path (same class as bind-mount
  host paths ADR-121 redacts).
- `Options` — **highest-risk field**: `local` driver `type=bind` puts a
  raw host path in `device`; `type=nfs` embeds server addresses in `o=`;
  some drivers accept credential-ish options. Entirely excluded.
- `Status` — free-text, driver-defined, usually null.
- `sizeBytes`/`refCount`/`reclaimable` come from `UsageData` — sparse
  when the driver doesn't report.

**Labels (both):** same bounded prefix allowlist as container labels
(`com.docker.*`, `componode.*`). Bonus: compose-project association
arrives free via `com.docker.compose.project` labels.

### Failure policy & open research item

- `/networks` or `/volumes` errors **fail the run closed** — consistent
  with ADR-121's "partial inventory is never emitted" Swarm rule.
- Research-phase check: verify minimum Engine API versions for both
  endpoints; state any hard floor alongside the existing v1.41 Swarm
  gate.
- Open question for plan: whether swarm-scoped networks are visible on
  worker (non-manager) nodes — emission should record whatever the API
  returns per executor.

### UI

Extends the 064 details-rendering pattern: NETWORK shows
driver/scope/flags/attachments; STORAGE shows driver/scope/size/
refCount. Allowlisted fields only.

---

## Cut list (explicitly rejected, with reasons)

| Candidate | Reason |
| --------- | ------ |
| Docker Scout | Constitution-deferred security scanning (no Risk entity/ASPM in v1). |
| Docker Content Trust (Notary) | New client dependency + per-image calls; no forcing function. |
| Docker Hub metadata API | Auth + rate limits; no forcing function. |
| Swarm `/configs` components | No `CONFIG` category exists (would need core constants + DB CHECK migration); Wave E ratified refs-only — stays. |
| `/events`, `/stats`, logs | Streaming/high-cardinality; monitoring domain, already excluded. |
| `Config.Env` anywhere | Secret-adjacent; ADR-121 minimization. |
| Network IPAM / Options / endpoint addresses | Address-plan + driver-option detail (see 065 allowlist rationale). |
| Volume Mountpoint / Options | Host paths and credential-adjacent driver opts. |

## Process notes for the implementing session

- Run `speckit-specify` → `plan` → `tasks` → `implement` per spec;
  update `.specify/feature.json` as features switch.
- Each spec amends ADR-121 when implemented (Amendment 3 for 064,
  Amendment 4 for 065) — matching the Amendment 1/2 precedent.
- Importer tests MUST exercise `validateDiscoveredAsset`
  (AGENTS.md/testing rules); test-first is non-negotiable.
- `docs/importers/docker.md` must be updated in the same change (importer
  contract rule); enumerable collected fields are documented there.
- Dual-executor parity (ADR-122): everything lands in shared importer
  code, so Hub and Agent get it automatically — verify no Hub-only or
  Agent-only assumptions.
- UI work stays inside `component-detail.tsx` allowlist-rendering
  pattern; add frontend unit tests alongside.
