# Research: Guided Docker importer setup

All decisions below were resolved during the 2026-11-05 grilling session and
verified against the codebase during planning. No NEEDS CLARIFICATION items
remained after `/speckit-specify`; this file records the technical decisions
the plan commits to.

## Decision: Stateless probe endpoint `POST /api/v1/docker-targets/probe`

A new admin-only operation accepts `{profile, secrets?}` or
`{profile, credentialId?}` and returns `{ok, error?}` after a minimal Docker
`/version` check. It persists nothing and writes no audit event.

**Rationale**: The existing `POST /docker-targets/:id/test` refuses
credential-requiring profiles unless a Hub-bound importer config already
references the target (`testDockerTarget` requires `configId` when the
profile has `*Key` fields) — a chicken-and-egg that forces record creation
before verification. A stateless probe lets the wizard (and API clients)
verify a route before anything exists. `credentialId` mode is required
because the wizard's credential-reuse path never possesses secret values
(the store is write-only); the backend decrypts the STORED credential
exactly as `testDockerTarget` already does.

**Alternatives considered**:

- Extend `/:id/test` with ephemeral `secrets` — rejected: couples probing to
  a persisted target row, litters audit `tested` events for drafts, and
  forces a create→test→delete dance on failure.
- Probe with inline secrets only — rejected: cannot verify a reused
  credential (values are write-only).
- Fold probing into a backend "compose" endpoint — rejected: violates the
  frontend-only orchestration decision; atomicity isn't worth the surface.

**Ratified in**: ADR-122 amendment (API surface addition on the
`/docker-targets` resource).

## Decision: Wizard orchestrates existing APIs from the frontend

The guided setup is a dedicated, create-only route that calls
`POST /docker-targets`, `POST /credentials` (STORED, when the transport
needs secrets and no reusable credential was picked), and
`POST /importer-configs` in sequence, then navigates to the new config.
Partial failure reports completed/failed steps with links; no rollback.

**Rationale**: Zero new persistence paths; every artifact created is a
first-class record manageable through existing screens. Orphaned targets
are deletable (delete is only blocked while referenced) and credentials
revocable — benign by construction.

**Alternatives considered**: backend compose endpoint for atomicity
(rejected — new API surface, openapi/contract/docs churn for marginal
gain); auto-rollback on failure (rejected — spec decision; silent deletes
of admin-visible records are worse than visible orphans).

## Decision: Canonical credential key names derived per transport

The wizard never renders credential-key-name fields. A frontend constant
maps each transport to the manifest's declared secret keys:

| Transport | Required keys | Optional keys | Profile `*Key` fields set |
|---|---|---|---|
| `socket` | — | — | none |
| `context` | — | — | none |
| `tcp` | `clientCert`, `clientKey` | `caCert` | `clientCertKey`, `clientKeyKey`, `caCertKey?` |
| `ssh` | `sshPrivateKey` | `sshPassphrase` | `privateKeyKey`, `passphraseKey?` |

Optional secrets are only included when the admin supplies a value
(e.g. `caCertKey`/`caCert` omitted entirely for public-CA endpoints).

**Rationale**: The manifest's `secrets` list is the declared canonical set;
the transport→key mapping is Docker-importer domain knowledge that belongs
in the (already Docker-specific) wizard module, next to the existing
`TRANSPORT_FIELDS` table in `docker-target-form.tsx`. Reuse eligibility is
a pure key-coverage check against `CredentialListItem.keyHints`
(`Object.keys` — works for both STORED last-4 hints and AGENT_MANAGED
source-type hints; the wizard filters to `STORED` anyway).

**Alternatives considered**: arbitrary key names like the manual target
form (rejected — reintroduces the exact naming contract this feature
removes); a manifest contract field declaring per-transport key groups
(rejected — core/backend/docs churn for one importer).

## Decision: Progressive disclosure via frontend `ADVANCED_SCOPE_KEYS`

`environmentMap`, `componentIdLabel`, and `sourceKey` render inside a
collapsed "Advanced" `Collapsible` in the generic scope editor when
`importerName === "docker"`; all other fields and all other importers are
untouched.

**Rationale**: The scope renderer is already schema-driven and generic;
a per-importer key list is the smallest change that delivers the UX. The
`isCollection` hardcode for web-url/api-url is the existing precedent for
importer-specific form behavior. A manifest `advancedScopeKeys` field was
rejected for v1 (core contract + backend serialization + docs churn) and
can be revisited when a second importer needs it.

## Decision: Wizard route `/importers/new/docker`, ADMIN-gated

A new `UxDockerSetupPage` at `importers/new/docker` (static segment — no
conflict with `importers/:id`), wrapped in `authed(..., "ADMIN")` because
every mutation it performs is admin-only (`importer:target:*`,
`credential:*`, `importer:config:*` are all ADMIN in `rbac.ts`).

Entry points: a "Guided setup" button on the `/importers` index page
(ADMIN-only rendering) and a hint/link on the generic new-importer form
when Docker is selected. The generic form remains the edit path and the
manual creation path.

**Alternatives considered**: modal wizard (rejected — multi-step state
and validation belong on a page); top-level `/docker-setup` (rejected —
loses the importer-creation context); making the wizard the only Docker
creation path (rejected — power users keep raw control via the generic
form).

## Decision: Wizard-created scope is `{targetId}` only

`validateScopeForImporter` only validates (`safeParse`, result discarded);
schema defaults (`includeImages: false`,
`componentIdLabel: "componode.component-id"`) apply when the importer
parses config at run time. The wizard therefore submits
`scope: { targetId }`, `agentId: null`, `credentialIds: [id?]`,
`schedule`, `enabled: true`, `secretRefs: []`.

## Decision: ADR-122 amendment for the probe endpoint

ADR-122 §4 enumerates the `/api/v1/docker-targets` API surface. Adding
`POST …/probe` amends that surface, so the change carries an ADR-122
amendment (same pattern as ADR-121 Amendments 1–2) plus a back-pointer in
the ADR index. No other contract surface changes: no new error codes
(`VALIDATION_FAILED`, `CREDENTIAL_NOT_FOUND`, `TARGET_RESOLUTION_FAILED`
already exist), no manifest changes, no agent protocol changes.

## Verified facts the plan relies on

- `testSecrets(secrets, config?, resolvedTarget?)` on the docker importer
  already performs the minimal `/version` probe with secret sanitization
  (`maskSecretValues`) — the probe service reuses it unchanged.
- `profileSecretKeys(profile)` already extracts `*Key` references from a
  validated profile — reused for credential-coverage checks.
- `CredentialListItem.keyHints` exposes key names (values never leave the
  store) — sufficient for the reuse picker's coverage check.
- `createCredentialSchema` accepts `{kind:"STORED", label, secrets}` with
  a 64 KB payload bound — PEM bundles fit comfortably.
- Contract coverage is enforced by
  `packages/backend/test/unit/api-docs-contract.test.ts` (route ↔
  `docs/openapi.yaml` ↔ generated `docs/api.md`); `docs:api` regenerates.
- Backend integration tests use testcontainers Postgres +
  `app.inject` + `vi.mock` of `importer-registry` — the probe tests mock
  `getImporter("docker").testSecrets`.
- Frontend tests are Vitest + Testing Library in
  `packages/frontend/src/test/unit/`; the wizard's pure logic
  (transport→keys mapping, profile building, targetId suggestion,
  credential coverage) extracts to a testable module.
