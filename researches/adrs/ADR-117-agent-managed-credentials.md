### ADR-117 — Agent-managed credentials (reference-only credential flavor)

> **Status:** Ratified

**Context**: ADR-116 introduces Import Agents that execute importers in
remote, hub-unreachable networks. Importer secrets for those sources live in
the restricted network by definition — the whole point of the agent is that
it can reach what the hub cannot. Shipping decrypted credential values from
the hub to the agent over TLS would (a) move plaintext across the trust
boundary, (b) expand the blast radius of an agent-host compromise to every
credential, and (c) is unnecessary — the agent host is where the secrets must
exist anyway. At the same time, config UX (coverage validation, key-label
hints, credential-test action, `credentialIds` linkage) must keep working for
remote-bound configs.

**Decision**:

1. **Credential `kind` discriminator.** `credentials.kind`:
   `STORED` (existing AES-256-GCM encrypted payloads, unchanged) |
   `AGENT_MANAGED`. `AGENT_MANAGED` records carry no encrypted payload.

2. **`secretRefMap`.** Agent-managed credentials store a plaintext jsonb
   map of secret key name → reference, using the existing `SecretRef`
   shape: `{ "token": { "env": "PROD_GH_TOKEN" } }` or
   `{ "token": { "file": "gh-token" } }`. References name sources, not
   values — they are not secret material.

3. **Uniform linkage.** Remote-bound importer configs keep using
   `credentialIds` via `importer_config_credentials` — no new config field,
   no resurrection of deprecated `secretRefs`. `assertSecretCoverage` works
   unchanged because `secretRefMap` keys are the declared key names; `kind`
   also prevents binding a `STORED` credential to an agent-bound config and
   vice versa (save-time validation).

4. **Agent-side resolution.** `job.assign` frames carry the resolved
   `secretRefMap`s; the agent resolves each ref against *its own*
   environment: `env` vars or files under `SECRETS_DIR` (confined,
   traversal-rejected — mirroring the hub's `EnvSecretResolver`). Only two
   resolver types in v1, behind a resolver seam for future `vault`/`ssm`/…
   ref types. Per-credential refs avoid key collisions between credentials
   sharing key names on one agent.

5. **Plaintext lifecycle.** Secrets are resolved at job start, held in
   process memory for the run's duration, never persisted to disk, never
   logged. The agent applies `redactSecrets`-equivalent discipline to all
   log emission. Memory-scrubbing is not claimed (Node cannot reliably zero
   strings); agent-host hardening is the deployer's responsibility and is
   documented in the agent hardening guide. Production docs steer to file
   mounts (`docker secret`, k8s secret volumes) over env vars, which leak
   via `/proc`, `docker inspect`, `kubectl describe`, and crash dumps.
   **Encryption at rest is delegated to the deployment platform** — k8s
   `encryptionConfiguration`/KMS-encrypted secrets, Docker Swarm secrets,
   Vault agent injection/AWS SSM → files under `SECRETS_DIR`; the agent
   implements no crypto (a co-located key+ciphertext pair is obfuscation,
   not security). The agent token receives identical treatment — it is the
   highest-value secret on the host; protecting importer secrets while the
   token sits plaintext is a half-measure.

6. **Rotation.** Rotating the underlying secret happens entirely on the
   agent host (update env var / remount file) — the hub record is untouched
   and nothing re-encrypts. `expiresAt` remains settable as advisory
   display metadata; the hub cannot observe actual expiry for
   `AGENT_MANAGED` credentials. `keyHints` carry key names only (no last-4
   — the hub never sees values).

7. **Credential test.** `testSecrets` for an agent-managed credential is
   routed to the bound agent over the agent stream
   (`credential.test`/`credential.test.result`, ~30 s timeout); agent
   offline → `AGENT_OFFLINE`. The credential is bound to an agent via the
   configs that reference it; testing requires at least one bound config.

8. **Audit.** The agent logs resolution *events* (key name + source type —
   never values); the hub continues stamping `credentialIds` on runs and
   updating `lastUsedAt`.

**Amendments to earlier ADRs**:

- **ADR-107** — the credential model gains `kind` and the `secretRefMap`
  payload type; `STORED` behavior is unchanged. The "write-only values" rule
  is preserved: `AGENT_MANAGED` records store *no* values at all.
- **ADR-055** — secret resolution adds an agent-side resolution path; ref
  semantics (`env`, `file`, `SECRETS_DIR` confinement) are identical on both
  sides.
- **ADR-023** — the original "external secret stores" posture is, for remote
  execution, realized literally: values live exclusively in external stores
  adjacent to the executor. No behavioral change to `STORED` credentials.
- **ADR-090** — the no-secrets-in-logs rule extends to the agent process
  (resolution events log key names and source types only).

**Rationale**: Reference-only credentials keep the credential-store mental
model (lifecycle, linkage, coverage validation, test action) while making it
structurally impossible for hub-held ciphertext to leak into an agent's
compromise boundary — there is nothing to leak. Rotation becoming purely
agent-side is a genuine operational win for restricted-network deployments,
where the secret owner is typically the same team that owns the network.
Per-credential ref maps (rather than a flat agent env convention) keep
multi-credential agents correct.

**Alternatives considered**:

- **Hub pushes decrypted secrets per run** — simplest code reuse but moves
  plaintext across the boundary and gives a compromised agent host every
  credential; rejected.
- **Remote configs use deprecated `secretRefs` directly** — revives a
  deprecated mechanism, loses credential lifecycle/linkage, and breaks the
  single `credentialIds` mental model; rejected.
- **Opaque refs the hub cannot inspect** — would defeat `assertSecretCoverage`
  and key-collision pre-checks for marginal naming secrecy; rejected.
- **Agent-local encrypted secret store** — a co-located key+ciphertext pair
  is obfuscation (any read reaching one reaches both); a hub-brokered
  split-key model (hub delivers the store-key over the authenticated
  channel, agent discards it on disconnect) has real value against offline
  disk theft but replaces the idiomatic secret-mount workflow with custom
  operator tooling. Parked as a future `store:` ref type; encryption at
  rest is delegated to the platform in v1.
