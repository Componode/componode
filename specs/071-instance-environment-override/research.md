# Research: Manual environment override for ComponentInstances

Phase 0 decision record. All NEEDS CLARIFICATION items resolved; no open questions remain.

## R1 — Where does the override live? (data model)

**Decision**: Three nullable columns on `component_instances` — `environmentOverride` (text, CHECK against core `ENVIRONMENTS`), `environmentOverriddenBy` (uuid, plain — same convention as `createdBy`, no FK so audit survives user deletion), `environmentOverriddenAt` (timestamptz). Effective environment = `COALESCE(environmentOverride, environment)`, computed at API serialization. The existing `environment` column keeps its exact semantics: the importer-reported/baseline value, still rewritten on every import run.

**Rationale**:

- **Import path stays untouched.** `import-run-service` already writes `environment: instance.environment` unconditionally on upsert — that write now lands in the *reported* slot by definition, and the override columns are simply never in `instanceValues`. Zero changes to the hot reconciliation path, zero risk to importer contract (constitution II).
- **Explicit flag beats derived state.** `environmentOverride IS NOT NULL` is an unambiguous override predicate — no coincidence edge cases (e.g. human sets env equal to reported value), and it carries actor/timestamp provenance for free (FR-005).
- **Reset is trivial and always correct**: `environmentOverride → NULL` makes effective fall back to the *latest* reported value — which keeps refreshing underneath while overridden (FR-004, spec edge case).
- **Principle V alignment**: factual layer (what the source reported) and meaning layer (human correction) coexist as separate columns instead of one contested field.

**Alternatives considered**:

- **B. Swap semantics — `environment` becomes human-effective, new `reportedEnvironment` column receives importer writes.** Rejected: requires changing the import upsert (`environment:` → `reportedEnvironment:` in `instanceValues` + inserts), "overridden" becomes a *derived* `environment IS DISTINCT FROM reportedEnvironment` predicate with a real (if cosmetic) coincidence edge, and every existing reader of `environment` silently changes meaning. More churn, weaker provenance.
- **C. Generic `overrides` JSONB map** (`{"environment": "PRODUCTION"}`). Rejected: speculative generality for one field (YAGNI); typed columns give CHECK constraints, FK-able actor, and clear audit diffs.
- **D-embedded. Keep override inside `details`/`rawConfig`.** Rejected: `rawConfig` is importer-emitted allowlisted snapshot; `details` doesn't exist on instances; mixing human state into importer payloads violates the factual/meaning split.

## R2 — API surface

**Decision**: `PATCH /component-instances/{instanceId}` with body `{ "environment": "<ENV>" | null }` — the key is required; `null` clears the override. Response `{ instance: ComponentInstance }`. Permission `component:update` (same as `POST /components/:id/instances` and component PATCH). Errors reuse existing codes: 400 validation, 401, 403, 404 `NOT_FOUND` — **no new error codes** (keeps `docs:oracle:check` clean).

**Rationale**: flat item-route matches the `/url-checks/{id}` precedent — creation nested under the parent (`/components/:componentId/url-checks`, `/components/:id/instances`), item operations on the sub-entity's own prefix. `environment: null` as reset is explicit and unambiguous (absent key = 400, so clients can't accidentally no-op).

**Alternatives considered**:

- **Nested `PATCH /components/{cid}/instances/{iid}`**: more REST-pure but verbose; no precedent for two-level nesting in this API.
- **`PUT /component-instances/{id}/environment`** or a `reset` sub-route: more endpoints for one field; `null`-clears is sufficient and self-documenting in OpenAPI.
- **Reuse `PATCH /components/:id`**: wrong resource — environment lives on instances, components have no env.

## R3 — Payload shape (backward compatibility)

**Decision**: `environment` in `ComponentInstance` payloads becomes the **effective** value (what every consumer already treats as "the environment" — badges, sorts, filters keep working). Additive fields: `reportedEnvironment` (the non-override column value — always present), `environmentOverride` (value or `null` — doubles as the overridden flag), `environmentOverriddenBy`, `environmentOverriddenAt`.

**Rationale**: old clients automatically show catalog truth (effective); provenance is opt-in via new fields. `reportedEnvironment == environment` when not overridden — redundant but explicit and cheap. When overridden, `reportedEnvironment` is the freshest importer-reported value because importers keep writing the column.

**Alternatives considered**: keep `environment` = reported + add `effectiveEnvironment` — rejected; every existing consumer (badge, ordering, future filters) would silently show the *reported* value, i.e. the bug the user is reporting would persist for all non-updated surfaces.

## R4 — Serialization sites

**Decision**: one shared `toApiComponentInstance(row)` mapper in `component-instance-service.ts` applied at every API boundary that emits instance rows: `getComponentById` (`instances[]`), `POST /components/:id/instances` response, composite `POST /components` `{instance}` response, and the component-relationships instance payloads (verified during implementation — `instances` is a relationship kind). Audit-query joins read the column for display labels only — reported value is the right thing to show in "what the importer saw" contexts; override transitions are captured in the audit `changes` payload itself.

**Rationale**: single mapper = single place where effective/provenance semantics live; drift-proof.

## R5 — Slug and identity

**Decision**: unchanged. `generateInstanceSlug(componentSlug, environment, externalId)` keeps deriving from the *reported* environment at import time; the PATCH never touches `slug`, `externalId`, memberships, or URL-check bindings. An overridden instance's slug may keep a reported-env segment — acceptable: slug is opaque identity, not display truth (FR-008 prioritizes stability over cosmetics).

**Rationale**: URL checks bind by `componentInstanceId`; source memberships by instance ID; audit by entity ID — none key on environment, so identity is structurally safe. Freezing slug on override would add a second identity concept for zero user value.

## R6 — Frontend edit affordance

**Decision**: on the component detail instances table, EDITOR+ users (`canAccess(role, "EDITOR")` — same gate as create buttons) get an edit affordance on the environment cell opening a small dialog: current effective env, "Importer reported: X" line, a Select of the six `ENVIRONMENTS`, Save; when overridden, a "Reset to reported" action (sends `environment: null`). Overridden rows show a visual indicator (badge variant or icon) and the reported value in the expanded `InstanceDetails` row. New `useUpdateComponentInstance` mutation invalidates the component detail query.

**Rationale**: dialog (not inline Select) matches the codebase's edit patterns (component-edit-dialog, group edit dialog) and gives room for provenance + reset without crowding the table.

## R7 — Audit

**Decision**: `writeEntityChange({ entityType: "component_instance", action: "update", changes: { environment, previousEnvironment, environmentOverride, reportedEnvironment } })` inside the PATCH transaction — same convention as instance `status_change`/`created` events. No new audit action vocabulary (actions are free-form strings per entity).

## R8 — Migration

**Decision**: `031_instance_environment_override.ts` — `addColumn` ×3 (all nullable, no defaults → no table rewrite), CHECK `environmentOverride IS NULL OR environmentOverride IN (...)` built from core `ENVIRONMENTS` via the same `sql.join` pattern as migration 001's `component_instances_environment_check`. Down migration drops columns + constraint. No backfill needed (all existing rows correctly start unoverridden).

## Open questions

None.
