# Feature Specification: Agent-Managed Credentials

**Feature Branch**: `feature/026-agent-managed-credentials`

**Created**: 2026-10-21

**Status**: Draft

**Input**: User description: "026-agent-managed-credentials — second spec of
the remote Import Agents work. Decisions ratified in
`researches/adrs/ADR-117-agent-managed-credentials.md`,
`researches/adrs/ADR-116-remote-import-agents.md`, and
`researches/remote-import-agents_research.md` §5. This spec delivers the
`AGENT_MANAGED` credential flavor: reference-only credentials whose secret
values live exclusively on the Import Agent host (env vars / files under
`SECRETS_DIR`), the `secretRefMap` model, executor-kind binding validation,
the agent-side resolver, and remote `credential.test` dispatch over the agent
stream. Config↔agent binding and job dispatch remain spec 027."

## Clarifications

### Session 2026-10-21

- Q: Should remote `credential.test` dispatch ship in this spec even though
  config↔agent binding arrives in 027? → A: Yes — dispatch and agent-side
  handling ship in 026 as a latent path, exercised by tests that bind
  configs directly (spec-025 `AGENT_IN_USE` precedent); it is the
  agent-side resolver's exercise path and completes ADR-117's scope here.
- Q: Is an agent-managed credential's reference map editable in place, and
  does an edit re-validate bound configs' coverage? → A: Editable in place
  with no re-validation of dependents — the stored-credential precedent
  (rotation doesn't re-check bound configs); broken coverage surfaces as
  `CREDENTIAL_MISSING_KEY` at the next run/test.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Admin defines a reference-only credential (Priority: P1)

A catalog administrator opens the credential form and chooses where the
values live: stored in Componode (today's encrypted values) or **resolved on
an Import Agent**. For the agent-managed mode they enter, per required
secret key, a *reference* — an environment-variable name or a file name —
never a value. The credential behaves like every other credential in the
list (label, status, expiry metadata, dependents, audit history) but carries
a distinguishing badge and can never contain secret material.

**Why this priority**: The credential flavor is the entire feature's
foundation. Until references can be declared, linked, and managed, nothing
downstream — resolution, remote test — has anything to act on.

**Independent Test**: Create an agent-managed credential through the admin
UI naming env/file references for an importer's declared keys; verify the
record stores references (not values), that no API surface returns a secret
value for it, and that the list shows the badge.

**Acceptance Scenarios**:

1. **Given** an admin creating a credential, **When** they choose "resolved
   on an Import Agent" and enter `token → env: PROD_GH_TOKEN` and
   `clientSecret → file: gh-secret`, **Then** the credential is saved with
   those references and its key hints show the key names only — no value
   fragments.
2. **Given** an agent-managed credential, **When** an admin-facing detail
   read or mutation API returns it, **Then** the response contains the
   declared references (they are names, not secrets) and never an encrypted
   payload; list responses show key hints (source types) only — reference
   names are detail-only data per ADR-117 Amendment 1.
3. **Given** the credential creation form, **When** the agent-managed mode
   is selected but a request supplies secret values, **Then** the request is
   rejected — this kind stores references only.
4. **Given** an existing stored credential, **When** the admin edits it,
   **Then** the kind cannot be changed; converting between flavors means
   creating a new credential.

---

### User Story 2 - Linkage stays uniform, executor-kind mismatches are rejected (Priority: P1)

Importer configs keep linking credentials through the same `credentialIds`
mechanism — no new config field, no revival of deprecated inline refs.
Coverage validation (does the union of provided key names cover the
importer's required keys?) works unchanged because an agent-managed
credential's declared reference keys *are* its key names. The system rejects
at save time the two mismatches that would fail at run time: an
agent-managed credential linked to a config that runs in-process on the hub,
and a stored credential linked to a config bound to an agent.

**Why this priority**: This is the safety property of the model — wrong-kind
bindings must be impossible, and coverage must keep working, or the flavor
silently breaks existing configs.

**Independent Test**: Attempt to link an agent-managed credential to a
hub-executed config and verify rejection; verify a config save with complete
reference-key coverage passes validation exactly as a stored credential
does.

**Acceptance Scenarios**:

1. **Given** an importer config that executes on the hub, **When** an admin
   links an agent-managed credential to it, **Then** the save is rejected
   with a clear kind-mismatch error.
2. **Given** an importer config bound to an agent, **When** an admin links a
   stored credential to it, **Then** the save is rejected with a clear
   kind-mismatch error.
3. **Given** an agent-managed credential whose declared keys cover the
   importer manifest's required keys, **When** the config is saved,
   **Then** coverage validation passes; **Given** a required key missing
   from the map, **Then** save fails naming the missing key.
4. **Given** the OIDC client-secret setting, **When** an agent-managed
   credential is selected, **Then** the save is rejected — hub-side
   consumers require stored credentials.

---

### User Story 3 - Admin tests an agent-managed credential remotely (Priority: P2)

From the credential detail page the admin runs **Test**, and the request is
routed over the agent stream to the agent of a bound importer config. The
agent resolves each reference against its own environment and invokes the
importer's credential check locally; the admin sees the same pass/fail
result as for a stored credential, plus which agent executed the test. An
offline agent produces a clear "agent offline" error; a hung check fails
within a bounded time (~30 s).

**Why this priority**: The remote test is the only admin-facing proof that
references resolve correctly on the remote host — without it, a wrong env
name is discovered only when a real run fails.

**Independent Test**: With a connected agent and a config bound to it
(represented in tests via direct binding), run Test on an agent-managed
credential and observe the remote result; disconnect the agent and verify
the named offline error; verify nothing about the resolved values reaches
the hub.

**Acceptance Scenarios**:

1. **Given** an agent-managed credential referenced by a config bound to a
   connected agent, **When** the admin runs Test, **Then** the request is
   dispatched over the agent stream, the agent resolves the references
   locally, and the admin receives the importer's check result naming the
   executing agent.
2. **Given** the same credential with the bound agent offline, **When**
   Test is run, **Then** it fails with a clear agent-offline error.
3. **Given** a credential with no config referencing it, **When** Test is
   run, **Then** it fails explaining that a bound config is required to
   reach an agent.
4. **Given** a test whose agent-side check does not return, **When** the
   bounded timeout elapses, **Then** the admin sees a timeout failure, not a
   hung request.
5. **Given** a credential referenced by configs bound to different agents,
   **When** Test is run, **Then** the dispatch targets a connected bound
   agent and the result names it (references are agent-relative — any bound
   host is a valid probe).

---

### User Story 4 - Agent resolves references under its own control (Priority: P2)

On the agent host, references resolve against the agent's own environment:
environment variables, or files confined to the configured secrets
directory. Absolute paths and directory escapes are rejected. Resolved
values exist only in process memory for the duration of the operation —
never written to disk, never logged, never transmitted to the hub. The agent
logs resolution *events* (key name + source type) so operators can audit
what was used.

**Why this priority**: The resolver is the agent half of the trust model —
"values never cross the wire" only holds if resolution is genuinely confined
and disciplined.

**Independent Test**: Point a reference at a missing env var and observe a
failure naming the key and source; attempt an absolute path or `../` file
reference and observe rejection; inspect agent logs and confirm only key
names and source types appear.

**Acceptance Scenarios**:

1. **Given** a reference `token → env: MISSING_VAR`, **When** the agent
   resolves it, **Then** resolution fails naming the key and the missing
   env var — never a value.
2. **Given** a reference `file: ../outside` or an absolute path, **When**
   the agent resolves it, **Then** it is rejected as escaping the secrets
   directory.
3. **Given** a successful resolution, **When** the agent emits logs,
   **Then** they contain key names and source types only, and no resolved
   value appears in logs, on disk, or in any frame sent to the hub.
4. **Given** references for two different credentials that share a key name
   (e.g. two GitHub credentials both keyed `token`), **When** both resolve
   on one agent, **Then** each resolves from its own map with no collision.

---

### User Story 5 - Secret lifecycle runs agent-side (Priority: P3)

Rotating the underlying secret is purely an agent-host operation — update
the env var or remount the file; the hub record is untouched and nothing
re-encrypts. The credential's expiry field remains settable as advisory
display metadata, while the hub cannot observe real expiry for a flavor it
never decrypts. Standard lifecycle (rename, revoke, delete-blocked-while-
referenced) applies unchanged.

**Why this priority**: Operational semantics admins need to understand, but
independent of the create/link/test path — the correct behavior is mostly
"existing rules still apply."

**Independent Test**: Rotate a secret on the agent host only and confirm the
next resolution returns the new value with zero hub-side changes; set an
expiry date on an agent-managed credential and confirm it displays as
advisory metadata.

**Acceptance Scenarios**:

1. **Given** a secret rotated on the agent host (env updated or file
   remounted), **When** the agent next resolves the reference, **Then** the
   new value is used with no hub record change and no re-encryption.
2. **Given** an agent-managed credential with `expiresAt` set, **When** it
   appears in the UI, **Then** expiry shows as advisory metadata — the hub
   does not claim to observe actual secret validity.
3. **Given** an agent-managed credential referenced by a config, **When**
   delete is attempted, **Then** it is blocked with the standard in-use
   error; revoke remains one-way and fails subsequent resolutions.

---

### Edge Cases

- Agent-managed create/update payload carrying `secrets` values → rejected;
  this kind accepts references only.
- Reference row missing both source types (`env`/`file`) or carrying an
  unknown source type → validation error at save.
- Duplicate key names inside one credential's map → a key maps to exactly
  one reference by construction: the map is a JSON object, so duplicates
  collapse at parse time before validation (the last entry wins). The
  in-place editor rejects duplicate row keys client-side.
- Same key name across two credentials on one config → existing
  key-collision error, unchanged.
- Credential test when the only bound agent is mid-reconnect → treated as
  offline; retry once connected.
- Editing a bound credential's map to drop a key a config requires → the
  edit succeeds (no dependent re-validation); the next run or test fails
  with the missing-key error naming the key.
- Agent disconnects mid-test → the pending test fails rather than hanging;
  the timeout bound applies regardless.
- Agent-managed credential selected as OIDC client secret → rejected
  (hub-side consumers require stored kind).
- `file` reference naming a path outside the secrets dir → rejected at
  resolution time on the agent.
- Agent reports a resolution failure during test → the failure surfaces to
  the admin with the key name and source type, never the env/file contents.

## Requirements _(mandatory)_

### Functional Requirements

#### Credential model

- **FR-001**: `Credential` MUST gain a kind discriminator distinguishing
  hub-stored credentials from agent-managed credentials. Existing stored
  behavior — AES-256-GCM encrypted payloads, write-only values, key hints —
  is unchanged.
- **FR-002**: Agent-managed credentials MUST store a plaintext map of
  secret key name → reference and MUST NOT carry an encrypted payload;
  create/update payloads that include secret values MUST be rejected for
  this kind.
- **FR-003**: A reference MUST name exactly one of two v1 source types —
  environment variable name or file name — and the reference model MUST
  leave a seam for additional source types in the future.
- **FR-004**: Agent-managed credentials MUST expose key names only in their
  key hints — no last-4 value fragments (the hub never sees values).
- **FR-005**: Credential kind MUST be immutable after creation; the
  reference map itself is editable in place (the analog of stored-payload
  rotation) and MUST NOT re-validate referencing configs' coverage — a key
  removed while bound surfaces as a missing-key failure at the next run or
  test.
- **FR-006**: References are non-secret metadata: API responses MAY return
  the declared reference map (names, not values) so admins can view and edit
  it.

#### Linkage & validation

- **FR-007**: Importer configs MUST keep referencing credentials through the
  existing `credentialIds` linkage — no new config field, no use of the
  deprecated inline secret-refs mechanism.
- **FR-008**: Save-time required-key coverage validation MUST treat an
  agent-managed credential's declared key names as its provided keys —
  behavior identical to stored credentials.
- **FR-009**: Save-time validation MUST reject both executor-kind
  mismatches: an agent-managed credential on a config executing in-process,
  and a stored credential on a config bound to an agent.
- **FR-010**: The OIDC client-secret reference MUST accept only
  hub-stored credentials.

#### Agent-side resolution

- **FR-011**: The agent MUST resolve references against its own environment
  at use time: environment variables, or files confined to its configured
  secrets directory (default `/run/secrets`, the conventional container
  secrets mount) with absolute paths and traversal outside that directory
  rejected.
- **FR-012**: Resolved values MUST exist only in agent process memory for
  the duration of the operation — never persisted to disk, never logged,
  never transmitted to the hub.
- **FR-013**: The agent MUST log resolution events naming the key and source
  type only, and MUST apply redaction discipline equivalent to the hub's to
  all log emission.
- **FR-014**: The agent MUST NOT implement its own secret-store encryption;
  protection of secrets at rest is delegated to the deployment platform.

#### Remote credential test

- **FR-015**: The test action on an agent-managed credential MUST be routed
  over the agent stream to the agent of a config that references it;
  testing MUST fail with a clear error when no bound config exists, and
  with a named agent-offline error when the target agent is not connected.
- **FR-016**: The remote test MUST have a bounded timeout (~30 s) and MUST
  fail cleanly — never hang — if the agent disconnects mid-test.
- **FR-017**: The agent MUST resolve the credential's references locally and
  invoke the importer's credential check on the agent host; the result
  returned to the hub MUST carry pass/fail and an error string only.
- **FR-018**: A remote test dispatch MUST be audited (dispatch attributed on
  the agent entity; test outcome on the credential entity) and MUST update
  the credential's usage metadata.
- **FR-019**: When configs on multiple agents reference the credential, the
  dispatch MUST select a connected bound agent and identify the executing
  agent in the result.

#### Protocol, UX & docs

- **FR-020**: The credential test request/result message shapes MUST be
  added to the shared agent protocol contract and documented in
  `docs/agent-protocol.md`.
- **FR-021**: The credential form MUST offer a "where do the values live"
  choice — stored in Componode (key→value rows) or resolved on an Import
  Agent (per-key rows: key + source type + reference name) — and
  agent-managed credentials MUST carry a distinguishing badge in the
  credentials list.
- **FR-022**: `docs/openapi.yaml` MUST be updated for every changed or new
  endpoint/schema surface per ADR-104.
- **FR-023**: `docs/agents.md` MUST document the secrets directory as active
  (no longer reserved), steer production to file mounts over env vars, apply
  uniform protection guidance to the agent token, and state that encryption
  at rest is delegated to the deployment platform; `CONTEXT.md` and
  `docs/ux.md` are updated in the same change.
- **FR-024**: Importer config and credential save-time validation surfaces
  MUST name the offending credential and the executor mismatch in their
  error messages.

### Key Entities

- **Credential** (extended): gains a kind — `STORED` (encrypted payload,
  unchanged) or `AGENT_MANAGED` (reference map, no payload). Lifecycle,
  slug, status, expiry, and dependents semantics are shared.
- **Secret reference map**: per-credential plaintext map of declared key
  name → `{env: name}` or `{file: name}`; names sources, not values.
- **Import Agent** (existing, spec 025): the resolution and test-execution
  host; reached via the bound-config relationship.
- **Importer config credential link** (existing): the unchanged
  `credentialIds` junction through which kind enforcement and test routing
  operate.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: An admin can create a complete agent-managed credential in
  under 2 minutes without supplying any secret value to the hub.
- **SC-002**: Zero secret values transit the hub↔agent channel or appear in
  hub storage, API responses, logs, or audit entries — only reference names
  move (100% of messages inspected).
- **SC-003**: A remote credential test returns a result or a named failure
  within the bounded timeout in 100% of cases — including agent offline and
  mid-test disconnect.
- **SC-004**: 100% of invalid references (unset env var, absolute path,
  directory escape, unknown source type) fail closed with the key and source
  named and no value material exposed.
- **SC-005**: Rotating an underlying secret requires zero hub-side changes —
  an agent-host-only update takes effect on the next resolution.
- **SC-006**: 100% of executor-kind mismatched bindings (either direction)
  are rejected at save time with an actionable message.

## Assumptions

- Config↔agent binding (`importer_configs.agentId` settable, the Execution
  selector) and job dispatch (`job.assign` carrying reference maps, remote
  run execution) are spec **027** per the ratified split (ADR-116 Amendment
  1; spec 025 Assumptions). Consequently agent-managed credentials cannot
  yet be linked to configs through the product surface in this spec — the
  kind-mismatch validation and remote test path ship now and are exercised
  by tests that bind configs directly (the same technique spec 025 used for
  `AGENT_IN_USE`).
- The `credential.test` / `credential.test.result` frames and dispatch ship
  in this spec (confirmed in Clarifications) — latent in the product until
  027 binding exists, exercised end-to-end by tests. The execution codes
  (`AGENT_LOST`, `AGENT_UNAVAILABLE`, `AGENT_INCOMPATIBLE`,
  `ASSET_TOO_LARGE`) land with 027 while `AGENT_OFFLINE` lands here.
- Credential kind is immutable post-creation; converting flavors means
  creating a new credential and re-pointing dependents.
- A multi-agent-bound credential's test dispatch targets any connected
  bound agent — references are agent-relative, so any bound host is a valid
  probe.
- The agent host is a trusted boundary: it holds plaintext importer secrets
  and the agent token by design. Host hardening is the deployer's
  responsibility, documented in the agent guide; no memory-scrubbing
  guarantee is claimed (the runtime cannot reliably zero strings).
- Stored credentials are behaviorally untouched: encrypted payloads,
  write-only values, last-4 key hints, and the in-process resolution path
  all continue to work exactly as spec 013 delivered them.
- New error codes introduced here are ratified in the same change (ADR-117
  amendment or errata line), keeping the controlled `ERROR_CODES` enum
  documented rather than letting surfaces live only in spec artifacts.
