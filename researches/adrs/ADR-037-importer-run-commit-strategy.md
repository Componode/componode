### ADR-037 — Importer run commit strategy

> **Status:** Ratified

**Context**: An importer run yields thousands of assets. What is the
transaction boundary?

**Decision**: **Per-asset incremental commits + phase-2 gated on `COMPLETED`.**
Each yielded asset upserts in its own transaction. Phase-2 reconciliation
([ADR-036](./ADR-036-two-phase-reconciliation-scope.md)) only runs if the importer run completes successfully. A failed run
leaves a partial inventory; the next successful run's phase 2 cleans up.

**Rationale**: Survives real-world importer scales (AWS accounts with tens of
thousands of resources) without holding a multi-minute transaction. Preserves
the [ADR-036](./ADR-036-two-phase-reconciliation-scope.md) invariant that reconciliation only happens on a complete view.

## Amendment 1 — Phase-2 scope becomes membership-scoped (2026-10-31, via ADR-119)

**Context**: This strategy gates phase-2 reconciliation on `COMPLETED` by
reference to [ADR-036](./ADR-036-two-phase-reconciliation-scope.md).
ADR-036 Amendment 1 changed _what_ phase 2 reconciles — from config touch
to the reporting Source's durable memberships ([ADR-119](./ADR-119-importer-source-identity-and-lifecycle.md)).

**Refinement**: The commit strategy is unchanged — per-asset incremental
commits and the `COMPLETED` gate stand exactly as ratified. Only the
referent moves: the phase-2 this decision protects is now
membership-scoped per ADR-036 Amendment 1, so a failed run still leaves a
partial inventory for that Source and performs no retirement.

---

**Amended by ADR-119**: the phase-2 reconciliation this strategy gates on
`COMPLETED` is now scoped to source memberships rather than config touch —
see Amendment 1 and [ADR-036](./ADR-036-two-phase-reconciliation-scope.md)
Amendment 1. Per-asset incremental commits and the completion gate are
unchanged.

## Amendment 2 — Configured URL rows define a complete inventory (2026-11-03, ADR-126)

**Context**: The Web/API profile importers evaluate a finite configured set
of ComponentInstances. A remote endpoint can fail while the configured
inventory is still completely known.

**Refinement**: A run that evaluates every configured profile and instance
is `COMPLETED`, even when an endpoint's result is `ERROR`; the failure is
recorded on that ComponentInstance. A fatal/configuration failure or
incomplete run remains `FAILED` and performs no phase-2 reconciliation.
The ImportRun status set does not gain `PARTIAL`.

---

**Amended by ADR-126**: Web/API endpoint failures are per-instance outcomes
within a completed configured inventory; phase-2 reconciliation remains
gated on `COMPLETED`.
