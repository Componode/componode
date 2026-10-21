# Feature Specification: Alibaba Cloud Importer

**Feature Branch**: `feature/024-alibaba-cloud-importer`

**Created**: 2026-10-21

**Status**: Draft

**Input**: User description: "A new importer for Alibaba Cloud is required. We need to research the ways the importer can work and build a detailed plan to develop and test the importer." — decisions ratified in `researches/adrs/ADR-115-alibaba-cloud-importer.md` and `researches/alibaba-cloud-importer_research.md`.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Import an Alibaba Cloud account into the catalog (Priority: P1)

A catalog administrator stores an Alibaba Cloud AccessKey credential, creates
an importer configuration selecting "Alibaba Cloud", and runs it. The run
discovers the account itself plus every supported resource across all
regions, and each resource appears in the catalog as a component with a
component instance carrying its region and raw provider data.

**Why this priority**: The entire value of the feature — turning an Alibaba
Cloud account's inventory into catalog components — is delivered by this
story alone. Everything else is refinement.

**Independent Test**: Configure a credential + importer config, trigger a
run against a mocked or sandbox Alibaba account, and verify components and
instances appear in the catalog with correct provider, category, and stable
external IDs.

**Acceptance Scenarios**:

1. **Given** a stored credential with `accessKeyId` and `accessKeySecret`
   and a valid importer config, **When** a run executes, **Then** the
   catalog contains one account component for the Alibaba Cloud account and
   one component per discovered resource, each with a single instance.
2. **Given** resources of types the importer recognizes, **When** the run
   executes, **Then** each component carries the correct category (e.g. an
   ECS instance becomes Compute, an OSS bucket becomes Storage, an RDS
   instance becomes Database).
3. **Given** the same account imported twice, **When** the second run
   executes, **Then** existing components are reconciled by stable external
   ID rather than duplicated.
4. **Given** a credential whose account has not enabled the required
   inventory service, **When** a run executes, **Then** the run fails fast
   with an actionable message naming the service to enable — before yielding
   any assets.

---

### User Story 2 - Verify credentials before importing (Priority: P2)

Before scheduling imports, the administrator uses the credential test action
on the stored Alibaba Cloud credential and gets an immediate success or an
actionable failure — without running a full import.

**Why this priority**: Prevents the most common setup failure (bad key or
insufficient permissions) from surfacing only inside a run. Follows the
existing credential-test pattern used by other importers.

**Independent Test**: Create the credential, invoke the test action, and
verify it returns success for valid keys and a safe, secret-free error for
invalid ones.

**Acceptance Scenarios**:

1. **Given** a valid AccessKey pair, **When** the credential test runs,
   **Then** it returns success.
2. **Given** an invalid or revoked key, **When** the credential test runs,
   **Then** it returns a failure whose message identifies the problem class
   and never echoes credential material.

---

### User Story 3 - Scope the import to what matters (Priority: P2)

The administrator narrows discovery by region, resource type, or resource
group so the catalog only ingests the slice of the account they care about.

**Why this priority**: Large accounts produce noise; scoped imports keep the
catalog curatable. Valuable but not required for the feature to work.

**Independent Test**: Set `regionIds`, `resourceTypes`, and/or
`resourceGroupId` in the config, run, and verify only matching resources
become components.

**Acceptance Scenarios**:

1. **Given** `regionIds: ["cn-hangzhou"]`, **When** a run executes, **Then**
   only resources in that region are imported.
2. **Given** `resourceTypes: ["ACS::OSS::Bucket"]`, **When** a run executes,
   **Then** only OSS buckets are imported.
3. **Given** no filters, **When** a run executes, **Then** every supported
   resource the credential can see is imported.

---

### User Story 4 - See what was skipped (Priority: P2)

When the provider reports resource types the importer does not yet map, the
administrator can see exactly what was skipped — a count and the type list —
on the imported account component, instead of silently losing coverage.

**Why this priority**: Discover-all is the default, so honesty about gaps is
what keeps it trustworthy. Without this, users cannot tell "nothing exists"
from "we didn't import it".

**Independent Test**: Include an unmapped resource type in the discovered
set, run, and verify the account component's coverage summary reports it as
skipped while the run still succeeds.

**Acceptance Scenarios**:

1. **Given** discovered resources of an unmapped type, **When** a run
   executes, **Then** the run succeeds, a warning is logged, and the account
   component's coverage summary lists that type as skipped.
2. **Given** only mapped types exist, **When** a run executes, **Then** the
   coverage summary reports zero skipped.

---

### User Story 5 - Enrich components with live detail (Priority: P3)

The administrator enables detail enrichment so each component instance
carries the resource's live configuration and, where the provider exposes
one, an operational status (running/stopped/etc.).

**Why this priority**: Status fidelity improves catalog usefulness but costs
one provider call per resource — opt-in because base inventory already
delivers the P1 value.

**Independent Test**: Enable `enrichResources`, run, and verify instances
carry status and enriched raw configuration; disable it and verify a faster,
status-free run still works.

**Acceptance Scenarios**:

1. **Given** `enrichResources: true`, **When** a run executes, **Then**
   instance raw configuration contains the full resource configuration and
   status is populated where the provider exposes one.
2. **Given** `enrichResources: true` and an enrichment call denied by
   permissions, **When** a run executes, **Then** the affected component
   records a degraded capability marker and the run completes.

---

### User Story 6 - Attach cost data to components (Priority: P3)

The administrator enables cost import so each component's details carry its
billing for a chosen period, supporting spend-aware curation.

**Why this priority**: Nice-to-have analytics on top of the catalog; not on
the critical path for inventory value.

