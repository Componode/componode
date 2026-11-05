# Data Model: Guided Docker importer setup

**No database changes.** This feature adds one stateless API operation and
frontend flows over existing entities. No migrations, no new tables, no new
enum values, no new error codes.

## Existing entities (unchanged)

### DockerTarget (`docker_targets` table)

- `id` uuidv7, `targetId` immutable unique selector (1–200 chars),
  `label`, `description`, `profile` jsonb (validated non-secret transport
  profile), `enabled`, audit metadata.
- The wizard creates rows through `POST /docker-targets` with
  `profile.transport ∈ {socket, tcp, ssh, context}` and `*Key` fields set
  to canonical secret names (see below). Lifecycle semantics unchanged.

### Credential (`credentials` table)

- `kind: "STORED"`, `label`, encrypted `secrets` payload (AES-256-GCM),
  `keyHints` (non-reversible display hints exposing key names).
- The wizard creates at most one credential per run, containing exactly
  the canonical keys for the chosen transport. Reuse path links an
  existing credential whose `keyHints` cover the required set.

### ImporterConfig (`importer_configs` table)

- `importerName: "docker"`, `label`, `scope: { targetId }`,
  `credentialIds: [] | [id]`, `agentId: null`, `schedule`, `enabled`.
- Save-time validation (`assertHubDockerConfig`) still enforces that the
  target exists, is enabled, and that linked STORED credentials cover the
  profile's `*Key` names — the wizard satisfies this by construction.

## New ephemeral contract (not persisted)

### DockerTargetProbeRequest / DockerTargetProbeResult

Request body for `POST /api/v1/docker-targets/probe`:

```text
{
  profile: object            // raw transport profile, validated against
                             // the docker manifest's targetProfileSchema
  secrets?: Record<string,string>   // inline secret values (≤64 KB)
  credentialId?: uuid              // XOR with secrets — STORED credential
                                   // decrypted server-side for the probe
}
```

- `secrets` and `credentialId` are mutually exclusive (refine rejects
  both-present); both may be absent for secret-free profiles.
- `credentialId` must reference an existing STORED credential →
  `404 CREDENTIAL_NOT_FOUND` otherwise.
- Result: `{ ok: boolean, error?: string }` — `error` is sanitized of all
  secret material (existing `maskSecretValues` path in `testSecrets`).
- No row is written; no audit event is emitted; the operation is safe to
  retry and safe to call with drafts that are never saved.

## Canonical secret-key mapping (frontend constant, not a contract)

| Transport | Credential keys created/required | Profile `*Key` fields emitted |
|---|---|---|
| `socket` | — | — |
| `context` | — | — |
| `tcp` | `clientCert`, `clientKey` (required); `caCert` (optional) | `clientCertKey`, `clientKeyKey`, `caCertKey?` |
| `ssh` | `sshPrivateKey` (required); `sshPassphrase` (optional) | `privateKeyKey`, `passphraseKey?` |

Optional keys are omitted from both the credential payload and the
profile when the admin supplies no value.
