### ADR-125 — URL Check onboarding recovery and selector boundaries

> **Status:** Ratified
> **Spec:** `specs/054-url-check-onboarding`

**Context**: URL Check monitoring (ADR-123/ADR-124) left two onboarding
gaps. Composite Component creation did not expose all regular URL Check
fields, and an existing ACTIVE Component with zero `ComponentInstance`
rows had no supported path to create its first check. The monitoring ADRs
also used broad "authorized user/administrator" language while the
existing permission matrix already separates catalog writes from
Credential and Import Agent metadata reads.

**Decision**:

1. **`POST /api/v1/components/:id/instances` is a focused first-instance
   write**, guarded by `component:update` (EDITOR). The parent must exist,
   be `ACTIVE`, and have zero `component_instances`; otherwise the route
   returns `404 NOT_FOUND` or `409 CONFLICT`. The write creates one manual
   `RUNNING` instance and one `component_instance` `created` audit event
   inside a transaction. Server-derived identity is
   `externalId = manual:<component slug>` and a unique instance slug under
   ADR-046. This is not general instance CRUD.
2. **Composite create carries the full applicable URL Check create
   shape** — API authentication, credential key-name configuration,
   `availabilityTarget`, and `targetWindow` — and remains transactional:
   a validation failure creates no Component, instance, setup, or check.
3. **Selector permissions are enforced at write boundaries**, not only in
   the UI. Changing credential-bearing authentication (`credentialId`,
   `authMode`, or `authConfig`) requires `credential:read` (ADMIN);
   resubmitting an unchanged selection does not. Switching to
   `vantage = "AGENT"` or changing `agentId` requires `agent:read` (ADMIN);
   preserving an existing Agent vantage does not. Removing a Credential or
   switching an existing setup back to Hub remains an ordinary monitoring
   write. `urlCheck:*`, `monitoringSetup:update`, `component:create`, and
   `component:update` remain EDITOR.
4. **No schema migration** is required. Existing tables and audit
   conventions carry the feature, and URL Check state still never
   overwrites importer-reported `ComponentInstance.status`.

**Amendments to earlier ADRs**:

- Clarifies ADR-054 that `component:update` includes the focused
  zero-instance recovery write, without adding a permission.
- Clarifies ADR-123/ADR-124 role language: ordinary checks and Hub setup
  are EDITOR; Credential and Import Agent selection are ADMIN because they
  require existing `credential:read`/`agent:read` metadata access.

**Rationale**: A narrow endpoint closes the zero-instance dead end without
duplicating the full regular check editor or opening a broad manual
instance surface. Reusing existing `credential:read` and `agent:read`
permissions preserves least privilege and prevents crafted API writes from
bypassing disabled selectors.

**Alternatives considered**:

- **Instance-plus-checks recovery endpoint** — rejected. It would duplicate
  the regular editor and blur the clarified two-step recovery.
- **General manual instance CRUD** — rejected. This feature only needs
  first-instance recovery; broader instance authoring should be separately
  ratified.
- **New `credential:select`/`agent:select` permissions** — rejected. The
  existing read permissions already model access to the selector metadata.
