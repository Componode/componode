# Feature Specification: Credential Store

**Feature Branch**: `feature/013-credential-store`

**Created**: 2026-09-18

**Status**: Draft

**Input**: User description: "The GitHub importer does not save the PAT (API key/secret) in the database for reuse. Grill the architecture and set good practices for storing integration keys in the database with security, tracking, storage resilience, and lifecycle management. Scope: in-app integration secrets only (importer credentials, OIDC client secrets, outbound API auth) — infrastructure/deployment secrets (database passwords, container registries, monitoring) stay external."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Store an Integration Credential Securely (Priority: P1)

An administrator opens the credential management area and creates a new credential by pasting secret values — for example a GitHub PAT, or an AWS access-key pair — into a form. The credential is given a label and stored encrypted at rest. After saving, the administrator can see metadata (label, which named keys it holds, a short non-reversible hint per key such as the last four characters) but can never retrieve the plaintext values again.

**Why this priority**: This is the foundation — without a secure store, nothing else in the feature exists. It also directly resolves the reported gap: today there is no way to save a PAT inside the application at all; the UI only accepts the name of an environment variable.

**Independent Test**: Create a credential via the API/UI with a PAT; verify it appears in the credential list with a masked hint; verify no API response, list endpoint, or export ever returns the plaintext value; verify the stored data at rest is not readable as plaintext.

**Acceptance Scenarios**:

1. **Given** an administrator with credential-create permission, **When** they submit a new credential with a label and one or more named secret values, **Then** the credential is persisted encrypted at rest and appears in the credential list with masked key hints.
2. **Given** an existing credential, **When** any user or administrator queries it through any API endpoint, **Then** the response contains metadata and masked hints only — never a plaintext secret value.
3. **Given** a non-administrator without credential permissions, **When** they attempt to create, read, update, or delete credentials, **Then** the request is denied.

---

### User Story 2 - Use a Stored Credential in an Importer Configuration (Priority: P1)

An administrator configuring a GitHub import selects an existing stored credential (or creates a new one inline by pasting the PAT) instead of naming an environment variable. When the import runs — on demand or on schedule — the credential's named values are resolved and handed to the importer exactly as before. The importer itself is unaware of where the secret came from.

**Why this priority**: Storage without consumption is useless; this is the other half of the MVP. Together with Story 1 it lets an operator configure an authenticated import entirely through the UI — the core pain point.

**Independent Test**: Create a credential holding a valid PAT, attach it to a GitHub importer config, trigger a run, and verify the import authenticates and completes — with no environment variables involved.

**Acceptance Scenarios**:

1. **Given** a stored credential containing the required key(s), **When** an administrator attaches it to an importer configuration and saves, **Then** the configuration references the credential and validates successfully.
2. **Given** an importer configuration referencing a valid credential, **When** an import run starts, **Then** the credential's values are resolved and the importer receives them for the duration of the run only.
3. **Given** an importer configuration referencing a credential that lacks a required key, **When** the configuration is saved or a run starts, **Then** the failure names the credential and the missing key.
4. **Given** an importer configuration referencing two credentials that both define the same key, **When** the configuration is saved, **Then** the save is rejected and the error names both credentials and the colliding key.

---

### User Story 3 - Verify a Credential Before Relying on It (Priority: P2)

An administrator who just stored a credential (or rotated it) clicks "test" to verify the secret actually works against the target system — e.g., that the PAT authenticates to GitHub — without waiting for the next scheduled run to discover a typo.

**Why this priority**: Because credential values are write-only and can never be read back, an unverifiable secret is a trap: a typo only surfaces as a failed import at 2 a.m. A test action converts that into immediate feedback.

**Independent Test**: Store a credential with a deliberately invalid token, invoke the test action, and verify a clear authentication-failure result is returned; repeat with a valid token and verify success.

**Acceptance Scenarios**:

1. **Given** a stored credential, **When** an administrator invokes the test action for a given importer type, **Then** the system attempts authentication and reports success or a clear failure reason.
2. **Given** a credential with an expired or revoked upstream token, **When** the test action runs, **Then** the failure is reported without exposing the secret value.

