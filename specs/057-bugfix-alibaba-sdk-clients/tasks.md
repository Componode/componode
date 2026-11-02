# Tasks: Alibaba Cloud importer SDK client fixes

**Input**: Design documents from `specs/057-bugfix-alibaba-sdk-clients/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/config.md

**Tests**: Included — test-first is mandated by constitution VI. Write each
test task's tests FIRST and confirm they FAIL before the implementation task.

**Organization**: Two user stories from spec.md — US1 (P1, CJS interop
crash) and US2 (P2, region pinning + STS/BSS redirect).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1 = bundled-runtime constructor fix; US2 = region/endpoints

## Path Conventions

- Importer package: `packages/importer-alibaba-cloud/`
- Importer guide: `docs/importers/alibaba-cloud.md` (contract table is
  `GENERATED` — regenerate via `docs:importers`, never hand-edit)

## Phase 1: Setup

**Purpose**: establish the baseline the fixes land on

- [x]  Run `cd packages/importer-alibaba-cloud && pnpm test` and confirm the existing suite passes — the fix must not regress it

---

## Phase 2: Foundational

**Purpose**: none — both stories share `src/client.ts` and land in the same
package; no blocking prerequisites beyond the Phase 1 baseline.

**Checkpoint**: baseline green — story work can begin

---

## Phase 3: User Story 1 - Importer runs under the production bundle (Priority: P1) 🎯 MVP

**Goal**: every Alibaba SDK client class resolves to a callable
constructor under both plain Node ESM and bundled CJS runtimes — no
`is not a constructor` at construction.

**Independent Test**: `sdkCtor` unit tests pin both module shapes; a
`buildClients` smoke test constructs all three clients from the real `tsc`
build output.

### Tests for User Story 1

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**
> (`sdkCtor` does not exist yet — the suite must fail on the missing export)

- [x]  [US1] Write `sdkCtor` tests in `packages/importer-alibaba-cloud/test/client.test.ts`: (a) namespace-shaped module `{ default: FakeClient, __esModule: true }` resolves to `FakeClient`; (b) a bare class/function resolves to itself; (c) `buildClients` returns an object exposing all six `AlibabaClients` methods (`getCallerIdentity`, `getServiceStatus`, `getResourceCounts`, `searchResourcesPage`, `getResourceConfiguration`, `describeInstanceBillPage`)

### Implementation for User Story 1

- [x]  [US1] In `packages/importer-alibaba-cloud/src/client.ts`, replace the three default imports (`import ResourceCenter20221201`, `import Sts20150401`, `import BssOpenApi20171214`) with `import * as $X` namespace imports, add and export `sdkCtor()` (`mod.default ?? mod`, typed so the resolved value is the SDK client constructor), and resolve all three constructors through it; keep the `$X` namespaces in use for request models (`SearchResourcesRequest`, `DescribeInstanceBillRequest`, etc.). Add a short comment noting the CJS `__esModule`/`exports.default` interop reason
- [x]  [US1] Run `cd packages/importer-alibaba-cloud && pnpm test` — new tests pass, existing suite unregressed

**Checkpoint**: client construction is runtime-shape-proof — US1 done

---

## Phase 4: User Story 2 - Clients honor configured region and can be redirected (Priority: P2)

**Goal**: `region` sets `Config.regionId` on all three SDK clients;
`stsEndpoint`/`bssEndpoint` redirect STS and BSS; an explicit endpoint wins
over `region` for its client; `endpoint` stays Resource Center-only;
`regionIds` stays a pure discovery filter.

**Independent Test**: schema tests parse the new fields and reject a
private-IP `stsEndpoint`; `buildSdkConfig` tests assert `regionId`/`endpoint`
on the returned `Config` instance per the data-model wiring table.

### Tests for User Story 2

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**
> (the fields and the `buildSdkConfig` export do not exist yet)

- [x]  [P] [US2] Add schema tests to `packages/importer-alibaba-cloud/test/client.test.ts` (or a new `config.test.ts`): `alibabaCloudConfigSchema` accepts `region` (string), `stsEndpoint`, `bssEndpoint` (URLs); rejects `stsEndpoint`/`bssEndpoint` pointing at `http://169.254.169.254/` or `http://10.0.0.1/` via `urlSafetyError`; rejects a non-URL `stsEndpoint`; still `.strict()` on unknown keys
- [x]  [P] [US2] Add `buildSdkConfig` wiring tests: with `{ regionId: 'cn-hangzhou' }` the returned `Config` has `.regionId === 'cn-hangzhou'`; with `{ endpoint: 'https://mock-alibaba' }` `.endpoint` is set; with neither, both are absent; secrets map `accessKeyId`/`accessKeySecret`/`securityToken` unchanged

### Implementation for User Story 2

