### ADR-052 — Audit model: three-tier

> **Status:** Ratified

**Context**: The ADRs define `createdBy`/`lastSeenAt` but no unified audit
model. For a tool that curates an asset graph, "who changed what and when" is
a real operational + compliance need.

**Decision**: **Three-tier audit.**
1. **Run-summary for importers** — `import_runs` records `assetsProcessed`,
   `assetsCreated`, `assetsUpdated`, `instancesOrphaned`, `componentsRetired`
   per run.
2. **Transition-level `entity_changes`** — logs consequential importer state
   changes (`lifecycle` flips, `status` flips, new component discovered) + all
   human entity edits. Routine attribute re-upserts are NOT logged.
3. **`edge_changes`** — logs all edge mutations (`COMPOSES`/`CONSUMES_FROM`/
   `DEPENDS_ON`/`SOURCES_FROM`/`EXPOSES`/`OWNS`/`BELONGS_TO` ADDED/REMOVED)
   with an optional `reason` field.

> **UPDATE (Session 2, [ADR-100](./ADR-100-audit-log-integrity.md))**: The audit tables (`entity_changes`,
> `edge_changes`, `import_run_errors`) are **append-only** — enforced by
> `BEFORE UPDATE OR DELETE` triggers that raise an exception
> unconditionally. No role (including Admin) can modify or delete audit
> entries. Corrections are new entries (`action: CORRECTION`, referencing
> the original entry's ID). `import_runs` is NOT append-only but is
> immutable after terminal state (`COMPLETED`/`FAILED`/`CANCELLED`/
> `INTERRUPTED`) via a `BEFORE UPDATE` trigger. `entity_changes` and
> `edge_changes` carry denormalized `createdByName`/`updatedByName`
> snapshots (captured at write time) for historical context. The
> `createdBy`/`updatedBy` FKs to `persons` are `ON DELETE SET NULL` (when a
> person is hard-deleted per [ADR-047](./ADR-047-deletion-model.md), the audit entry's FK is nulled but
> the name snapshot retains the name — a deliberate tradeoff of audit
> integrity vs. right-to-be-forgotten). No retention policy in v1.

**Rationale**: Matches the curation asymmetry ([ADR-019](./ADR-019-hierarchy-authoring-manual-for-v1.md)): the meaning layer
(edges, ownership, composition) is human-judgment, high-value, low-frequency —
audit it fully. The factual layer (component attributes) is importer-driven,
high-frequency, low-judgment — logging every import-driven attribute change is
noise. The transition-logging answers "what did this importer run change that
matters?" at row granularity, while the run summary answers "what was the
overall blast radius?"

---

**Amended by ADR-116**: the model gains the `import_agent` entity type for
agent lifecycle transitions (`created`/`enrolled`/`token_rotated`/
`revoked`/`deleted`; actor is the admin, or `agent:<name>` for
agent-originated events). High-frequency connection events are recorded
in the operational `agent_sessions` table instead of append-only audit —
the same "consequential transitions audited, routine noise is not"
asymmetry. Rejected connection attempts write no audit rows.