---

### User Story 4 - Manage the Credential Lifecycle (Priority: P2)

An administrator rotates a credential when its upstream token is renewed, revokes one that may be compromised, sees which credentials are approaching expiry, and can answer "which imports use this credential and when was it last used?" Deleting a credential that is still referenced is blocked with an explicit list of dependents.

**Why this priority**: Security, tracking, and lifecycle management are three of the four pillars the user named. Rotation and revocation are routine operations for API keys; without them the store becomes a write-once graveyard.

**Independent Test**: Create a credential, reference it from a config, run an import, then verify: the credential shows last-used metadata; rotation replaces the value while keeping identity and references intact; deletion is refused while referenced; revocation prevents further resolution.

**Acceptance Scenarios**:

1. **Given** an existing credential, **When** an administrator submits a new value, **Then** the credential keeps its identity and all existing references, and subsequent runs use the new value.
2. **Given** a credential referenced by one or more importer configurations, **When** an administrator attempts to delete it, **Then** the delete is refused and the response lists the dependent configurations.
3. **Given** a revoked credential referenced by a configuration, **When** a run is attempted, **Then** the run fails fast with an error identifying the revoked credential.
4. **Given** an import run that used a credential, **When** an administrator inspects the credential or the run, **Then** the linkage between run and credential is visible.
5. **Given** a credential with an expiry date that has passed or is near, **When** an administrator views the credential list or a run uses it, **Then** a warning is surfaced — but the run is not blocked solely by the date.

---

### User Story 5 - Migrate Existing Configurations Without Breaking Them (Priority: P2)

An operator who deployed v1 with environment-variable secret references upgrades to the release containing this feature. Existing configurations keep working — the legacy env/file references still resolve — but are visibly flagged as deprecated, and the UI offers a one-click conversion that captures the current value into a stored credential and rewrites the reference.

**Why this priority**: v1.0.0 has shipped; real deployments use env/file references. An unannounced hard cut punishes early adopters, while silently persisting env values without consent is its own surprise. A deprecation window with assisted conversion respects both.

**Independent Test**: On an upgraded deployment with an env-based config, verify the config still imports successfully, is flagged deprecated, and that the convert action produces a working stored credential with no manual re-entry.

**Acceptance Scenarios**:

1. **Given** a pre-existing importer configuration with environment-variable secret references, **When** the upgraded system runs an import, **Then** the references still resolve and the import succeeds.
2. **Given** such a configuration, **When** an administrator views it, **Then** the legacy reference is clearly marked deprecated.
3. **Given** such a configuration, **When** the administrator invokes the convert action, **Then** the current secret value is captured into a new stored credential and the configuration is rewritten to reference it.
4. **Given** the deprecation window has ended in a later release, **When** the legacy reference types are removed, **Then** only stored credentials remain supported.

---

### User Story 6 - Operate the Encryption Key Safely (Priority: P2)

An operator deploying Componode gets a working credential store with zero extra setup — the system generates a master encryption key on first boot into the secrets directory — or supplies their own key via environment/file for controlled environments. Operators can rotate the master key without losing stored credentials, and the backup runbook makes clear that the database and the master key must be backed up together.

**Why this priority**: Storage resilience is the fourth pillar the user named. A store whose key is casually lost is a store full of unrecoverable credentials; a store that demands manual key generation adds friction to the self-hosted Compose path.

**Independent Test**: Fresh deployment with no key configured → first boot generates one and credentials work; deployment with credentials and the key removed → boot refuses rather than silently corrupting; key rotation procedure → existing credentials remain readable under the new key.

**Acceptance Scenarios**:

1. **Given** a fresh deployment with no configured key, **When** the application boots for the first time, **Then** a master key is generated and persisted so credentials can be stored immediately.
2. **Given** a deployment holding stored credentials, **When** the application boots without access to the master key, **Then** startup fails loudly rather than serving unreadable data.
3. **Given** an operator performing key rotation per the documented procedure, **When** the application restarts, **Then** all stored credentials are re-encrypted under the new key and remain usable.
4. **Given** an operator reading the deployment documentation, **When** they review backup procedures, **Then** the documentation states that the database and master key must be backed up together and that key loss renders stored credentials unrecoverable.

