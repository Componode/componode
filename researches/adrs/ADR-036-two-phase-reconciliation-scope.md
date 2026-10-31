### ADR-036 — Two-phase reconciliation scope

> **Status:** Ratified

**Context**: Q35's orphan logic needs a scope boundary — what set of existing
rows do we compare the current yield against?

**Decision**: **Two phases.** (1) Per-component during the run: orphan
`ComponentInstance` rows absent from the yielded `instances[]`. (2) At
successful run end: components previously touched by this importer config but
not yielded this run get `Component.lifecycle = RETIRED`, cascading to orphan
their instances. Phase 2 only runs if `import_runs.status = COMPLETED`.

**Rationale**: Phase 1 handles instance-level disappearance; phase 2 handles
whole-component disappearance (terminated EC2 instance no longer yielded).
Uses `ComponentInstance.status` and `Component.lifecycle` for their designed
purposes. Partial-run risk mitigated by gating phase 2 on successful
completion.

## Amendment 1 — Source-scoped reconciliation (2026-10-31, via ADR-119)

**Context**: The original phase-2 scope was "components previously touched
by this importer config." Configs are editable execution records — deleting
or recreating one would orphan the provenance boundary, and a config-scoped
retirement cannot distinguish "the workload disappeared" from "a different
source still reports the same logical Component."

**Refinement**: The reconciliation unit is the **Source membership**
([ADR-119](./ADR-119-importer-source-identity-and-lifecycle.md)), not the
config. Phase 1 orphans `ComponentInstance` rows absent from the yield
_within the reporting Source's own instance memberships_. Phase 2 — still
gated on `import_runs.status = COMPLETED` — deactivates only that Source's
absent Component memberships. A shared Component/Instance remains `ACTIVE`
while any Source reports it; `RETIRED`/`GONE` apply only when no active
Source membership remains. A failed or incomplete run still performs no
retirement: a failed authoritative enumeration is not a snapshot.

---

**Amended by ADR-119**: reconciliation scope moves from "components
previously touched by this importer config" to the reporting Source's
durable memberships — see Amendment 1.
