### ADR-047 — Deletion model

> **Status:** Ratified

**Context**: ADRs define `lifecycle`/`status` but never specify "delete"
across the schema.

**Decision**: **`lifecycle`/`status` are the soft-delete for graph entities;
hard-delete for operational entities.** `DigitalProduct`/`Component` use
`lifecycle=RETIRED`; `ComponentInstance` uses `status=GONE`; `ComponentGroup`
uses `lifecycle=RETIRED`. `importer_configs`, `sessions`, `import_runs`,
`Person`, `Team`, `LineOfBusiness` are hard-deletable. Bulk-retire-by-config
("retire all components last touched by config X") is an admin feature on top.

**Rationale**: `lifecycle` and `status` _are_ the soft-delete mechanism for
graph entities — adding a separate `deletedAt` creates a redundant field with
unclear semantics. Hard-delete for non-graph entities is correct (a deleted
user's session shouldn't linger). GDPR "delete my account" = hard-delete
`Person` after reassigning ownerships.

## Amendment 1 — Importer config deletion preserves Source and run history (2026-10-31, via ADR-119)

**Context**: `importer_configs` and `import_runs` were listed as
hard-deletable without qualification. [ADR-119](./ADR-119-importer-source-identity-and-lifecycle.md)
introduces `ImporterSource` — a durable provenance boundary that must
outlive the configs that feed it — so "hard-delete" needed a cascade
contract.

**Refinement**: The hard-delete classification stands, but deleting an
`ImporterConfig` now carries defined effects: `import_runs.configId`
becomes `NULL` (`ON DELETE SET NULL`) so run rows and their
`import_runs.sourceId` attribution survive; the bound `ImporterSource`
transitions to `UNMONITORED` (not deleted, not retired); Source→Component
and Source→ComponentInstance memberships persist unchanged. Explicit
Source `RETIRED` is a separate, reversible operator action — never a side
effect of config deletion.

---

**Amended by ADR-119**: `importer_configs`/`import_runs` remain
hard-deletable, but config deletion gains a cascade contract preserving
the `ImporterSource` and run history — see Amendment 1.

## Amendment 2 — Managed URL Check retention follows Source lifecycle (2026-11-03, ADR-126)

**Context**: Web/API importer configurations own managed URL Check
definitions, while URL Check rows and observations remain the operational
record. Deleting an ImporterConfig must not cascade its check history because
ADR-119 preserves the Source and its memberships as `UNMONITORED`.

**Refinement**: Deleting an ImporterConfig pauses its Source-owned checks
and preserves their definitions and observations. A managed URL Check and
its observations are hard-deleted only after a completed Source reconciliation
marks the associated ComponentInstance `GONE` and no effective Source
membership remains. A shared ComponentInstance retains its shared check.

---

**Amended by ADR-126**: ImporterConfig deletion pauses and preserves managed
URL Checks; check deletion follows the `GONE`/no-effective-membership rule.
