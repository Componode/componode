# Tasks: Docker Workload Inventory

**Input**: Design documents from `/specs/046-docker-workload-inventory/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Included — constitution VI makes test-first non-negotiable;
`validateDiscoveredAsset` must be exercised on every emitted asset shape.

**Organization**: US1 = agent-bound Docker import (run path); US2 =
workload identity stability; US3 = four secure transports + credential
probe; US4 = ImporterSource attribution/lifecycle; US5 = data
minimization + opt-in images; US6 = operator guide.

## Format: `[ID] [P?] [Story] Description`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: green baseline + importer package scaffold

- [x] T001 Verify green baseline: `pnpm install`, then `pnpm --filter @componode/core test`, `pnpm --filter @componode/backend test`, and `pnpm --filter @componode/agent test` on the feature branch
- [x] T002 Scaffold `packages/importer-docker/` mirroring `packages/importer-kubernetes/`: `package.json` (`@componode/importer-docker`, same `exports` map for `.`/`./manifest`/`./importer`, scripts `build`/`typecheck`/`test`), `tsconfig.json` extending `../../tsconfig.base.json` (`rootDir: ./src`, `types: ["node"]`, excludes `test`), `src/index.ts` stub, `test/` dir; deps `@componode/core: workspace:*`, `zod`; dev deps `typescript`, `vitest`
- [x] T003 [P] Add `dockerode@^5.0.1` to `packages/importer-docker` via `pnpm --filter @componode/importer-docker add dockerode@^5.0.1` and `@types/dockerode@^4.0.2` via `pnpm ... add -D`; run `pnpm install` so `pnpm-lock.yaml` updates with the manifest change

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: contract additions + enforcement + registration every story
builds on

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T004 Extend core contracts in `packages/core/src/contracts/importer.ts`: add `requiresAgent?: boolean` to `ImporterManifest` in `packages/core/src/importer-registry.ts` (doc comment: configs MUST bind an Import Agent; absent = hub-or-agent) and add optional third parameter `resolvedTarget?: unknown` to `Importer.testSecrets` (doc comment: preflight-resolved `TargetProfile` when manifest declares `targetRefKey`; `undefined` in-process); export nothing new — type-only change
- [x] T005 Backend `requiresAgent` enforcement in `packages/backend/src/services/importer-config-service.ts`: on create and update, resolve the importer's manifest and reject `agentId`-less configs for `requiresAgent === true` importers with `400 VALIDATION` ("requires an Import Agent"); failing test first in the importer-config test suite (`packages/backend/test/`) asserting a `requiresAgent` manifest + `agentId: null` → 400, and with `agentId` set → accepted. Note: no manifest has the flag until T007 — use a manifest stub/mock in the test
- [x] T006 Agent credential-test target resolution in `packages/agent/src/client.ts` `handleCredentialTest`: after resolving `secretRefMap`, load the importer's manifest via `deps.registry.getManifest(payload.importerName)`; when `manifest.targetRefKey` is set, read `payload.scope[targetRefKey]`, run `loadTargetProfile(deps.secretsDir, payload.importerName, targetId)` (reuse `packages/agent/src/target-registry.ts`), and pass the resolved profile as the third arg to `importer.testSecrets`; a `TargetRegistryError` → `reply(false, <non-secret message>)`. Failing test first in `packages/agent/test/` (credential.test with targetRefKey + provisioned registry passes profile; unknown targetId → `{ok:false}` before importer invocation)
- [x] T007 Importer contract surface in `packages/importer-docker/src/`: `config.ts` — `dockerConfigSchema` strict Zod `{ targetId: z.string().min(1).max(200), environmentLabel?: string, environmentMap?: z.record(z.string(), z.enum(ENVIRONMENTS)), includeImages?: z.boolean().default(false), componentIdLabel?: z.string().default("componode.component-id"), sourceKey?: z.string().trim().min(1) }`; `manifest.ts` — `{ name: "docker", label: "Docker", implPath: "@componode/importer-docker/importer", version: "1.0.0", reportsSourceIdentity: true, targetRefKey: "targetId", requiresAgent: true, configSchema: dockerConfigSchema, secrets: [caCert, clientCert, clientKey, sshPrivateKey, sshPassphrase] all required: false }`; `index.ts` re-exports
- [x] T008 Lockstep registration (ADR-065 A1, ADR-116 #7): add `"@componode/importer-docker"` to `IMPORTER_PACKAGES` in `packages/core/src/importer-registry.ts`; add `"@componode/importer-docker": "workspace:*"` to `packages/backend/package.json` and `packages/agent/package.json` dependencies; `pnpm install`; verify `registry.getManifest("docker")` resolves in a backend test context

**Checkpoint**: contracts extended, enforcement wired, importer
registered — story implementation can begin

---

## Phase 3: User Story 1 - Import Docker workloads through an assigned Import Agent (Priority: P1) 🎯 MVP

**Goal**: an agent-bound docker config with a valid `targetId` imports
containers as `CONTAINER` Components + Instances with allowlisted data.

**Independent Test**: mocked dockerode run → assets validate via
`validateDiscoveredAsset`, phases reported, abort honored; unknown
`targetId` fails before network.

### Tests for User Story 1 ⚠️

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [x] T009 [P] [US1] `packages/importer-docker/test/target-profile.test.ts`: typed `dockerTargetProfileSchema` accepts one valid profile per transport (`socket`/`tcp`/`ssh`/`context`) and rejects unknown transports, missing required fields (`clientCertKey`/`clientKeyKey` on tcp, `hostKeySha256`/`privateKeyKey` on ssh), unknown keys, and `default`/`skipTLSVerify`-style context configs
- [x] T010 [P] [US1] `packages/importer-docker/test/importer.test.ts` with mocked `dockerode`: `GET /version` + `/info` + `containers/json?all=1` + inspect → one `DiscoveredAsset` per workload (compose labels group `commerce/web`+`api`; standalone container standalone); every asset passes `validateDiscoveredAsset`; `reportSourceIdentity` called with `docker-engine:{info.ID}` before first yield; `resolveTarget(config.targetId)` consulted and typed-validated before any docker call
- [x] T011 [P] [US1] `packages/importer-docker/test/importer.test.ts` failure paths: a rejected inspect/list promise aborts the run (no partial yields); `context.signal.aborted` stops iteration; `reportPhase` called for connect/identity/enumerate/inspect stages

### Implementation for User Story 1

- [x] T012 [US1] `packages/importer-docker/src/target-profile.ts`: `dockerTargetProfileSchema` discriminated union on `transport` per `contracts/docker-target-profiles.md` (strict objects; `socket{path}` absolute-unix-or-`//./pipe/`, `tcp{host,port,caCertKey?,clientCertKey,clientKeyKey}`, `ssh{host,port?≤65535,user,hostKeySha256,privateKeyKey,passphraseKey?}`, `context{name}`); `validateTargetProfile(raw)` → typed profile or throws non-secret `Error`
- [x] T013 [US1] `packages/importer-docker/src/transport.ts`: `buildDockerOptions(profile, secrets)` → dockerode options for `socket` (`socketPath`) and `tcp` (`protocol:"https"`, `host`, `port`, `ca`/`cert`/`key` resolved from `secrets[*Key]` — missing named keys throw non-secret error); `ssh`/`context` stubs wired in Phase 5 acceptable only if tests don't need them — prefer building all four now
- [x] T014 [US1] `packages/importer-docker/src/identity.ts`: `workloadExternalId(containerLabels, name, sourceIdentity, componentIdLabel)` per `contracts/identity-and-mapping.md` — `componode.component-id` (or `componentIdLabel`) → `workload:{v}`; else compose labels → `compose:{project}:{service}`; else `{sourceIdentity}::{name-without-leading-slash}`; `instanceExternalId(sourceIdentity, containerId)` → `{sourceIdentity}::{containerId}`; `imageExternalId(repo, digestOrTag)`
- [x] T015 [US1] `packages/importer-docker/src/mapping.ts`: container+inspect → `DiscoveredAsset` fields per `data-model.md` allowlist (`details` canonical: workloadKind/composeProject/composeService/imageRef; `sourceDetails`: per-source labels/name/restart policy; instance `details`/`rawConfig` allowlist: imageRef/digest, ports, network names, mounts `{type,destination,ref}` with bind source → opaque `bind:{containerId}:{destination}` ref; status map `running`→`RUNNING`, `created`/`paused`/`exited`→`STOPPED`, `dead`/`restarting`/`removing`/unknown→`ERROR`; env label → `environmentMap` → `OTHER`)
- [x] T016 [US1] `packages/importer-docker/src/importer.ts`: `DockerImporter` — parse scope, `resolveTarget(scope.targetId)` + typed-validate, `GET /version` (negotiate within daemon `MinAPIVersion`/`ApiVersion`), `GET /info` → `reportSourceIdentity` (`docker-engine:{ID}` else `docker-engine:{sourceKey}` else throw), `containers/json?all=1`, bounded-concurrency inspect (8), group→yield per workload; any failed call throws (no partial inventory)
- [x] T017 [US1] Backend integration in `packages/backend/test/integration/`: docker manifest visible in `/importers`; create agent-bound docker config → 2xx; create without `agentId` → 400 (end-to-end T005 check); dispatch to connected test agent with provisioned registry → job.assign accepted

