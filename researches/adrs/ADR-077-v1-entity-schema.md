### ADR-077 — v1 entity schema (consolidated)

> **Status:** Ratified

**Context**: Across ADRs + Q1–Q51 we accumulated entity definitions in pieces.
The full schema needs consolidation.

**Decision**: **Full v1 schema (27 tables) approved as proposed in Q45 +
ComponentGroup addition.** See `specs/001-foundation/data-model.md` for the
complete column-level reference. Key entities:
`digital_products`, `components`, `component_instances`, `component_groups`,
`line_of_businesses`, `teams`, `persons` (unified Person/UserAccount per
[ADR-033](./ADR-033-person-useraccount-unification.md)). Junction tables: `product_composes`, `product_consumes_from`,
`product_depends_on_component`, `component_depends_on_component`,
`component_sources_from`, `component_exposes`. FK columns for 1-to-many:
`digital_products.lobOwnerId`/`teamOwnerId`, `components.teamOwnerId`/
`componentGroupId`, `persons.teamId`. Operational: `importer_configs`,
`import_runs`, `import_run_errors`, `sessions`, `oidc_config`, `app_settings`,
`password_reset_tokens`. Audit: `edge_changes`, `entity_changes`. Kysely:
`kysely_migration`, `kysely_migration_lock`. **Slug on `persons`/`teams`/`LOBs`**
(URL consistency). **Nullable `createdBy`/`updatedBy`** (importer-driven changes
have no human actor). **Nullable `triggeredBy`** for scheduled runs.

> **UPDATE (Session 2, [ADR-099](./ADR-099-secure-password-and-credential-handling.md)/100)**: Three additions from the secure
> development grilling:
> 1. **`password_reset_tokens`** table (table 28) — `id uuid PK`, `userId`
>    FK→`persons`, `tokenHash text not null` (SHA-256 of the 32-byte reset
>    token), `expiresAt timestamptz not null`, `usedAt timestamptz` (nullable,
>    set when the token is consumed), `createdAt timestamptz not null`.
> 2. **`entity_changes`/`edge_changes`** carry denormalized
>    `createdByName`/`updatedByName` (text, captured at write time) for
>    historical context when the `persons` FK is nulled ([ADR-100](./ADR-100-audit-log-integrity.md)'s GDPR
>    `ON DELETE SET NULL`). The `createdBy`/`updatedBy` FKs are
>    `ON DELETE SET NULL`.
> 3. **`sessions.id`** is `text` (not `uuid`) — holds a 32-byte
>    cryptographically random base64url token ([ADR-099](./ADR-099-secure-password-and-credential-handling.md)'s exception to
>    [ADR-045](./ADR-045-entity-identifier-format.md)). All other entity PKs remain `uuid` (UUID v7).
>
> **Append-only triggers** ([ADR-100](./ADR-100-audit-log-integrity.md)): `BEFORE UPDATE OR DELETE` triggers on
> `entity_changes`, `edge_changes`, `import_run_errors` raise an exception
> unconditionally. `BEFORE UPDATE` trigger on `import_runs` raises if
> `OLD.status` is terminal (`COMPLETED`/`FAILED`/`CANCELLED`/`INTERRUPTED`).

**Rationale**: Consolidates 50+ decisions into one referenceable schema. The
`ComponentGroup` (table 26) + `components.componentGroupId` FK (27) were added
in the Session 2 review of Principle IV — a first-class entity for human-
declared equivalence across distinct source assets, NOT a graph node (no
`DEPENDS_ON` to a group; products depend on member components individually).

## Amendment 1 — `teams.lobId` (2026-10-26, spec 034)

**Context**: The spec's enumerated FK list was presented as closed, but the
ux-rewrite gap G12 requires a Team → Line of Business association: teams may
serve at most one LOB so the product form can group its team picker by the
product's LOB and team detail can name the LOB it belongs to.

**Refinement**: `teams.lobId uuid NULL → line_of_businesses(id) ON DELETE
SET NULL` joins the 1-to-many FK list — same advisory-ownership shape as
`digital_products.lobOwnerId`, `components.teamOwnerId`, `persons.teamId`.
Unlike those ownership references, the association is *advisory*: deleting
a LOB clears the link on its teams (set-null) rather than blocking, and the
API does not enforce consistency between a product's `lobOwnerId` and its
`teamOwnerId`'s LOB. Team read payloads carry the resolved `lob` summary so
clients never render a raw identifier.

## Amendment 2 — ImporterSource tables and run attribution (2026-10-31, via ADR-119)

**Context**: [ADR-119](./ADR-119-importer-source-identity-and-lifecycle.md)
ratifies `ImporterSource` as the durable provenance boundary for imported
data. This consolidated schema needs the corresponding tables recorded so
it remains the complete entity inventory — the DDL itself ships in the
ImporterSource core spec's migration.

**Refinement**: The schema gains `importer_sources` (UUID v7 PK,
provider-native canonical `externalIdentity`, display metadata,
`ACTIVE`/`UNMONITORED`/`RETIRED` lifecycle) and two membership tables —
Source→Component and Source→ComponentInstance — keyed by
`importer_sources.id`, independent of `lastSeenInRunId` and `import_runs`
retention. `importer_configs` gains a nullable Source-binding column
(one active config per Source — see ADR-119 item 3). `import_runs` gains
a durable `sourceId` FK and its `configId` becomes nullable with
`ON DELETE SET NULL` (run history survives config deletion — see ADR-047
Amendment 1).

---

**Amended by ADR-119**: `importer_sources` + Source→Component/
ComponentInstance membership tables join the schema inventory, and
`import_runs` gains `sourceId` + nullable `configId` — see Amendment 2.