---

### User Story 7 - Store the OIDC Client Secret in the Same Store (Priority: P3)

An administrator configuring OIDC authentication selects a stored credential for the client secret instead of an environment-variable reference, using the same credential store as importer secrets.

**Why this priority**: OIDC client secrets are in-app integration secrets — the same class as importer credentials — and the user's decision explicitly includes them. It is lower priority because OIDC is optional and already has a working external-reference path during the deprecation window.

**Independent Test**: Configure OIDC with a credential reference; verify login flows work and the secret resolves through the credential store; verify env/file references still work during the deprecation window.

**Acceptance Scenarios**:

1. **Given** a stored credential containing the OIDC client secret, **When** an administrator configures OIDC to reference it, **Then** OIDC login flows resolve the secret through the credential store.
2. **Given** a pre-existing OIDC configuration using a legacy reference, **When** the deprecation window is active, **Then** it continues to work and is flagged deprecated.

---

### Edge Cases

- Two credentials referenced by one importer configuration define the same key name — the save is rejected naming both credentials and the key.
- A referenced credential lacks a key the importer requires — the run fails fast naming the credential label and the missing key, rather than the importer failing mid-run with an opaque upstream auth error.
- The master key is lost or rotated incorrectly — stored credentials become unrecoverable; this is documented and boot fails rather than silently misbehaving.
- A credential's upstream token expires or is revoked externally — runs fail with a clear authentication error; the `expiresAt` warning is advisory only and never blocks a run.
- A credential referenced by configurations is deleted — refused with a dependent list; the administrator must re-point or remove the configurations first.
- A database dump or backup is exfiltrated without the master key — stored secrets remain ciphertext.
- An application secret that is infrastructure-adjacent (database password, container registry, monitoring) — explicitly out of scope; these continue to come from the deployment environment and are never stored in the credential store.

## Requirements *(mandatory)*

### Functional Requirements

**Storage & secrecy**

- **FR-001**: The system MUST provide a credential store for in-app integration secrets (importer credentials, OIDC client secrets, outbound API authentication secrets). Infrastructure and deployment secrets remain outside the store and continue to be supplied by the deployment environment.
- **FR-002**: Credential values MUST be encrypted at rest such that a database dump or backup alone does not reveal them.
- **FR-003**: A credential MUST be able to hold multiple named secret values as one logical unit (e.g., an access-key pair, a client-id/client-secret pair) so that one credential equals one logical login.
- **FR-004**: Credential values MUST be write-only: the API accepts them on create and rotation but MUST never return plaintext values in any response, export, log, or error message. Responses expose only metadata and non-reversible per-key hints (e.g., last four characters).
- **FR-005**: The system MUST record and expose credential metadata: label, lifecycle status, per-key masked hints, creation/modification audit fields, optional expiry date, and last-used timestamp.
- **FR-006**: All credential mutations (create, rotate, revoke) MUST produce audit records; secret values MUST NOT appear in logs or audit payloads.

**Consumption**

- **FR-007**: Importer configurations MUST be able to reference one or more stored credentials; at run start the referenced credentials' named values are resolved and passed to the importer in memory for the run duration only. The importer-facing contract MUST NOT change.
- **FR-008**: The system MUST reject an importer configuration whose referenced credentials define the same key name more than once, naming the colliding credentials and key.
- **FR-009**: Importers MUST declare which secret keys they require (with human-readable labels and required/optional flags) so the system can validate credential coverage when a configuration is saved.
- **FR-010**: When a run cannot resolve a required secret — credential missing, revoked, or lacking a required key — the run MUST fail fast with an error naming the credential and the missing or invalid key.
- **FR-011**: OIDC client-secret configuration MUST support referencing a stored credential, resolving it the same way as importer secrets.

**Access control**

- **FR-012**: Credential management MUST be gated by dedicated permissions (create, read, update, delete) separate from importer-configuration permissions.
- **FR-013**: The system MUST provide a test action per credential that attempts authentication against the target system and reports success/failure without revealing the secret.
- **FR-014**: Deleting a credential referenced by any importer configuration or OIDC configuration MUST be refused, and the response MUST list the dependents.