**Checkpoint**: socket/tcp inventory works end-to-end through the agent
path; assets valid; unknown targetId fails preflight

---

## Phase 4: User Story 2 - Logical workload identity survives rebuilds, renames, and environments (Priority: P1)

**Goal**: canonical workload identity — shared across environments,
stable across rebuilds and label-pinned renames.

**Independent Test**: two source identities reporting the same compose
workload → one Component externalId, two Instance externalIds; rebuild →
new instance extId; `componode.component-id` rename → same component
extId; unlabeled rename → different extId.

### Tests for User Story 2 ⚠️

- [x] T018 [P] [US2] `packages/importer-docker/test/identity.test.ts`: override label wins over compose labels; compose fallback; standalone daemon-qualified fallback strips leading `/`; `componentIdLabel` config changes which label is honored; instance/image extId formats match `contracts/identity-and-mapping.md`
- [x] T019 [P] [US2] `packages/importer-docker/test/importer.test.ts` scenarios: two `sourceIdentity` values reporting identical compose workloads emit identical component externalIds but distinct instance externalIds; a container rebuilt with a new ID emits a new instance extId under the same component extId
- [x] T020 [US2] Backend integration (`packages/backend/test/integration/`): fake docker importer emits the US2 scenarios through `processAsset` — two Sources share one Component with per-source instance memberships; a second run on source A marking the old container absent retires only A's instance (`GONE`), B's untouched, Component stays `ACTIVE` (reuses spec-044 source-scoped reconciliation — this test proves docker assets exercise it)

