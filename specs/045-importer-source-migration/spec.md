# Feature Specification: Importer Source Migration — staged adoption of ImporterSource provenance across in-tree importers

**Feature Branch**: `045-importer-source-migration`

**Created**: 2026-10-31

**Status**: Draft

**Input**: Phase 2 / Wave B of the Docker importer program (`researches/docker-importer-implementation-tracking.md`, `researches/docker-importer-spec-waves.md`): staged migration of the eight existing in-tree importers onto the `ImporterSource` provenance model shipped in spec 044 — per-importer provider-native source-identity keys via `context.reportSourceIdentity()`, source-qualified external IDs where provider-native asset identifiers are not already globally unique, the Wave A follow-up splitting asset-supplied details into canonical vs per-source fields and populating membership `details`, defensible backfill of Source memberships with `LEGACY_UNATTRIBUTED` preservation (no auto-split/merge/rekey), and documented per-importer identity keys, scope boundaries, and legacy cleanup.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Every in-tree importer reports its source identity (Priority: P1)

An operator configures and runs any of the eight bundled importers (GitHub, AWS, Azure, Alibaba Cloud, Kubernetes, API URL, Web URL, MCP Server). Before the importer yields its first asset — including when the inventory is empty — it reports the provider-native canonical identity of the external system it scanned: GitHub organization ID plus canonicalized base URL (GHES-aware), cloud account/subscription identity, Kubernetes cluster identity, or the canonicalized endpoint URL for URL-based importers. The system registers-or-matches the durable `ImporterSource` and attributes the run to it, exactly as the generic contract already requires.

**Why this priority**: Source reporting is the foundation of Wave B — until every in-tree importer reports identity, the whole catalog stays on legacy provenance and nothing else in this wave can activate. It is also the correctness prerequisite for multi-source sharing (two GitHub orgs, two AWS accounts) that the Docker program depends on.

**Independent Test**: run each importer → an `ImporterSource` exists keyed by that importer's provider-native identity and the run row is attributed to it; run a second config reaching the same external system → same Source matched, not duplicated; run with an empty inventory → Source still registered and run attributed.

**Acceptance Scenarios**:

1. **Given** any in-tree importer starting a run, **When** it reaches the provider and learns its identity, **Then** it reports that identity before yielding assets and the run is attributed to the matching `ImporterSource`.
2. **Given** an in-tree importer with a reachable-but-empty inventory, **When** the run completes, **Then** the Source is still registered and the run attributed to it.
3. **Given** a URL-based source identity containing credentials or auth parameters, **When** the identity is persisted, **Then** userinfo, authentication query parameters, and fragments are stripped — no secret material lands in the identity.
4. **Given** a provider that offers no trustworthy identity for a given deployment, **When** an admin supplies a stable key, **Then** that key is used as the source identity — never a display name.
5. **Given** an importer that cannot determine its provider identity (e.g. insufficient permission to read account metadata), **When** the run starts, **Then** the run fails as a contract violation rather than silently reporting unattributed assets.

### User Story 2 - Source-qualified external IDs prevent false sharing (Priority: P1)

Two different external systems of the same kind — two AWS accounts, two GitHub organizations, two Kubernetes clusters — each contain a resource whose provider-native identifier is only unique within that system. Before multi-source reporting is switched on for an importer, its emitted asset external IDs must be qualified with source identity where the provider-native identifier is not already globally unique, so two distinct real-world resources can never collapse into one catalog Component, and the same logical asset seen from two vantage points still shares correctly.

**Why this priority**: This is the safety gate for multi-source sharing — without it, enabling source reporting on cloud importers actively corrupts the catalog by merging distinct resources. Equal priority with US1 because enabling identity without qualified IDs is worse than not migrating.

**Independent Test**: run the same importer against two distinct accounts/tenants each containing a same-named resource → two distinct Components exist, each with its own Source membership; then re-run either source → each Component still resolves to its own record.

**Acceptance Scenarios**:

1. **Given** two distinct external systems of one importer type that contain identically-named resources, **When** both are imported after migration, **Then** the catalog holds two distinct Components rather than merging them.
2. **Given** a migrated importer whose provider-native IDs are already globally unique, **When** it emits assets, **Then** no redundant qualifier is added — external IDs stay as compact as the provider allows.
3. **Given** a catalog Component created before migration, **When** the migrated importer runs again against the same system, **Then** the same catalog record is updated — migration never produces a duplicate Component for the same logical asset.
4. **Given** external IDs stored on pre-migration rows, **When** the migration runs, **Then** stored values are preserved — history is never rewritten.

### User Story 3 - Per-source details stop last-writer-wins (Priority: P2)

Two Sources report the same logical Component and each supplies its own detail facts (e.g. region-specific attributes). Source-specific metadata lands on that Source's membership record; only canonical shared facts land on `Component.details`. A second Source's run no longer clobbers the first Source's detail view, and operators can see what each source reported.

