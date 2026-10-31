# Docker Importer — Implementation Tracking

**Status:** Unnumbered tracking document. This file sequences the approved
strategy across spec-kit sessions; it is not a spec, plan, or executable
`tasks.md`. Implementation authority always comes from the generated
`specs/{NNN-feature-name}/` artifacts, never from this file.

**Design inputs (approved):**

- [docker-importer-research.md](./docker-importer-research.md) — Docker API facts
- [docker-importer-plan.md](./docker-importer-plan.md) — confirmed decisions and contracts
- [docker-importer-scenarios.md](./docker-importer-scenarios.md) — verification scenarios
- [docker-importer-spec-waves.md](./docker-importer-spec-waves.md) — dependency-ordered waves A–E

**Execution note:** each numbered spec below is intended to run through
`speckit-auto` end-to-end (specify → clarify → plan → tasks → implement →
converge → PR). Run one spec at a time; do not interleave waves.

---

## Phase 0 — ADR ratification (before any numbered spec)

**Status: shipped in spec `043-importer-source-adrs`** — ratified
2026-10-31. Precedes Wave A. Ratify in the same change set, per AGENTS.md
§ ADR fidelity — no contract surface may live only in a spec artifact.

- [x] New ADR for durable `ImporterSource` identity and lifecycle
      (`ACTIVE`/`UNMONITORED`/`RETIRED`, one active config per Source,
      explicit reversible retirement) — **ADR-119**.
- [x] Amend **ADR-036**: source-scoped Component/Instance reconciliation,
      durable source memberships, retirement transaction — Amendment 1;
      **ADR-037** carries a back-pointer (commit strategy unchanged).
- [x] Amend **ADR-056**: source identity reporting before asset yield
      (including empty inventories), target resolver, `targetRefKey` on
      `ImporterManifest` — Amendment 1.
- [x] Review/amend the ADR owning `ImportRun` history and config deletion:
      `ImportRun.sourceId` durable, `configId` nullable with
      `ON DELETE SET NULL` — **ADR-047** Amendment 1 + **ADR-077**
      Amendment 2.
- [x] Amend **ADR-116**: Agent-local target registry
      (`${SECRETS_DIR}/docker-targets.json`), allowlist preflight, typed
      target resolver, target security model — Amendment 5.
- [x] Amend **ADR-065**: importer package lockstep for the eventual
      `@componode/importer-docker` in hub and Agent — Amendment 1
      (contract-first).
- [x] Review **ADR-106** / **ADR-117** where Agent target egress and
      Agent-managed credential boundaries intersect — recorded "no change
      needed" in ADR-119; also ADR-038 reviewed, unchanged.
- [x] Update `researches/architecture-decisions.md` index and add
      `**Amended by ADR-XXX**` back-pointers on every amended ADR.

## Phase 1 — Generic ImporterSource core (Wave A)

- [ ] Numbered spec for: `ImporterSource` entity, source-identification
      callback, one-config-per-Source binding, `ImportRun.sourceId` +
      nullable `configId`, durable Source→Component/Instance memberships,
      source-scoped reconciliation and retirement, generic Agent target
      resolver/preflight contract, best-effort legacy handling.
- [ ] Verification: two-source shared Component, no cross-source GONE,
      retire-one vs retire-last, empty inventory registers Source, config
      deletion preserves Source + run history.

## Phase 2 — Staged migration of existing importers (Wave B)

- [ ] Per-importer provider-native source identity keys documented and
      implemented in explicit waves.
- [ ] `LEGACY_UNATTRIBUTED` preservation; no auto-split/merge/rekey.
- [ ] Backfill source memberships only where run/config provenance is
      defensible.

## Phase 3 — Docker Engine workload inventory (Wave C)

- [ ] `@componode/importer-docker` package; lockstep registration in
      core, backend, agent.
- [ ] Target profiles: socket/named pipe, mutual-TLS TCP, pinned-host-key
      SSH, allowlisted named Docker Context.
- [ ] `CONTAINER` Component per logical workload; one Component Instance
      per concrete container; canonical project/service identity +
      `componode.component-id` override.
- [ ] Redacted bind mounts, safe network/volume refs, image ref/digest.
- [ ] User guide `docs/importers/docker.md` (index + sidebar links).

## Phase 4 — Docker observations and Source UI (Wave D)

- [ ] `rawConfig.dockerObservation` allowlisted snapshot; `InstanceStatus`
      mapping per the plan's status table.
- [ ] Generic ImporterSource list/detail/lifecycle UI in Importers
      operations area.
- [ ] User-confirmed `compose:`/`service:` tag suggestions (32-char
      grammar; omit invalid, never truncate or auto-write).

## Phase 5 — Swarm inventory (Wave E)

- [ ] Auto-discovery via `/info` + `ControlAvailable`; API v1.41+ with
      `/version` negotiation, `ServiceStatus` via `status=1`.
- [ ] `CONTAINER_ORCHESTRATION` per logical service + aggregate Instance;
      `COMPUTE` Nodes; metadata-only `SECRET` Secrets; Configs as
      references only.
- [ ] Manager-reported counts only — no per-task health inference.

---

## Numbering and housekeeping

- Spec numbers are sequential (`.specify/init-options.json`); highest
  used is `042-catalog-authoring`, so the next spec is expected to be
  `043` — but always confirm the next free number from `specs/` and
  `.specify/feature.json` at spec time.
- **Never reuse `038`.** `038-ux-11-conformance` owns that number; the
  empty `specs/038-docker-importer/` directory is left intentionally
  and may be removed separately.
- `.specify/feature.json` currently points at
  `specs/042-catalog-authoring`; `speckit-specify` will repoint it per
  feature — keep it on the in-flight spec.
- On each spec's completion, update `docs/roadmap.md` (**Shipped** +
  revised **Next**) per AGENTS.md roadmap sync.
- Each wave follows `docs/importer-development.md` requirements:
  core-only importer deps, manifest/config schema, `testSecrets`,
  AbortSignal, `validateDiscoveredAsset` tests, backend integration
  tests, OpenAPI sync for any route/contract change.