### Implementation for User Story 2

- [x] T021 [US2] Refine `identity.ts`/`mapping.ts`/`config.ts` for edge cases surfaced by T018–T020: `componentIdLabel` scope key honored end-to-end (default `componode.component-id`); leading-`/`-stripped container names; compose `project`+`service` both required else standalone fallback; canonical details carry the resolved `workloadKind`

**Checkpoint**: identity matrix proven — shared components, per-source
instances, rebuild/rename behavior per spec scenarios 2–4

---

## Phase 5: User Story 3 - Four secure transports with Agent-side target profiles (Priority: P1)

**Goal**: socket/npipe, mTLS TCP, pinned SSH, named Context — all
fail-closed; `testSecrets` probes minimally through the resolved profile.

**Independent Test**: each transport builds correct dockerode options;
every insecure variant rejected before connect; credential test performs
`ping`/`version` only.

### Tests for User Story 3 ⚠️

- [x] T022 [P] [US3] `packages/importer-docker/test/transport.test.ts`: `tcp` → `{protocol:"https",host,port,ca?,cert,key}` (missing named secrets → non-secret throw); `ssh` → `{protocol:"ssh",host,port,username,sshOptions:{privateKey,passphrase?,hostVerifier,hostHash:"sha256"}}` with `hostVerifier` accepting hex and `SHA256:base64` pin forms; `socket` → `{socketPath}`
- [x] T023 [P] [US3] `packages/importer-docker/test/context-store.test.ts`: fixture context store (`meta.json` + `Storage.TLSPath`) resolves `unix`/`npipe`/`tcp`(+TLS files) endpoints to dockerode options; rejects `default`, `SkipTLSVerify: true`, `ssh://` endpoints, missing meta/tls files — non-secret errors
- [x] T024 [P] [US3] `packages/importer-docker/test/importer.test.ts` `testSecrets`: per-transport probe calls only `ping`/`version` (never `containers/json`); returns `{ok:true}` on success; auth/connection failures → `{ok:false}` with sanitized error (secret values scrubbed even if dockerode echoes them); `resolvedTarget` param used — no registry reads inside the importer