**Independent Test**: Enable `includeCosts`, run, and verify components carry
cost details for the configured billing period; without the permission,
verify a capability marker instead of a failure.

**Acceptance Scenarios**:

1. **Given** `includeCosts: true` and a permitted credential, **When** a run
   executes, **Then** components carry per-resource cost entries for the
   configured billing period.
2. **Given** `includeCosts: true` and insufficient billing permissions,
   **When** a run executes, **Then** a `FORBIDDEN` capability marker is
   recorded and the run completes.

---

### Edge Cases

- **Resource Center disabled in the account** → run fails fast with an
  actionable message before any asset is yielded (US1 scenario 4).
- **Empty account / zero resources** → run succeeds; only the account
  component is produced.
- **Unmapped resource types** → skipped with warning + coverage summary,
  never fatal (US4).
- **Rename between runs** → external IDs are provider resource IDs/ARNs, so
  the component reconciles rather than duplicating; display name updates.
- **Throttling under pagination** → the importer retries with backoff within
  the provider's rate limits; a persistent throttle surfaces as a run error.
- **Aborted run mid-pagination** → iteration stops promptly; no further
  assets are yielded.
- **Missing optional permissions** (costs, enrichment) → capability markers,
  never run failures.
- **STS-temporary credentials** → optional `securityToken` secret is
  supported alongside the AccessKey pair.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A new importer named `alibaba-cloud` MUST be selectable when
  creating an importer configuration and registered with the backend
  importer registry like existing in-tree importers.
- **FR-002**: The importer MUST declare `accessKeyId` and `accessKeySecret`
  as required secrets and `securityToken` as optional, resolved from stored
  credentials — never from environment variables.
- **FR-003**: Each run MUST verify the account's resource-inventory service
  is enabled before discovery and MUST fail fast with an actionable message
  when it is not.
- **FR-004**: Each run MUST yield exactly one account component identifying
  the Alibaba Cloud account the credential belongs to.
- **FR-005**: Every discovered resource MUST yield a component whose
  external ID is the provider resource ID or ARN (stable across renames),
  plus exactly one instance carrying the resource's region and raw provider
  record.
- **FR-006**: Resource types with a known mapping MUST receive their
  category; unmapped types MUST be skipped with a warning and counted —
  never fail the run and never be silently dropped.
- **FR-007**: The account component MUST record a coverage summary —
  discovered count, imported count, skipped count, and the list of skipped
  resource types.
- **FR-008**: The config MUST support optional `regionIds`, `resourceTypes`,
  and `resourceGroupId` filters that narrow discovery.
- **FR-009**: The config MUST support an `environment` selection defaulting
  to `PRODUCTION`, applied to every produced instance.
- **FR-010**: When `enrichResources` is enabled, each component MUST
  receive its full provider configuration and best-effort operational
  status; per-resource enrichment failures MUST degrade to capability
  markers, not run failures. Default: disabled.
- **FR-011**: When `includeCosts` is enabled, components MUST carry
  per-resource cost data for the configured (or latest closed) billing
  period; insufficient permission MUST degrade to a `FORBIDDEN` capability
  marker. Default: disabled.
- **FR-012**: The importer MUST expose a credential test performing the
  smallest possible authenticated call; error messages MUST never contain
  credential material.
- **FR-013**: The importer MUST honor the run's abort signal at every
  network and pagination boundary.
- **FR-014**: Alibaba Cloud MUST appear as a selectable provider labeled
  "Alibaba Cloud" wherever component providers are surfaced, with data
  integrity constraints accepting the new provider value.
- **FR-015**: Any URL config field (endpoint override) MUST be validated by
  the shared URL-safety guard.
- **FR-016**: Every yielded asset MUST satisfy the `DiscoveredAsset`
  contract validation before emission.

### Key Entities

- **Importer configuration** (existing entity): new importer name
  `alibaba-cloud` with its own config fields and credential linkage.
- **Component** (existing entity): gains `ALIBABA_CLOUD` as a provider
  value; new records per discovered Alibaba resource plus the account
  component.
- **Component Instance** (existing entity): one per discovered resource,
  carrying region, optional status, environment, and raw provider data.
- **Credential** (existing entity): bundles `accessKeyId`,
  `accessKeySecret`, and optional `securityToken` for this importer.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A first-time user can go from stored credential to visible
  catalog components in a single configuration + run, with no provider-side
  setup beyond enabling the inventory service and least-privilege keys.
- **SC-002**: 100% of discovered resources of mapped types appear as
  catalog components after a run; 100% of unmapped types appear in the
  coverage summary.
- **SC-003**: Repeat runs over an unchanged account create zero duplicate
  components (reconciliation by stable external ID).
- **SC-004**: The credential test returns a definitive result in a single
  provider call and never exposes credential material in its output.
- **SC-005**: A run aborted mid-discovery stops promptly and yields no
  further assets.
- **SC-006**: Runs with insufficient optional permissions (costs,
  enrichment) complete successfully with degraded-capability markers rather
  than failing.

## Assumptions

- The user provides a RAM user's AccessKey pair (least privilege); root
  account keys work but are not recommended.
- The account's resource inventory service is enabled — if not, the run
  fails fast with instructions rather than silently returning nothing.
- One credential set covers one Alibaba Cloud account; multi-account
  (Resource Directory) aggregation is out of scope.
- Billing data is lagged; the default period is the latest closed billing
  cycle.
- Provider-specific network endpoints (China vs. international, VPC) are
  handled via the optional endpoint override.
- Deleted resources are not imported in v1 — disappearance is handled by
  the backend's reconciliation marking instances gone.
- The provider's list of supported resource types grows over time; the
  category map lags gracefully via visible skips rather than failures.