**Why this priority**: Wave A shipped the membership `details` column but left it `null` while `asset.details` kept last-writer-wins on the shared row — a tracked follow-up that becomes user-visible the moment US2 enables real multi-source reporting. P2 because it depends on US1 and matters most once US2 is live.

**Independent Test**: two sources report one shared component with differing detail values → each source's facts are readable from its own membership and neither overwrites the other's view; canonical fields remain consistent on the shared record.

**Acceptance Scenarios**:

1. **Given** an asset carrying detail facts, **When** the run persists it, **Then** source-specific facts are written to the reporting Source's membership `details` instead of being silently dropped.
2. **Given** two Sources reporting one Component with conflicting detail values, **When** both runs complete, **Then** each Source's membership retains its own facts and the shared record holds only canonical fields.
3. **Given** a single-Source Component reported before and after this change, **When** details are read, **Then** behavior is unchanged for the common case — no operator-visible regression.

### User Story 4 - Existing catalog data migrates defensibly or stays legacy (Priority: P2)

An existing deployment upgrades: its catalog already holds Components, Instances, runs, and product edges produced under legacy provenance. Where surviving run/config provenance makes the assignment defensible, backfill attributes historical records to the correct Source and creates their memberships. Where provenance is ambiguous or absent, records keep `LEGACY_UNATTRIBUTED` provenance forever — nothing is auto-split, merged, rekeyed, or auto-retired, and existing external IDs, Product edges, and curated Component fields are preserved.

**Why this priority**: This is the migration half of "staged migration" — Wave B is not done when new runs attribute correctly; existing data must land in a defensible state. P2 because new-run correctness (US1–US3) must exist first.

**Independent Test**: seed pre-migration data with and without defensible provenance → run the migration → attributable records gain Source membership, ambiguous records stay `LEGACY_UNATTRIBUTED`, and every curated field, edge, and external ID is byte-identical to before.

**Acceptance Scenarios**:

1. **Given** historical runs/configs that map unambiguously to one provider identity, **When** the migration executes, **Then** the corresponding Source exists and affected Components/Instances gain membership under it.
2. **Given** records whose provenance cannot be reconstructed (deleted configs, ambiguous attribution, prior collisions), **When** the migration executes, **Then** they remain `LEGACY_UNATTRIBUTED` with all fields and edges preserved.
3. **Given** a deployment with no pre-existing data, **When** the migration executes, **Then** it completes cleanly as a no-op.

### User Story 5 - Each importer's migration is documented (Priority: P3)

An operator (or a future importer author) can read, per importer, which provider-native key constitutes its source identity, what the migration's scope boundary was, and what legacy cleanup (if any) was performed or deliberately skipped — so attribution surprises have an answer that isn't "read the code."

**Why this priority**: The wave contract explicitly requires documenting each importer migration. P3 because it delivers no runtime behavior, but it is a stated completion condition of Wave B — the work is incomplete without it.

**Independent Test**: for each of the eight importers, a documented identity key, scope boundary, and legacy-cleanup disposition exists and matches the implemented behavior.

**Acceptance Scenarios**:

1. **Given** the set of migrated importers, **When** documentation is consulted, **Then** every importer's source-identity key is recorded with its scope boundary and legacy-cleanup disposition.

---

### Edge Cases