**Lifecycle & tracking**

- **FR-015**: Rotating a credential MUST preserve its identity and all existing references; subsequent runs use the new value. Value version history is out of scope for this feature.
- **FR-016**: Credentials MUST support ACTIVE and REVOKED status; resolving a REVOKED credential MUST fail fast (the revoked case of FR-010's fail-fast rule).
- **FR-017**: An optional expiry date on a credential MUST produce visible warnings (credential list, run warnings) when past or within 14 days, but MUST NOT block runs by itself.
- **FR-018**: Every import run MUST record which credentials it resolved, and each credential MUST expose its last-used timestamp.

**Key management & resilience**

- **FR-019**: The encryption master key MUST be supplied from outside the database (environment variable or secrets-directory file); if absent on first boot the system MUST generate and persist one automatically.
- **FR-020**: Boot MUST fail when stored credentials exist and no master key is available; when no credentials exist yet, the system may run with credential features degraded and a visible warning.
- **FR-021**: The system MUST support master-key rotation such that existing credentials remain usable; rotation MUST NOT require secret values to pass through the API.
- **FR-022**: Deployment documentation MUST state that the database and master key form a single backup unit and that key loss makes stored credentials unrecoverable.

**Migration**

- **FR-023**: Existing environment-variable and file secret references MUST keep resolving during a deprecation window of at least one major release, and MUST be visibly flagged as deprecated in the UI and logs.
- **FR-024**: The system MUST offer a conversion action that captures a legacy reference's current value into a new stored credential and rewrites the configuration to reference it, requiring no manual re-entry of the secret.

### Key Entities *(include if feature involves data)*

- **Credential**: A stored, encrypted set of named secret values representing one logical login to an external system. Carries a label, lifecycle status (active/revoked), per-key masked hints, optional expiry date, last-used timestamp, and audit fields. Referenced by importer configurations and OIDC configuration; never exposes plaintext values after write.
- **Credential reference**: The pointer from an importer configuration (or OIDC configuration) to a credential. Replaces the legacy environment-variable/file secret reference for in-app secrets.
- **Master encryption key**: The external key that protects all stored credentials. Supplied by the deployment environment or generated on first boot; rotatable; jointly required with the database for any meaningful backup.
- **Importer secret declaration**: Each importer's published list of the named secret keys it requires, used to validate credential coverage and to label credential input fields.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An administrator can configure a fully authenticated importer — from pasting a PAT to a saved, runnable configuration — entirely through the UI in under 5 minutes, with no container environment changes or restarts.
- **SC-002**: Zero plaintext credential values are ever returned by any API response, UI view, log line, or audit record; 100% of credential-bearing endpoints return masked hints only.
- **SC-003**: A database dump obtained without the master key yields zero recoverable secrets.
- **SC-004**: Credential rotation and revocation each complete in under 2 minutes through the UI, with rotation preserving all existing configuration references.
- **SC-005**: An administrator can answer "which imports use this credential, and when was it last used?" in under 1 minute from the credential detail view.
- **SC-006**: Existing deployments upgrading with legacy env/file references experience zero broken imports during the deprecation window, and can convert each configuration via a single action.
- **SC-007**: Master-key loss or misconfiguration is detected at startup 100% of the time (loud failure) rather than surfacing as run-time errors.

## Assumptions

- The deployment remains single-organization and self-hosted; no per-tenant credential isolation is needed.
- Protecting stored secrets against exfiltrated database dumps/backups and API reads is the goal; a fully compromised host (database + key material together) is accepted as out of the threat model for this feature.
- The importer-facing contract (`run(config, secrets, context)`) is stable; importers remain unaware of credential provenance.
- Credential value version history, automatic upstream expiry detection, and external vault/cloud-KMS key providers are out of scope for this feature (the external-reference escape hatch exists only during the deprecation window).
- One deployment = one OIDC configuration and one set of credentials; sharing a credential across multiple importer configurations is expected and supported.
