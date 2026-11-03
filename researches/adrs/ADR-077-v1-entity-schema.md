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
>
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
Unlike those ownership references, the association is _advisory_: deleting
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

---

**Amended by ADR-122**: schema gains `docker_targets` and `import_runs.cancelReason` (spec 049).

---

## Amendment 3 — URL Check monitoring records (2026-11-01, ADR-123)

**Context**: [ADR-123](./ADR-123-http-url-check-monitoring.md) establishes
durable URL Check definitions and per-attempt observation history separate
from importer runs and ImporterSource provenance. The consolidated v1 schema
inventory must include both records; column-level design remains with the
feature spec and plan.

**Refinement**: Add `url_checks` for configured checks associated with a
`component_instances` row and `url_check_observations` for timestamped probe
results associated with a check. Detailed observations are retained for 30
days. Exact fields, indexes, retention mechanics, and the storage of
Component-level shared defaults are left to the feature spec and plan.

---

**Amended by ADR-123**: `url_checks` and `url_check_observations` join the v1
schema inventory; see Amendment 3.

## Amendment 4 — `component_monitoring_setups` and URL Check column design (2026-11-01, ADR-124)

**Context**: [ADR-124](./ADR-124-url-check-execution-surfaces.md) ratifies
the column-level design Amendment 3 deferred to the feature spec, plus the
Component-level shared-defaults record.

**Refinement**:

1. Add `component_monitoring_setups` — one row per Component (`componentId`
   UNIQUE, `ON DELETE CASCADE`): `cadenceSeconds` (default 300, CHECK
   60–86400), `vantage` (`HUB`|`AGENT`), `agentId` (nullable FK →
   `import_agents`, `ON DELETE RESTRICT`; required iff `vantage='AGENT'`).
2. `url_checks` carries `setupId` (CASCADE), `componentInstanceId`
   (CASCADE — must belong to the setup's Component), `credentialId`
   (nullable FK → `credentials`, RESTRICT; required for any
   `authMode != NONE`), `name`, `url`, `method` (`GET`|`HEAD`, default
   `GET`), `enabled` (default true), `cadenceSeconds` (nullable override),
   `successPolicy` jsonb (default 2xx), `authMode`
   (`NONE`|`BASIC`|`BEARER`|`CUSTOM_HEADERS`), `authConfig` jsonb
   (credential key-name mappings only — never values),
   `availabilityTarget` + `targetWindow` (`24H`|`7D`|`30D`; set together
   or both null), and `nextProbeAt` (null while disabled).
3. `url_check_observations` is append-only: `urlCheckId` (CASCADE),
   `scheduledAt` (the slot the observation belongs to), `outcome`
   (`SUCCESS`|`FAILURE`|`MISSED`), `httpStatus`, `durationMs`,
   `errorType` (bounded enum), `vantage`, `agentId`. Retained 30 days,
   then purged.

---

**Amended by ADR-124**: `component_monitoring_setups` joins the v1 schema
inventory and the URL Check column-level design deferred in Amendment 3 is
ratified; see Amendment 4.

## Amendment 5 — Source-managed URL Check definitions (2026-11-03, ADR-126)

**Context**: ADR-126 makes Web/API ImporterConfig the canonical definition
source for one managed URL Check per configured ComponentInstance while
retaining `url_checks` and `url_check_observations` as operational records.
Source-scoped sharing and reconciliation need a typed persistence record.

**Refinement**:

1. `url_checks` gains a nullable stable `managedKey`, unique per
   ComponentInstance when present. Null identifies legacy/manual rows.
2. Add `source_url_check_memberships`, a typed Source→URL Check junction
   recording the stable check key, membership activity, and configured
   enabled state. A shared URL Check row may have multiple Source memberships.
3. A check is scheduled while at least one effective, enabled Source
   membership declares it. Conflicting definitions for the same managed key
   are rejected; they are never resolved by last-writer-wins.
4. Existing legacy/manual URL Check rows remain readable but are disabled
   during the migration. Observation shape and the 30-day retention job are
   unchanged; explicit GONE/unshared cleanup may remove a check and its
   observations earlier.

---

**Amended by ADR-126**: the schema gains a managed-check key and typed
Source→URL Check memberships; existing observation records remain unchanged.
