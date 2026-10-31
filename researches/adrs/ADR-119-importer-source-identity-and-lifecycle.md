### ADR-119 — ImporterSource identity and lifecycle

> **Status:** Ratified

**Context**: Reconciliation scope ([ADR-036](./ADR-036-two-phase-reconciliation-scope.md)),
deletion ([ADR-047](./ADR-047-deletion-model.md)), and run history are all keyed to
`importer_configs` — the _editable_ execution record. That conflation breaks
the moment one external system is reached through changing configs, or two
different systems report the same logical Component: deleting a config
destroys the provenance its runs produced, and one config's phase-2
retirement cannot tell "this workload is gone" from "a different daemon
still reports it." The Docker importer program
(`researches/docker-importer-plan.md`) needs a durable, provider-identified
ownership boundary that outlives configs — and the same boundary is the
standard every importer migrates to. This ADR ratifies the generic model;
each importer's concrete source-identity key and migration wave are decided
per spec, not here.

**Decision**:

1. **`ImporterSource` is a first-class durable record.** Internal UUID v7
   PK ([ADR-045](./ADR-045-entity-identifier-format.md)) + `externalIdentity`
   — the provider-native canonical, **non-secret** identity of the external
   system (Docker Engine `/info.ID`, GitHub organization ID, cloud
   account/subscription ID, cluster UID, canonicalized endpoint URL, or —
   only when the provider offers no trustworthy identity — an
   admin-supplied stable key). URL identities are canonicalized to strip
   userinfo, auth query parameters, and fragments. Display labels are
   metadata; Sources are **never** matched by display name. A Source is
   internal provenance — it is not a catalog `Component` and never appears
   as one.

2. **Lifecycle is `ACTIVE` / `UNMONITORED` / `RETIRED`.** `UNMONITORED`
   means the Source exists but no active config feeds it — deleting or
   unbinding its config lands here; it is _not_ retirement. `RETIRED` is an
   explicit, reversible, operator-driven state. A Source returns to
   `ACTIVE` when a config reattaches it or a run reports the same provider
   identity again.

3. **One active config binds one Source.** An `ImporterConfig` is editable
   execution/schedule/credential state; the Source is the longer-lived
   identity. Replacing or recreating a config can reattach to the same
   Source, preserving continuity across credential rotation and scope
   edits.

4. **Source memberships are the reconciliation unit.** Durable
   Source→Component and Source→ComponentInstance records persist which
   Source reported what, independent of `lastSeenInRunId` and of
   `import_runs` retention. Source-specific metadata lives on the
   membership; shared canonical facts live on `Component.details` — this
   prevents last-writer-wins when two Sources report the same logical
   Component.

5. **`import_runs.sourceId` is durable; `configId` becomes nullable.**
   Runs are attributed to the Source at start (from the reported
   identity). `configId` gains `ON DELETE SET NULL` so deleting a config
   preserves the run row and its Source attribution — refining
   [ADR-047](./ADR-047-deletion-model.md)'s hard-delete treatment (see
   amendment).

6. **Importers report source identity before yielding assets** via
   `context.reportSourceIdentity(identity)` — required on every run,
   including empty inventories, so a reachable-but-empty source still
   registers and reconciles (see [ADR-056](./ADR-056-importer-interface-signature.md)
   Amendment 1).

7. **Reconciliation is source-scoped** (see [ADR-036](./ADR-036-two-phase-reconciliation-scope.md)
   Amendment 1): a `COMPLETED` run deactivates only its own Source's absent
   memberships; a shared Component/Instance stays active while any Source
   reports it; retirement happens only when no active membership remains.
   An incomplete run never triggers retirement — a failed authoritative
   enumeration is not a snapshot.

8. **Target profiles are Agent-local access routes, provider-agnostic.**
   A manifest may declare `targetRefKey` naming the config-scope key that
   carries a `targetId`; the Agent resolves it through
   `context.resolveTarget(targetId)` against a versioned, read-only
   registry before importer execution (see [ADR-116](./ADR-116-remote-import-agents.md)
   Amendment 5). Target IDs are immutable access-route identifiers —
   changing endpoint/transport means a new profile ID — and are distinct
   from both Source identity and Component identity. Docker is the first
   adopter; the contract names no Docker-specific fields.

9. **Legacy data stays `LEGACY_UNATTRIBUTED` until migrated.** Existing
   Components/Instances/runs keep unattributed provenance until each
   importer's named migration wave assigns its source-identity key and
   backfills only where surviving run/config provenance makes the
   assignment defensible. Uncertain records are never auto-split, merged,
   rekeyed, or auto-retired.

**Rationale**: Provenance that outlives its config is the only model where
"which system reported this" survives credential rotation, config
recreation, and multi-source overlap. Membership records (not
`lastSeenInRunId`) make multi-source sharing safe: each Source reconciles
its own view and a shared Component survives the loss of any single
Source. Reporting identity before the yield — even for empty inventories —
is what makes "empty" distinguishable from "unreachable," which in turn
makes source-scoped phase-2 retirement safe. Keeping target resolution
generic and Agent-local avoids baking Docker transport policy into the
importer contract while still giving every future remote importer a
vetted access-route mechanism.

**Reviewed, unchanged**: [ADR-038](./ADR-038-importer-run-resume-strategy.md)
(run-level restart + upsert idempotency) is unaffected by source scoping.
[ADR-106](./ADR-106-security-hardening-2026-09-assessment.md) is a dated
assessment, not an enumerated contract surface. [ADR-117](./ADR-117-agent-managed-credentials.md)'s
`AGENT_MANAGED` mechanism is reused as-is — target profiles _reference_
credential bundles; they do not redefine them.

**Amendments to earlier ADRs**:

- **[ADR-035](./ADR-035-instance-reconciliation-orphan-missing-instances.md)** —
  "orphan the missing instances" is scoped to the reporting Source's
  memberships; `GONE` requires no remaining active membership
  (Amendment 1).
- **[ADR-036](./ADR-036-two-phase-reconciliation-scope.md)** — phase-2 scope
  moves from "components previously touched by this importer config" to
  the reporting Source's memberships; retirement requires no remaining
  active membership (Amendment 1).
- **[ADR-037](./ADR-037-importer-run-commit-strategy.md)** — the phase-2 it
  gates on `COMPLETED` is now membership-scoped; commit strategy unchanged
  (Amendment 1).
- **[ADR-047](./ADR-047-deletion-model.md)** — config deletion carries a
  cascade contract preserving Source + run history (Amendment 1).
- **[ADR-056](./ADR-056-importer-interface-signature.md)** — `context`
  gains `reportSourceIdentity` + `resolveTarget`; manifest gains
  `targetRefKey` (Amendment 1).
- **[ADR-065](./ADR-065-package-dependency-graph.md)** —
  `@componode/importer-docker` admitted to the lockstep importer set,
  contract-first (Amendment 1).
- **[ADR-077](./ADR-077-v1-entity-schema.md)** — schema inventory gains
  `importer_sources`, membership tables, and the `import_runs` changes
  (Amendment 2).
- **[ADR-116](./ADR-116-remote-import-agents.md)** — Agent-local target
  registry, `targetId` immutability, and allowlist preflight (Amendment 5).