### Implementation for User Story 3

- [x] T025 [US3] `packages/importer-docker/src/transport.ts`: implement `tcp` (mTLS, always verify, `checkServerIdentity` default intact) and `ssh` (docker-modem built-in `docker system dial-stdio` agent via `protocol:"ssh"` + `sshOptions` incl. normalized `hostVerifier`; no password auth accepted) branches of `buildDockerOptions`
- [x] T026 [US3] `packages/importer-docker/src/context-store.ts`: resolve named context from `$DOCKER_CONFIG/contexts/meta/` or `~/.docker/contexts/meta/` (hash-of-name dir per docker/cli store layout); read `meta.json` `Endpoints.docker.Host` + `Storage.TLSPath`; map `unix`/`npipe`/`tcp` to dockerode options (TLS files read from TLSPath for tcp); reject per contract
- [x] T027 [US3] `packages/importer-docker/src/importer.ts` `testSecrets(secrets, config?, resolvedTarget?)`: parse scope `.partial()`, typed-validate `resolvedTarget` (throw `{ok:false,error:"target profile invalid"}` family — never echo profile), build client, call `ping`/`version` only, return sanitized result (reuse alibaba-cloud's secret-scrubbing pattern)

**Checkpoint**: all four transports demonstrably connect or fail closed;
credential tests probe minimally through resolved profiles

---

## Phase 6: User Story 4 - Source attribution and lifecycle follow the ImporterSource contract (Priority: P2)

**Goal**: engine identity reported before yield; Source lifecycle rules
verified end-to-end for docker.

**Independent Test**: empty inventory still reports; config delete →
`UNMONITORED`; same engine via rotated profile → same Source; failed
enumeration → no retirement.

### Tests for User Story 4 ⚠️

- [x] T028 [P] [US4] `packages/importer-docker/test/importer.test.ts`: `reportSourceIdentity` invoked before first yield including a zero-container daemon; `/info.ID` absent + `sourceKey` present → `docker-engine:{sourceKey}`; both absent → run throws before yield
- [x] T029 [P] [US4] Backend integration (`packages/backend/test/integration/`): docker run → `import_runs.sourceId` + Source bound; delete config → Source `UNMONITORED`, memberships + run history intact; second config on same `externalIdentity` reattaches same Source; importer throws mid-enumeration → run `FAILED`, zero memberships deactivated (source-scoped no-retirement on incomplete run)

### Implementation for User Story 4

- [x] T030 [US4] `packages/importer-docker/src/importer.ts`: ensure `/info` + `reportSourceIdentity` is strictly first-network-call-then-report (no yields before); treat any `/info` failure without `sourceKey` as contract violation; propagate list/inspect failures as run errors (already T016 — verify ordering vs identity report)

**Checkpoint**: provenance semantics verified — Sources durable,
reattaching, never silently empty

---

## Phase 7: User Story 5 - Data minimization boundary (Priority: P2)

**Goal**: allowlisted persistence only; opt-in image inventory as
`PACKAGE_REGISTRY` Components.

**Independent Test**: imported workload's stored data + logs contain no
env vars/raw paths/health output; `includeImages` toggles image assets.

### Tests for User Story 5 ⚠️

- [x] T031 [P] [US5] `packages/importer-docker/test/mapping.test.ts`: inspect fixture with `Env`/`HostConfig`/bind `Source`/`State.Health` → none of those strings appear in emitted asset JSON; bind mounts show `{type:"bind",destination,ref}` only; health fields absent; labels bounded to `com.docker.compose.*`/`componode.*`/env label
- [x] T032 [P] [US5] `packages/importer-docker/test/importer.test.ts` images: `includeImages` unset/false → `GET /images/json` never called; true → one `PACKAGE_REGISTRY`/`DOCKER` asset per repo@digest with `instances: []`, passing `validateDiscoveredAsset`

### Implementation for User Story 5

- [x] T033 [US5] `packages/importer-docker/src/mapping.ts` + `importer.ts`: enforce the allowlist (explicit field pickers — never spread inspect JSON); implement `includeImages` branch (`GET /images/json` → `docker-image:{repo}@{digest}` / `:{tag}` externalIds per `contracts/identity-and-mapping.md`)

**Checkpoint**: minimization proven by assertion; image opt-in works

---

## Phase 8: User Story 6 - Operator setup guide (Priority: P3)

**Goal**: `docs/importers/docker.md` matches implemented behavior.

**Independent Test**: guide walkthrough per transport; index + sidebar
links present; docs build passes.

### Implementation for User Story 6

- [x] T034 [US6] Write `docs/importers/docker.md` per `docs/importer-development.md` requirements — what it imports; agent provisioning (`docker-targets.json` schema + examples per transport); required/optional credentials (AGENT_MANAGED refs, `*Key` profile indirection, context-store TLS); every scope field (`targetId`, `environmentLabel`, `environmentMap`, `includeImages`, `componentIdLabel`, `sourceKey`); common failures (`TARGET_RESOLUTION_FAILED`, `SECRET_RESOLUTION_FAILED`, `AGENT_UNAVAILABLE`, contract violations); link it from `docs/importers/index.md` and the docs-site sidebar config

---

## Phase 9: Polish & Cross-Cutting Concerns

- [x] T035 Ratify contract surface in `researches/adrs/ADR-121-docker-importer.md` (profile schema, `requiresAgent`, `testSecrets` param, scope keys, identity/status formats, minimization allowlist); add `---` + `**Amended by ADR-121**:` back-pointers to ADR-056/065/116/117 where they present the touched surface as closed; update `researches/architecture-decisions.md` index + each ADR's amends list
- [x] T036 Update `researches/docker-importer-implementation-tracking.md` Phase 3 checkboxes and `docs/roadmap.md` (Shipped entry + revised Next — Wave D next)
- [x] T037 Verify `docs/openapi.yaml` needs no change (no endpoints added — confirm contract-test suite agrees); run full verification per AGENTS.md: changed-package `lint && typecheck && test && build` + root `pnpm build`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies
- **Foundational (Phase 2)**: depends on T002/T003 (package must exist
  for registration); T004–T006 parallelizable across packages; T008 last
- **US1 (Phase 3)**: depends on Phase 2 — importer runs against
  `resolveTarget` + registry machinery
- **US2 (Phase 4)**: depends on US1 identity/mapping landing (T014–T016)
- **US3 (Phase 5)**: depends on T012/T013 scaffolding; orthogonal to US2
- **US4 (Phase 6)**: depends on T016 run orchestration
- **US5 (Phase 7)**: depends on T015/T016 mapping + run
- **US6 (Phase 8)**: depends on all behavior tasks (documents reality)
- **Polish (Phase 9)**: depends on all stories

### Parallel Opportunities

- T003 with T002 (package scaffold + dep add land together)
- T004 / T005 / T006 across core/backend/agent
- All `test` tasks within a story ([P]) — different files
- T018/T019 (importer unit) parallel with T020 (backend integration)

### Implementation Strategy

MVP = Phase 1 + 2 + Phase 3 (US1) — a working socket/TCP import path.
US2 proves catalog correctness; US3 completes the transport matrix;
US4/US5 harden provenance and minimization; US6 + polish close the wave.

---

## Phase 10: Convergence

- [x] T038 [US3] Dedicated transport builder + context-store unit tests in `packages/importer-docker/test/transport.test.ts` and `context-store.test.ts`: ssh → `sshOptions` carries `privateKey`/`hostVerifier`/`hostHash:"sha256"` with hex+`SHA256:base64` pin normalization; tcp missing named secrets → non-secret throw; fixture context store resolves `unix`/`tcp`(+TLS), rejects `default`/`SkipTLSVerify`/`ssh://`
- [x] T039 [US2][US4] Backend integration in `packages/backend/test/integration/docker-import.test.ts`: fake docker assets through `processAsset` — two Sources share one workload Component with per-source instance memberships; second run retires only the reporting source's absent instance; config delete → Source `UNMONITORED` w/ history; importer throwing mid-enumeration → `FAILED` run, zero memberships deactivated

## Phase 11: Review

- [x] T040 [code-review: standards+spec] requiresAgent dispatch-time gate in `startRun` — refuse in-process dispatch for requiresAgent importers (fail the run, not silent resolveTarget failure) (HIGH)
- [x] T041 [code-review: spec] canonicalize `docker-engine:{sourceKey}` via `canonicalizeSourceIdentity` so standalone/instance externalId prefixes match the stored Source identity (HIGH)
- [x] T042 [code-review: standards] `pinBytes` — reject 32-hex pins; SHA-256 (64-hex or `SHA256:<base64>`) only per ADR-121 (MEDIUM)
- [x] T043 [code-review: standards+spec] image dedup key = emitted externalId (`docker-image:{ref}`) — remove `imageExternalId("", ref)` divergence (MEDIUM)
- [x] T044 [code-review: spec] rawConfig minimization — drop unratified `restartPolicy`; surface `startedAt` via the `deployedAt` contract field instead of ad-hoc rawConfig (MEDIUM)
- [x] T045 [code-review: standards] agent client.ts — pass `resolvedTarget` unconditionally; update the credential-test stub expectation (MEDIUM)
- [x] T046 [code-review: standards] remove unused `createHash` import in transport.ts (LOW)
- [x] T047 [code-review: spec] docs/importers/docker.md — correct context-store path (`~/.docker/contexts/`; `DOCKER_CONFIG` not consulted in Wave C) (LOW)
- [x] T048 [code-review: spec] FR-011 clarify — container `Config.Labels` already include Compose service labels (merged at create); comment in mapping.ts (LOW)
- [x] T049 [code-review: standards] abort-signal unit test — aborted signal short-circuits run() before/after listing (LOW)

## Phase 12: Review (round 2)

- [x] T050 [code-review: standards] fix mojibake `ADR-121 �` in architecture-decisions.md rows 117/126 (HIGH)
- [x] T051 [code-review: spec] add `docker` to frontend `IMPORTER_NAMES` + `IMPORTER_PROVIDERS` — allowedImporters pickers must offer it for policy-restricted agents (HIGH)
- [x] T052 [code-review: spec] image externalId uses the raw ref (`docker-image:{repo@sha256:…}` / `docker-image:{repo:tag}`) — remove sha256-strip munging + dead `imageExternalId` export (HIGH)
- [x] T053 [code-review: standards] remove dead `HostConfig.RestartPolicy` field; `deployedAt` maps Docker zero-time (`0001-01-01`) to null (MEDIUM)
- [x] T054 [code-review: spec] `testSecrets` probes via `docker.version()` to match the guide's ping/version claim (LOW)
- [x] T055 [code-review: spec] credential-service in-process testSecrets path refuses requiresAgent importers explicitly (MEDIUM)
- [x] T056 [code-review: standards] importer-development.md source-identity table — add docker row (LOW)
