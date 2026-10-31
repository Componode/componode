### ADR-056 — Importer interface signature (supersedes ADR-025)

> **Status:** Ratified

**Context**: [ADR-025](./ADR-025-importer-interface-pull-only-asyncgenerator.md) says `run(config, secretResolver)`. [ADR-055](./ADR-055-importer-secret-resolution.md) pre-resolves
secrets. The signature needs reconciliation + observability/cancellation
hooks.

**Decision**: **`run(config, secrets, context): AsyncGenerator<DiscoveredAsset>`
where `context = {runId, logger, signal, reportPhase, tracer?}`.** `config` is
the typed scope from `importer_configs.scope` (validated against the
importer's declared schema). `secrets` is the resolved `Record<string,
string>`. `context.logger` is the abstracted `Logger` from `core` ([ADR-067](./ADR-067-logger-abstraction.md)).
`context.signal` is an `AbortSignal` for cancellation ([ADR-058](./ADR-058-importer-cancellation.md)).
`context.reportPhase(name)` updates `import_runs.currentPhase` for progress
([ADR-060](./ADR-060-importer-run-coordination.md)). `context.tracer?` is an optional abstracted `Tracer` for opt-in
child spans ([ADR-068](./ADR-068-opentelemetry-tracing-integration.md)). **This supersedes [ADR-025](./ADR-025-importer-interface-pull-only-asyncgenerator.md)'s `run(config, secretResolver)`
signature.**

**Rationale**: Pre-resolved `secrets` replaces `secretResolver` ([ADR-055](./ADR-055-importer-secret-resolution.md)).
`config` is just the `scope` (the importer doesn't need operational fields).
`context` is the necessary addition: [ADR-032](./ADR-032-observability-full.md) mandates Pino + OTel from day
one; the importer needs a logger to participate; `AbortSignal` is essential
for "admin cancels a runaway run"; `runId` enables log correlation;
`reportPhase` enables progress reporting without contract pollution.

## Amendment 1 — Source identity reporting and target resolution (2026-10-31, via ADR-119)

**Context**: [ADR-119](./ADR-119-importer-source-identity-and-lifecycle.md)
makes the `ImporterSource` the durable provenance boundary, and remote
importers need a vetted way to reference Agent-local access routes. Both
extend the enumerated `context` surface this ADR presents as closed.

**Refinement**: `context` gains two members.
`context.reportSourceIdentity(identity)` — the importer reports its
provider-native canonical source identity **before** the first asset
yield, on every run, including empty inventories; the core registers or
matches the `ImporterSource` and stamps `import_runs.sourceId` from it.
`context.resolveTarget(targetId)` — resolves the typed, non-secret target
profile validated by the executor (hub or Agent); calling it is valid
only when the importer's manifest declares `targetRefKey`.
`ImporterManifest` gains optional **`targetRefKey`**: the name of the
config-scope key that carries the `targetId` referencing an entry in the
Agent-local target registry (ADR-116 Amendment 5). The generator contract
(`AsyncGenerator<DiscoveredAsset>`, pull-only, never touches the DB) is
unchanged — both additions report to or read from the executor, never the
database.

---

**Amended by ADR-119**: `context` gains `reportSourceIdentity` +
`resolveTarget`, and `ImporterManifest` gains `targetRefKey` — see
Amendment 1.

## Amendment 2 — manifest adoption flags and in-process resolveTarget (2026-10-31, spec 044)

**Refinement**: `ImporterManifest` gains `targetRefKey?: string` (names the
config-scope key carrying the `targetId`) and
`reportsSourceIdentity?: boolean` (declares the importer reports source
identity before first yield). The flag distinguishes adopting importers
(contract violation when a run yields without reporting —
`errorType = CONTRACT_VIOLATION`) from not-yet-migrated ones (legacy
unattributed path until their named wave). `ImporterContext`'s new
members are required; the in-process `resolveTarget` is a stub that
always throws — target profiles resolve only on Import Agents
(ADR-116 Amendment 5/6).
