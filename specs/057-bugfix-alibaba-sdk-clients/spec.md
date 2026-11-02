# Feature Specification: Alibaba Cloud importer SDK client fixes

**Feature Branch**: `057-bugfix-alibaba-sdk-clients`

**Created**: 2026-11-02

**Status**: Shipped

**Input**: User description: "bug-fix for two open issues in the importer-alibaba-cloud registered here: https://github.com/Componode/componode/issues — #232 (SDK default imports resolve to module namespace under bundled CJS runtime) and #231 (regionId never set on SDK Config — clients can't be pinned to a region or redirected)"

## Clarifications

### Session 2026-11-02

- Q: How should the importer's config expose SDK region pinning and STS/BSS endpoint redirection? → A: New explicit `region` config field pins all clients; `stsEndpoint` + `bssEndpoint` overrides for redirect — keeps "which regions to catalog" (filter) separate from "where to connect" (routing).

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Importer runs under the production bundle (Priority: P1)

An operator deploys Componode from the production build (or runs the Import
Agent bundle) and configures an Alibaba Cloud source. The import run must
reach Alibaba Cloud and yield assets — today the run fails at client
construction with `... is not a constructor`, because the Alibaba SDK client
classes are consumed as default imports that bind the module *namespace*
instead of the constructor under the bundled CommonJS runtime. The importer
is completely unusable in the artifact that actually ships.

**Why this priority**: A hard runtime crash in the shipped bundle means the
importer produces zero value — every Alibaba Cloud import fails before the
first API call. Nothing else about this feature matters if the importer
cannot even construct its clients.

**Independent Test**: Fully testable by building the production bundle
(`pnpm build` output) and exercising the Alibaba Cloud importer's client
construction under that artifact: all three clients (Resource Center, STS,
BSS) construct successfully and issue their first API call with no
constructor error.

**Acceptance Scenarios**:

1. **Given** the production bundled runtime, **When** the Alibaba Cloud
   importer builds its SDK clients, **Then** each SDK client class resolves
   to a callable constructor and `new ...(...)` succeeds for Resource
   Center, STS, and BSS — no `is not a constructor` failure.
2. **Given** the same fix applied at the source level, **When** the
   importer runs under the plain (non-bundled) development/test runtime,
   **Then** client construction still succeeds — the fix does not regress
   the runtime where it currently works.

---

### User Story 2 - Clients honor configured region and can be redirected (Priority: P2)

An operator configures `regionIds` on an Alibaba Cloud source to scope
discovery — but the SDK clients are built with no `regionId` on their
underlying config, so connectivity ignores the configured regions entirely:
no client can be pinned to a regional endpoint, and only Resource Center
honors the `endpoint` override. STS and BSS calls cannot be redirected at
all, which also means the test workload cannot point them at a local mock
without DNS/TLS interception.

**Why this priority**: The configured-region contract is silently broken —
`regionIds` filters search results but does not pin connectivity — and
STS/BSS have no redirect mechanism, which is what blocks the workload test
suite from exercising the importer against local mocks. It ranks below the
constructor crash because the importer must run at all before region
pinning matters.

**Independent Test**: Fully testable by configuring regions on a source and
verifying every constructed SDK client carries a region on its underlying
configuration, and by redirecting STS/BSS traffic to a local mock endpoint
through supported configuration alone.

**Acceptance Scenarios**:

1. **Given** a source configured with the explicit `region` field, **When**
   the importer builds its SDK clients, **Then** every client's underlying
   SDK configuration carries that region — Resource Center, STS, and BSS
   alike, not just the Resource Center search filter.
2. **Given** a need to exercise the importer against a local mock, **When**
   `stsEndpoint` and `bssEndpoint` are configured, **Then** STS and BSS
   calls are redirected to those endpoints without DNS or TLS
   interception.
3. **Given** no `region` configured, **When** the importer builds its SDK
   clients, **Then** each client resolves its default endpoint — STS and
   BSS use their documented global endpoints (`sts.aliyuncs.com`,
   `business.aliyuncs.com`) since their regional endpoint rule cannot
   construct without a region or endpoint, and Resource Center resolves
   its global endpoint as before.

---

### Edge Cases

