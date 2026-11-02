# Research: URL Check Onboarding Completion

## Decision: Add a focused first-instance endpoint

`POST /api/v1/components/:id/instances` creates a manual `ComponentInstance` on an ACTIVE Component with zero existing instances. It is protected by `component:update` (EDITOR) and returns `{instance}`.

**Rationale**: The clarified flow saves the first instance as a distinct step, then reuses the regular check editor. A narrow endpoint avoids a second composite write contract and avoids duplicate Components.

**Alternatives considered**: a combined instance-plus-checks write (rejected; it would duplicate the regular editor and blur the clarified two-step recovery); reusing `PATCH /components/:id` (rejected; it would turn a child collection write into a nonstandard update payload).

## Decision: Preserve composite transaction semantics

The existing `POST /components` transaction remains the atomic new-Component path. It accepts the full check payload supported by `createUrlCheckSchema`, including auth and target fields.

**Rationale**: New Components still need all-or-nothing creation; the separate recovery path is intentionally non-atomic after the first instance is saved.

## Decision: Enforce selector roles at write boundaries

`credentialId != null` requires `credential:read`; `vantage === "AGENT"` or a non-null `agentId` requires `agent:read`. Existing `credential:read` and `agent:read` are ADMIN, so Editors can manage ordinary checks and Hub setup while only Admins attach Credentials or Agents.

**Rationale**: This implements the clarified least-privilege boundary consistently for UI and crafted API requests.

**Alternatives considered**: adding new narrower permissions (rejected; existing `credential:read`/`agent:read` already model metadata access and no new grants are needed); relying on disabled UI controls only (rejected; a crafted request could bypass the selector).

## Decision: Reuse shared check controls and validation

The repeated-row editor gets the regular editor's API auth controls (API category only), Credential key-name inputs, optional availability target, and target window. Shared presentation/validation helpers keep create and edit behavior aligned.

**Rationale**: The spec requires parity for applicable fields and the regular editor is the source of truth.

## Decision: No database migration

All required fields already exist: `component_instances` for the first instance, and `url_checks` for `authMode`, `credentialId`, `authConfig`, `availabilityTarget`, and `targetWindow`.

## ADR/docs impact

This introduces a new API route and narrows interpretation of existing monitoring writes, so spec 054 adds `ADR-125` and back-pointers/index entries, plus `docs/openapi.yaml`, generated `docs/api.md`, `docs/url-checks.md`, `docs/using-the-catalog.md`, and `docs/roadmap.md` updates in the same change.
