# Data Model — Conceptual Entities Being Ratified

**Feature**: 043-importer-source-adrs

No schema ships in this spec. This document records the _conceptual_
model the ADRs ratify; the concrete DDL/migrations land in the
ImporterSource core spec (Phase 1).

## ImporterSource

Durable internal provenance record — "which external system reported this
data."

| Concept        | Ratified rule                                                                                                                                                           |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity       | Internal UUID v7 PK; provider-native canonical `externalIdentity` (non-secret); display label separate from identity key.                                               |
| Lifecycle      | `ACTIVE` → `UNMONITORED` (config deleted/unbound) → `ACTIVE` (reattach or same identity returns); `ACTIVE`/`UNMONITORED` → `RETIRED` (explicit, reversible → `ACTIVE`). |
| Config binding | Exactly one active `ImporterConfig` may bind a Source; a Source may outlive many configs.                                                                               |
| Distinct from  | `ImporterConfig` (editable execution state), Agent target profile (access route), catalog `Component` (Source is never a Component).                                    |

## Source membership

Durable association recording "Source S reported Component C / Instance
I."

| Concept        | Ratified rule                                                                                                                      |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Scope          | Two membership kinds: Source→Component, Source→ComponentInstance.                                                                  |
| Durability     | Independent of `lastSeenInRunId` and of `import_runs`/config rows; survives run and config deletion.                               |
| Reconciliation | A `COMPLETED` run deactivates only its own Source's absent memberships; GONE/RETIRED apply only when no active membership remains. |
| Details        | Source-specific metadata lives on the membership; shared canonical facts live on `Component.details`.                              |

## ImportRun attribution

| Concept    | Ratified rule                                                                                              |
| ---------- | ---------------------------------------------------------------------------------------------------------- |
| `sourceId` | Durable FK to `importer_sources`; set at run start from the reported source identity.                      |
| `configId` | Becomes nullable; `ON DELETE SET NULL` — config deletion preserves the run row and its Source attribution. |

## Target profile (Agent-local)

Access-route descriptor resolved on the Agent, provider-agnostic.

| Concept    | Ratified rule                                                                                                                                           |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Registry   | Versioned, read-only JSON file under `SECRETS_DIR` (`<name>-targets.json`); unknown/malformed profiles fail before network access.                      |
| `targetId` | Immutable access-route identifier; changing endpoint/transport = new profile ID. Separate from Source identity and Component identity.                  |
| Reference  | Config scope carries `targetId`; `ImporterManifest.targetRefKey` declares which scope key holds it; `context.resolveTarget` resolves the typed profile. |

## Legacy boundary

`LEGACY_UNATTRIBUTED` is the fallback provenance marker for pre-existing
rows. Ratified rule: preserve as-is until each importer's named migration
wave; never auto-split, merge, or rekey.