- **`regionIds` stays a pure discovery filter**: the SDK-level `regionId`
  pinning comes from the dedicated `region` field, never from `regionIds` —
  an operator filtering discovery across several regions does not reroute
  connectivity.
- **No `region` configured**: no `regionId` is injected — the fix must not
  fabricate a region. STS and BSS fall back to their documented global
  endpoints (their regional endpoint rule throws at construction
  otherwise); Resource Center resolves its global endpoint unchanged.
- **`endpoint` stays scoped to Resource Center**: the existing `endpoint`
  field remains the Resource Center-only production override; STS and BSS
  get their own `stsEndpoint`/`bssEndpoint` fields rather than widening
  `endpoint`'s documented scope.
- **Per-service endpoint precedence**: when a service's endpoint override
  and `region` are both set, the explicit endpoint wins for that client —
  pinning and redirect never conflict silently.
- **Interop fix must not regress ESM**: the constructor-resolution fix
  applies to both the bundled CJS artifact and the plain TypeScript/ESM
  test runtime — one code path, no divergent behavior.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: Under the production bundled (CJS) runtime, every Alibaba SDK
  client class consumed by the importer MUST resolve to its constructor, so
  client construction never throws `is not a constructor`. The fix MUST
  live in the importer package itself (import pattern, interop handling, or
  dependency change) — not patched in from a test or workload branch.
- **FR-002**: The importer MUST accept an explicit `region` config field
  and set `regionId` on the SDK client configuration for each of the three
  clients (Resource Center, STS, BSS) whenever `region` is configured; the
  discovery filter `regionIds` MUST NOT feed SDK region pinning.
- **FR-003**: The importer MUST accept `stsEndpoint` and `bssEndpoint`
  config fields that redirect STS and BSS calls respectively, so a local
  mock can serve them without DNS/TLS interception; an explicit per-service
  endpoint takes precedence over `region` for that client.
- **FR-004**: When no region is configured, SDK client configuration MUST
  continue to use default region/endpoint resolution, and the existing
  `endpoint` field MUST keep functioning as the Resource Center override.
- **FR-005**: Any change to the importer's config surface (new fields,
  renamed fields, widened semantics of `endpoint` or `regionIds`) MUST be
  reflected in the config schema descriptions and in
  `docs/importers/alibaba-cloud.md` in the same change, per the importer
  contract.
- **FR-006**: The fix MUST preserve the importer contract: pull-only
  `AsyncGenerator<DiscoveredAsset>`, no database access, and no imports
  from `packages/backend` or other importers.
- **FR-007**: The previously-failing Alibaba importer test coverage (unit
  and workload) MUST pass against the fix — the suite was left failing on
  purpose to surface these defects.

### Key Entities

- **AlibabaCloudConfig**: existing importer config; `regionIds` stays a
  pure discovery filter. Gains an explicit `region` field (connectivity
  pinning) plus `stsEndpoint` and `bssEndpoint` redirect overrides.
- **SDK client configuration** (`$OpenApiUtil.Config`): the per-client
  connection config the importer builds; gains `regionId` and per-service
  endpoint overrides.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Under the production bundle, 100% of Alibaba Cloud importer
  runs reach the first API call — zero `is not a constructor` failures at
  client construction.
- **SC-002**: With `region` configured, 100% of SDK clients the importer
  constructs carry that region on their underlying client configuration
  (verifiable by inspection or mock capture).
- **SC-003**: STS and BSS calls can be redirected to a local mock through
  configuration alone — no DNS or TLS interception required — and the
  workload suite that reported these issues passes.
- **SC-004**: Both upstream issues (#231, #232) are closable: the fix
  addresses their stated consequences without regressing the non-bundled
  runtime, and any config-surface change is documented in the importer
  guide.

## Assumptions

- The importer stays on the same Alibaba SDK packages — a version bump
  counts as a fix only if it resolves the interop problem; a major-version
  bump ships in its own PR per the dependency policy.
- `regionIds` remains the discovery-filter field; SDK region pinning comes
  from the new explicit `region` field per the clarification, keeping
  filter and connectivity semantics independent.
- No new importer capabilities (metrics, tagging write-back, extra
  services) are in scope; this is strictly a correctness fix for client
  construction and connection routing.