- [x]  [US2] Add `region`, `stsEndpoint`, `bssEndpoint` to `alibabaCloudConfigSchema` in `packages/importer-alibaba-cloud/src/config.ts` per contracts/config.md: `region` = `z.string().min(1).optional()`; the endpoint fields reuse the exact `z.string().url()` + `urlSafetyError` `superRefine` pattern of `endpoint`; write `.describe()` text that distinguishes connectivity (`region`) from the discovery filter (`regionIds`) and states each endpoint's precedence; update `endpoint`'s `.describe()` to point at `stsEndpoint`/`bssEndpoint` for STS/BSS overrides
- [x]  [US2] In `packages/importer-alibaba-cloud/src/client.ts`, export `buildSdkConfig`, change its signature to `(secrets, opts: { endpoint?: string; regionId?: string })`, omit unset keys, and wire `buildClients` per data-model.md: rc ← `{ endpoint: config.endpoint, regionId: config.region }`, sts ← `{ endpoint: config.stsEndpoint, regionId: config.region }`, bss ← `{ endpoint: config.bssEndpoint, regionId: config.region }`; update the endpoint-scoping comment
- [x]  [US2] Run `cd packages/importer-alibaba-cloud && pnpm test` — all tests pass

**Checkpoint**: US1 + US2 both functional — region pinning and redirects work

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: docs + full package gate

- [x]  Regenerate the importer contract docs from the package directory: `cd packages/backend && pnpm docs:importers`, then hand-edit the non-GENERATED prose of `docs/importers/alibaba-cloud.md` — add a Behavior-notes bullet covering `region` vs `regionIds` and the per-client endpoint precedence (endpoint > region > SDK default)
- [x]  Verify `cd packages/backend && pnpm docs:importers:check` and `pnpm docs:oracle:check` pass clean
- [x]  Run `cd packages/importer-alibaba-cloud && pnpm lint && pnpm typecheck && pnpm test && pnpm build` — all green
- [x]  Execute `specs/057-bugfix-alibaba-sdk-clients/quickstart.md` end-to-end, including the `pnpm build` + `node -e` construction smoke

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies
- **US1 (Phase 3)**: after Phase 1 — no dependency on US2
- **US2 (Phase 4)**: after Phase 1 — shares `client.ts` with US1; run
  sequentially after US1 to avoid same-file conflicts
- **Polish (Phase 5)**: after both stories

### User Story Dependencies

- **US1 (P1)**: standalone — constructor resolution only
- **US2 (P2)**: independent in value, sequential in files (both edit
  `client.ts`)

### Within Each Story

- Tests first — confirm they FAIL, then implement
- Schema/config changes before client wiring

### Parallel Opportunities

- T005 and T006 ([P]) are independent test groups — can be written together
- Everything else is sequential (same two source files)

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. T001 baseline → T002 failing tests → T003 fix → T004 green
2. **STOP and VALIDATE**: construction smoke passes — the P1 crash is closed
3. US2 then lands the region/redirect surface on top

### Incremental Delivery

US1 (interop) and US2 (region/endpoints) ship in one PR — they fix sibling
defects in the same function, and US2's wiring touches the same
`buildClients` block US1 rewrites.

---

## Phase 6: Review

**Purpose**: close code-review findings (round 1)

- [x] T014 Extract the per-client `{endpoint, regionId}` mapping out of `buildClients` into a `buildClientOpts(config)` seam in `packages/importer-alibaba-cloud/src/client.ts` and add a test in `packages/importer-alibaba-cloud/test/client.test.ts` asserting all three clients receive `config.region` as `regionId` and the right endpoint precedence (explicit endpoint > region > global fallback) per SC-002 / US2-AC1 (code-review: spec)
- [x] T015 Fix `docs/roadmap.md` 057 entry — "`.default ??` interop fallback" misdescribes the implementation; say unwrap loop instead (code-review: standards)
- [x] T016 Sync spec artifacts with the shipped design: `specs/057-bugfix-alibaba-sdk-clients/data-model.md` client-wiring table + "identical to today's behavior" invariant (STS/BSS now fall back to `sts.aliyuncs.com`/`business.aliyuncs.com` — required by the SDK's regional endpoint rule) and `specs/057-bugfix-alibaba-sdk-clients/contracts/config.md` `sdkCtor` description (unwrap loop, not one-level `??`) (code-review: spec)
- [x] T017 Include `endpoint` in the private-IP/localhost rejection loop in `packages/importer-alibaba-cloud/test/config.test.ts` for symmetry (code-review: standards)

---

## Phase 7: Review

**Purpose**: close code-review findings (round 2)

- [x] T018 Extract a `ClientOpts` interface for the repeated `{endpoint?, regionId?}` shape, rename `endpoint`→`normalized` in `buildSdkConfig`, and hoist `DEFAULT_STS_ENDPOINT`/`DEFAULT_BSS_ENDPOINT` constants in `packages/importer-alibaba-cloud/src/client.ts` (code-review: standards)
- [x] T019 Update spec US2/AC3 and the no-region edge case in `specs/057-bugfix-alibaba-sdk-clients/spec.md` to state the documented STS/BSS global-endpoint fallback (ratified in data-model.md) instead of "SDK default resolution unchanged" (code-review: spec)
- [x] T020 Flip `specs/057-bugfix-alibaba-sdk-clients/spec.md` `Status` to `Shipped` for the ship commit (code-review: standards)

---

## Phase 8: Review

**Purpose**: close code-review findings (round 3)

- [x] T021 Add `.changeset/bugfix-alibaba-sdk-clients-057.md` (patch bump for `@componode/importer-alibaba-cloud`) per the changeset norm for user-facing changes (code-review: standards)
- [x] T022 Extract `CtorOf<M>` type alias for the duplicated conditional type in `packages/importer-alibaba-cloud/src/client.ts` and merge the restated `DEFAULT_*` comment into the wiring comment (code-review: standards)
