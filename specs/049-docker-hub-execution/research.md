# Research: Docker Hub execution and managed targets

## Decision: Executor-local target resolution

Hub resolves `scope.targetId` from `docker_targets`; Agent resolves the same scope key from `${SECRETS_DIR}/docker-targets.json`. Both executors return a non-secret profile through `context.resolveTarget(targetId)` before importer execution.

**Rationale**: preserves the importer contract and prevents raw endpoints or credentials from entering importer scope.

**Alternatives considered**: Hub registry file (rejected — user selected database-managed records); profile in config scope (rejected — bypasses the trusted allowlist).

## Decision: Manifest-provided target-profile schema

`ImporterManifest` may declare `targetProfileSchema`, a Zod schema for the executor-local profile. Hub uses it for create/update validation and run/test preflight; Docker supplies its existing discriminated union.

**Rationale**: keeps provider-specific profile validation in the importer package while avoiding a second backend copy. The schema is not serialized to the frontend.

**Alternatives considered**: duplicate schema in backend (rejected — drift); move Docker schema to core (rejected — core remains provider-agnostic); direct backend import of importer internals (rejected — use the manifest contract).

## Decision: `docker_targets` table

Rows use UUIDv7 primary keys and a separate unique immutable `targetId` selector. `label`/`description` are mutable; `profile` is strict JSONB; `enabled` controls availability. Transport, endpoint, pinning, context, and `*Key` fields are immutable because profile updates are not offered.

**Rationale**: immutable routes preserve audit and config semantics; the selector keeps the existing `targetId` scope contract.

**Alternatives considered**: profile columns per transport (rejected — migration churn); generic importer-target table (deferred — only Docker needs it now).

## Decision: Dedicated API and errors

Routes live under `/api/v1/docker-targets` and address records by UUID. New controlled errors: `TARGET_NOT_FOUND` 404, `TARGET_DISABLED` 409, `TARGET_IN_USE` 409. Duplicate `targetId` uses existing `CONFLICT` 409. Run/test result channels carry their own disabled/resolution result without changing these HTTP errors.

**Rationale**: distinguishes missing, disabled, and referenced-target conflicts while keeping the API enum small.

**Alternatives considered**: generic `NOT_FOUND`/`CONFLICT` for every case (rejected — loses operator guidance and tested semantics).

## Decision: `cancelReason` on `import_runs`

`cancelReason` is nullable and constrained to `USER_REQUESTED` or `TARGET_DISABLED`. Manual cancellation stamps `USER_REQUESTED`; target disable stamps `TARGET_DISABLED`; recovery preserves the stored reason. Agent cancellation needs no protocol change because the Hub records the reason when it sends the existing cancel frame.

**Rationale**: keeps `CANCELLED` distinct from failures without overloading `errorMessage` or `currentPhase`.

**Alternatives considered**: encode reason in `errorMessage` (rejected — displays as destructive run error); infer from target history (rejected — not durable if audit/labels change).

## Decision: Hub credential composition

Profile `*Key` names resolve from the config’s linked `STORED` credentials on Hub and from `AGENT_MANAGED` references on Agent. Socket and Context profiles may run with no credential. Save-time validation checks required profile keys against `credential.keyHints`.

**Rationale**: preserves the credential boundary and catches profile/credential mismatch before run time.

**Alternatives considered**: target-owned secrets (rejected); automatic credential conversion (rejected); deferring missing keys to Docker errors (rejected — fails too late and can leak route-specific errors).

## Decision: Docker Context on Hub

Context remains a trusted local-store transport. The Hub may use a named context only when the operator explicitly provisions a Docker context store readable by the backend; no default store or socket mount is added.

**Rationale**: preserves transport parity where the Hub runtime permits it while making privileged access opt-in.

**Alternatives considered**: disallow Context on Hub (rejected — parity requirement); parse Context into DB target route at create time (rejected — bypasses local allowlist semantics and can embed secret material).

## Decision: Single feature ADR

Ratify the contract in new ADR-122, with amendments/back-pointers on all affected closed ADR surfaces.

**Rationale**: the change spans importer execution, target ownership, schema, RBAC, audit, API errors, and cancellation; one ADR records the coherent boundary while preserving amendment traceability.
