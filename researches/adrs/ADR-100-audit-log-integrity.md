### ADR-100 — Audit log integrity

> **Status:** Ratified

**Context**: [ADR-052](./ADR-052-audit-model-three-tier.md) defines audit tables but no rule says they're
tamper-proof. A compromised Admin could edit `entity_changes` to cover
tracks.

**Decision**: **`entity_changes`, `edge_changes`, `import_run_errors` are
append-only.** `BEFORE UPDATE OR DELETE` trigger on all three raises an
exception unconditionally. No role — including Admin — can modify or delete
audit entries. Corrections are new entries (`action: CORRECTION`,
referencing the original entry's ID). `import_runs` is NOT append-only but
is immutable after terminal state (`COMPLETED`/`FAILED`/`CANCELLED`/
`INTERRUPTED`) via a `BEFORE UPDATE` trigger checking `OLD.status`.
Operator notes on a run are `entity_changes` entries, not mutations on
`import_runs`. **GDPR interaction**: `entity_changes.createdBy`/`updatedBy`
are nullable FKs to `persons` with `ON DELETE SET NULL`. Denormalized
`createdByName`/`updatedByName` snapshots (captured at write time) retain
the name for historical context (deliberate tradeoff: audit integrity vs.
right-to-be-forgotten). No retention policy in v1.

**Rationale**: DB-level triggers are un-bypassable (application bugs can't
skip them). The `import_runs` terminal-state immutability prevents
post-hoc manipulation of run records. The GDPR `ON DELETE SET NULL` +
denormalized name snapshot preserves the audit trail's usefulness while
respecting hard-delete of persons. The name snapshot tradeoff is documented
(audit integrity wins over complete right-to-be-forgotten for historical
records).

---

**Amended by ADR-116**: `agent_sessions` is explicitly outside the
append-only trigger protection — it is operational connection telemetry,
not an audit guarantee.