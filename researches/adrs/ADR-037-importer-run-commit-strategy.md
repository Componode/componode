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
ADR-036 Amendment 1 changed *what* phase 2 reconciles — from config touch
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