- Importer connects but lacks permission to read provider identity metadata (e.g. cannot call the account-identity API) — run fails as a contract violation unless an admin-supplied stable key is configured; it must not silently emit unattributed assets.
- Same external system reached through two different configs or credentials — both configs rebind to the same Source on report; the catalog must not fork.
- GitHub Enterprise Server with a path-bearing base URL, and cloud endpoints behind custom `endpoint` overrides — identity canonicalization must still produce one stable key per real system.
- Legacy component colliding with a migrated source-qualified external ID — matching must resolve to the same catalog record for the same logical asset; a previously unattributed record gains Source membership rather than spawning a duplicate.
- A provider identity that changes (recreated cluster, renamed org with stable ID) — identity keyed on the durable provider ID must survive display-name churn; conversely a genuinely new system gets a new Source.
- Backfill racing a live import — the migration and a concurrent run must not double-create Sources or memberships for the same identity.
- An importer whose config endpoint changes to a *different* system under the same config — the Source binding follows reported identity, not the config; run history re-attributes to the new system's Source.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: All eight in-tree importers MUST declare source-identity reporting in their manifest and invoke `context.reportSourceIdentity()` before the first asset yield on every run — including empty inventories. A run that reaches yield without reporting MUST fail as a contract violation.
- **FR-002**: Each importer MUST report a provider-native canonical identity: GitHub → organization/account ID combined with canonicalized base URL (GHES-aware); AWS, Azure, Alibaba Cloud → account/subscription identity; Kubernetes → cluster identity; API URL, Web URL, MCP Server → canonicalized endpoint URL. Where a provider offers no trustworthy identity, an admin-supplied stable key is the fallback. Sources MUST never be matched by display name, and URL identities MUST be canonicalized to strip userinfo, auth query parameters, and fragments.
- **FR-003**: Where a provider-native asset identifier is not already globally unique, the migrated importer MUST qualify emitted external IDs with source identity so that identically-named resources in distinct systems can never merge into one catalog Component. Importers whose provider IDs are already globally unique MUST NOT add redundant qualifiers.
- **FR-004**: Migration MUST preserve catalog continuity: a record created before migration and re-reported by the migrated importer MUST resolve to the same catalog record — no duplicate Components for the same logical asset, and stored external ID values on pre-existing rows MUST NOT be rewritten.
- **FR-005**: Asset-supplied details MUST be split into canonical vs per-source facts: source-specific facts persist on the Source membership's `details`; canonical shared facts persist on the shared record. Two Sources reporting one Component MUST each retain their own detail view — completing the Wave A deferral that left membership `details` unpopulated.
- **FR-006**: Historical Components, ComponentInstances, and import runs MUST be backfilled to Sources and memberships only where surviving run/config provenance makes the attribution defensible. Records whose provenance is absent or ambiguous MUST remain `LEGACY_UNATTRIBUTED`; the system MUST NOT auto-split, auto-merge, rekey, or auto-retire uncertain records.
- **FR-007**: Migration MUST preserve all existing Product edges, curated Component fields, external IDs, and run history — including for records that remain `LEGACY_UNATTRIBUTED`.
- **FR-008**: Reconciliation semantics for migrated importers MUST follow the source-scoped rules ratified in ADR-036/ADR-035 amendments: completed runs deactivate only their own Source's absent memberships; `RETIRED`/`GONE` apply only when no effective-active membership remains; incomplete runs perform no retirement.
- **FR-009**: Each migrated importer MUST be documented: its source-identity key, the migration's scope boundary, and any legacy cleanup performed or deliberately skipped — in the durable documentation surface used for importer behavior (per-importer guide or migration record).
- **FR-010**: Every contract surface touched beyond what ADR-119 and its amendments already ratify (config keys, manifest fields, error codes, identity formats per provider) MUST be ratified per the ADR fidelity rule in the same change.

### Key Entities

- **ImporterSource** — existing durable provenance record (spec 044); gains one concrete provider-native identity key per in-tree importer.
- **Source membership** — existing durable Source→Component/ComponentInstance record; gains populated per-source `details` for reported assets.
- **DiscoveredAsset externalId** — the importer-emitted identifier; becomes source-qualified where the provider-native ID is not globally unique.
- **ImportRun** — existing `sourceId` attribution now exercised by all in-tree importers instead of only the test harness.
- **`LEGACY_UNATTRIBUTED` provenance** — `import_runs.sourceId IS NULL`; the terminal state for records without defensible attribution.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of in-tree importers (8/8) report a provider-native source identity before first yield, verified by automated runs including the empty-inventory case — zero importers left on silent legacy provenance.
- **SC-002**: Two configs reaching the same external system converge to one `ImporterSource`; two distinct systems of the same importer type never share a Source — verified for at least the multi-tenant importers (GitHub, AWS, Azure, Alibaba Cloud, Kubernetes).
- **SC-003**: In the same-named-resource scenario, two distinct external systems produce two distinct Components — zero false merges — while the same logical asset seen from two sources still shares one record.
- **SC-004**: After migration, 100% of pre-existing catalog records are either defensibly attributed to a Source or explicitly `LEGACY_UNATTRIBUTED`; zero records auto-split, merged, rekeyed, or auto-retired; curated fields, Product edges, and run history are preserved.
- **SC-005**: Newly reported assets populate membership `details` with source-specific facts; a second Source's run no longer overwrites the first Source's detail view on shared Components.
- **SC-006**: Every migrated importer documents its identity key, scope boundary, and legacy-cleanup disposition; documentation is verified against implemented behavior for all 8 importers.
- **SC-007**: Lint, typecheck, tests, and build are green across all changed packages; `docs/openapi.yaml` stays in sync where contract surfaces change (ADR-104).

## Assumptions

- The Wave B scope is the eight in-tree importers only; `@componode/importer-docker` lands its own source identity natively in Wave C and is out of scope here.
- No frontend work is required — Source UI is deferred to Wave D per `docker-importer-spec-waves.md`; any operator-facing surface needed ships through the existing API.
- The migration ships as an ordered, auditable backend mechanism (data migration and/or first-run attribution), with the mechanism decided at plan — but its defensibility rules and preservation invariants are spec-level requirements.
- Per-importer identity keys listed in FR-002 follow the wave document's approved mapping; deviations discovered during plan (e.g. a provider whose identity API needs a permission the current credential lacks) are decided at plan and ratified if they alter the contract surface.
- "Explicit waves" in the tracking doc refers to ordering within this spec's implementation (per-importer staging), not separate numbered specs — this spec covers all eight in-tree importers as one wave.
- Remote (Agent-executed) runs report source identity through the same contract hub-side and agent-side; no protocol change is expected beyond what spec 044 already shipped, and any needed change is ratified in the same change.
