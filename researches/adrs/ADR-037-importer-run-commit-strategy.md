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
---

**Amended by ADR-119**: the phase-2 reconciliation this strategy gates on
`COMPLETED` is now scoped to source memberships rather than config touch —
see [ADR-036](./ADR-036-two-phase-reconciliation-scope.md) Amendment 1.
Per-asset incremental commits and the completion gate are unchanged.
