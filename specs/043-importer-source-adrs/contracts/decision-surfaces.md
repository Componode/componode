# Contract — Decision-Surface Map

**Feature**: 043-importer-source-adrs

Every contract surface this feature ratifies, and the ADR that owns it
after the change. This is the compliance checklist for spec SC-001.

| #   | Contract surface                                                                                     | Owning ADR                                                     | Mechanism            |
| --- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | -------------------- |
| 1   | `ImporterSource` entity, provider-native identity, non-secret identity rule                          | **ADR-119** (new)                                              | New ADR              |
| 2   | Source lifecycle `ACTIVE`/`UNMONITORED`/`RETIRED`; explicit reversible retirement                    | **ADR-119**                                                    | New ADR              |
| 3   | One active config per Source; reattachment; config deletion → `UNMONITORED`                          | **ADR-119**                                                    | New ADR              |
| 4   | Source→Component / Source→ComponentInstance durable memberships                                      | **ADR-119**                                                    | New ADR              |
| 5   | `import_runs.sourceId` durable; `configId` nullable `ON DELETE SET NULL`                             | **ADR-119** + ADR-047 + ADR-077                                | New ADR + Amendments |
| 6   | Reconciliation scoped to source memberships; shared-Component rule; incomplete-run protection        | **ADR-036** Amendment 1 (+ ADR-037 Amendment 1)               | Amendment            |
| 7   | Source-identity reporting before asset yield (incl. empty inventory)                                 | **ADR-119** + **ADR-056** Amendment 1 (`reportSourceIdentity`) | New ADR + Amendment  |
| 8   | `manifest.targetRefKey`; `context.resolveTarget`; provider-agnostic target contract                  | **ADR-119** + **ADR-056** Amendment 1                          | New ADR + Amendment  |
| 9   | Agent-local versioned read-only target registry; immutable `targetId`; fail-before-network preflight | **ADR-116** Amendment 5                                        | Amendment            |
| 10  | `@componode/importer-docker` admitted to the lockstep importer set (contract now, package later)     | **ADR-065** Amendment 1                                        | Amendment            |
| 11  | Config-deletion cascade contract (refines hard-delete of `importer_configs`/`import_runs`)           | **ADR-047** Amendment 1                                        | Amendment            |
| 12  | Schema inventory records future `importer_sources` + membership tables                               | **ADR-077** Amendment 2                                        | Amendment            |
| 13  | `LEGACY_UNATTRIBUTED` stance (no auto-split/merge/rekey; per-importer migration waves)               | **ADR-119**                                                    | New ADR              |
| 14  | Run-commit/resume strategies unchanged                                                               | ADR-037 Amendment 1; ADR-038 review note                      | Review outcome       |

## Review-only outcomes (FR-008 record)

| ADR     | Conclusion                                                                                                  |
| ------- | ----------------------------------------------------------------------------------------------------------- |
| ADR-037 | Amendment 1: the phase-2 it gates on `COMPLETED` is now membership-scoped; commit strategy unchanged. |
| ADR-038 | No change: run-level restart + upsert idempotency unaffected by source scoping.                             |
| ADR-106 | No change: dated hardening assessment, not an enumerated contract surface.                                  |
| ADR-117 | No change: `AGENT_MANAGED` mechanism reused as-is; target profiles reference credential bundles.            |
