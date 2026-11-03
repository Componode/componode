# Web/API Importers, Product Map, and Component Relationship Views

> **Purpose**: Validate the two supplied journey specifications against
> Componode's current implementation and ratified architecture, then assess
> whether the Product Map's visual pattern is suitable for Component
> relationships.
>
> **Scope**: Read-only UX, domain-model, implementation, and test-plan review,
> followed by a user-confirmed decision record. This report does not implement
> application behavior; durable decisions and executable feature artifacts are
> recorded separately in ADRs and `specs/`.
>
> **Authority**: Informative research only. The supplied v0 documents were
> drafts; decisions confirmed during grilling are ratified separately in
> ADR-126, ADR-127, ADR-128, and their amendments.

## Executive summary

1. **Web/API importer journey** — The user selected multi-profile configs with
   one Component per profile, multiple ComponentInstances, and one managed URL
   Check per instance. ImporterConfig is the source of check definitions; the
   core materializes URL Check records while the independent scheduler retains
   observations. The generated Source key is stable across URL edits and
   config recreation. Check outcomes update monitored ComponentInstance
   status after the first observation, so Product health changes accordingly.
   ADR-126 records this deliberate amendment to the earlier separation.
2. **Product Map Canvas** — The user selected a read-only topology at the top
   of Dependencies, with edge-authoring controls below. ComponentGroup
   dependencies appear as nodes; individual Components remain in the
   Components list. The map covers every relation, including `consumedBy`,
   uses related-Product health/counts from a bounded read, and supports one-hop
   focus/expand/inspection without pan/zoom/edit. ADR-127 records the
   amendment to ADR-118.
3. **Component relationships** — The user selected a separate, read-only
   Relationships tab using the Product Map's visual/accessibility patterns
   without a generic graph module. It shows typed Component edges, direct and
   group-mediated Product dependencies, and nested ComponentInstances. Since
   the current application has no writer for Component-to-Component edges,
   the tab displays only stored data and honest empty states. ADR-128 records
   this scope.

**Handoff**: The decisions are split into three separate feature
specifications—Web/API importer journey, Product Map topology, and Component
Relationships—because they have distinct data contracts, ADR impacts, and
independently testable acceptance criteria. No application implementation is
included.

## Review basis and authority

### Repository snapshot

- Review began on a clean local `main` at `b90c81e`. The local branch was
  seven commits behind `origin/main`; the planning branch
  `058-web-api-importer-journey` was created from current upstream
  `9fcbed9`. The upstream commits include shipped spec 056 (URL Check
  repeated-failure auto-disable) and spec 057 (Alibaba importer fix). The
  importer and Product Map implementation files were not among those seven
  commits, but the current URL Check contract was used for planning.
- The two supplied v0 documents are present in the private
  `Componode/v0-componode-dpam` repository at commit
  `cf74be03339e5d516378d740b25354418ce530cc`. Both identify themselves as
  **Draft for grilling. Not ratified.**

### Governing project sources

The review follows the repository's Research Workflow in `AGENTS.md`:
research documents are informative; a move from research to specification
requires grilling open decisions and ratifying architectural changes before
creating authoritative `spec.md`, `plan.md`, and `tasks.md`.

Relevant ratified/current sources:

- [ADR-118 — Product Map Canvas](adrs/ADR-118-product-map-canvas.md): read-only,
  data-true, tokenized product map; authoring and broader graph interaction
  require governance.
- [ADR-123 — URL Check monitoring](adrs/ADR-123-http-url-check-monitoring.md):
  URL Checks are separate from importer runs, attach to ComponentInstances,
  and use a per-Component monitoring setup.
- [ADR-124 — URL Check execution surfaces](adrs/ADR-124-url-check-execution-surfaces.md):
  execution, credential, and API contracts.
- [ADR-125 — URL Check onboarding recovery](adrs/ADR-125-url-check-onboarding-recovery.md):
  complete first-check setup, zero-instance recovery, and selector roles.
- [ADR-119 — ImporterSource identity and lifecycle](adrs/ADR-119-importer-source-identity-and-lifecycle.md):
  durable source identity and source-scoped reconciliation.
- [ADR-016 — Component relationships](adrs/ADR-016-component-component-relationships.md)
  and [ADR-048 — relationship persistence](adrs/ADR-048-graph-relationship-persistence.md).
- [`CONTEXT.md`](../CONTEXT.md): canonical entity and relationship language.
- [`docs/ux.md`](../docs/ux.md): normative page, accessibility, responsive, and
  read-only Product Map constraints.
- [Feature 051 — URL Check monitoring](../specs/051-url-check-monitoring/spec.md)
  and [Feature 054 — URL Check onboarding](../specs/054-url-check-onboarding/spec.md).

Supplied drafts:

- [Web/API importer journey draft](https://github.com/Componode/v0-componode-dpam/blob/main/docs/web-api-importer-journey-spec.md)
- [Product Map Canvas draft](https://github.com/Componode/v0-componode-dpam/blob/main/docs/product-map-canvas-spec.md)

## Item 1 — Web/API importer journey

### What is accurate in the supplied assessment

The current `web-url` and `api-url` importers each accept one `url`, report
that canonicalized URL as their ImporterSource identity, and yield one
Component with one `PRODUCTION` ComponentInstance. The Component name and
external identity are URL-derived. The Web importer stores a short body
preview; the API importer parses and stores JSON response content.

Evidence:

- [Web URL config and importer](../packages/importer-web-url/src/config.ts#L4-L14)
  and [asset construction](../packages/importer-web-url/src/importer.ts#L24-L75).
- [API URL config and importer](../packages/importer-api-url/src/config.ts#L4-L14)
  and [asset construction](../packages/importer-api-url/src/importer.ts#L24-L75).
- [Current Web URL guide](../docs/importers/web-url.md) and
  [API URL guide](../docs/importers/api-url.md).

The concern that the detail page separates instances and URL Checks visually
is also valid: `ComponentDetail` renders the Instances card and
`UrlChecksCard` as siblings. However, the existing check list already
resolves each check's `componentInstanceId` and displays that instance's
environment. The relationship is present in data; the gap is how the journey
groups and explains it, not that checks have no instance association.

Evidence: [`component-detail.tsx`](../packages/frontend/src/ux/components/catalog/component-detail.tsx#L491-L583),
[`url-checks-card.tsx`](../packages/frontend/src/ux/components/catalog/url-checks-card.tsx#L162-L205),
and [`UrlCheckView`](../packages/frontend/src/ux/lib/view-types.ts#L396-L424).

### Architectural conflict: importer-owned checks vs URL Checks

The v0 draft proposes that an importer config own component profiles, their
instances, check settings, monitoring defaults, and the schedule that drives
everything. It also proposes replacing the separate component-level monitoring
setup.

At the time of review, this conflicted with ratified ADR-123:

| Concern              | Supplied draft                                                 | Current ratified contract                                                                         |
| -------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Monitoring ownership | ImporterConfig and importer run                                | URL Check is not an importer, ImporterSource, or `import_runs` workflow                           |
| Schedule             | One importer schedule drives components, instances, and checks | Importer schedule drives discovery; URL Checks have independent cadence and observations          |
| Check ownership      | Nested under configured instance in importer scope             | A URL Check references `componentInstanceId`; a monitoring setup groups checks per Component      |
| Output               | Importer probes each URL and creates check-like results        | Importer emits `DiscoveredAsset`; core owns catalog upsert; URL Check scheduler owns observations |
| Status               | Proposes a `PARTIAL` import run                                | Existing run statuses are `PENDING`, `RUNNING`, `COMPLETED`, `FAILED`, `CANCELLED`, `INTERRUPTED` |

Evidence:

- ADR-123 §1–5 explicitly separates monitoring from importer runs and defines
  the ComponentInstance association and per-Component setup.
- [`DiscoveredAsset`](../packages/core/src/contracts/discovered-asset.ts#L3-L34)
  contains Component and instance data, but no check configuration. It also
  records Component-to-Component relationships as reserved, not part of the
  importer contract.
- [`Importer`](../packages/core/src/contracts/importer.ts#L21-L45) is a
  pull-only `AsyncGenerator<DiscoveredAsset>`.
- [`IMPORT_RUN_STATUS`](../packages/core/src/constants/import-run-status.ts#L1-L10)
  has no `PARTIAL` state.
- [`docs/url-checks.md`](../docs/url-checks.md) documents that checks create
  no Components, ImporterSource memberships, or import runs.

The importer draft's check fields also diverge from current URL Check contracts:

- It permits `POST`, while the current check method set is `GET`/`HEAD`.
- It names auth modes `TOKEN`/`HEADERS`, while the contract uses `BEARER` and
  `CUSTOM_HEADERS`.
- The current API-auth controls apply only to `API`-category Components, not
  `WEB_ENDPOINT` Components.
- It places execution vantage on each check, while current setup selects one
  vantage for all checks on a Component.
- It omits the now-shipped repeated-failure setting and state from spec 056:
  consecutive `FAILURE` and `MISSED` observations count toward auto-disable;
  `SUCCESS` resets the streak. See remote `main` commit `9fcbed9` and
  [spec 056](https://github.com/Componode/componode/blob/9fcbed9d1a9ec1e8cfe4c42c1220d96302eae04f/specs/056-url-check-failure-policy/spec.md).

These are contract differences, not naming-only UI changes. The user chose
the partial amendment recorded in ADR-126: ImporterConfig owns managed check
definitions and the core materializes them, while the URL Check scheduler,
observation history, Component monitoring setup, and importer discovery runs
remain separate.

### Identity, migration, and sync decisions

The following rules were settled during grilling and ratified by ADR-126:

1. **ImporterSource identity**: each collection receives a generated,
   immutable `sourceKey`, stored with the ImporterConfig and durable
   ImporterSource. The external identity is `collection:<sourceKey>`, not a
   URL set or display label. Recreating a config can reattach the existing
   `UNMONITORED` Source. This amends ADR-119's stable-key rule for the
   user-configured collection case.
2. **Component and instance identity**: stable `componentKey` and
   `instanceKey` values are separate from editable names and URLs. The same
   keys can intentionally resolve to shared Component/ComponentInstance
   records across Sources; changed display names, environments, and URLs do
   not silently change identity.
3. **Migration**: each old one-URL config becomes one profile with one
   instance; separate configs are not automatically merged. The migration
   preserves existing Component, ComponentInstance, ImporterSource, URL Check,
   and observation IDs where their provenance is unambiguous. A unique
   existing URL Check matching the instance URL is adopted; extra legacy
   checks are disabled and retained. If no unique match exists, the importer
   receives a new default check and the old rows remain disabled/read-only.
4. **Config versioning**: the manifest `version` field is descriptive; the
   current config service validates stored `scope` against the current
   manifest schema and has no automatic versioned-scope migration.
   Therefore the v2 change needs an explicit one-to-one migration and
   compatibility tests, not only a version-string bump.
5. **Check synchronization**: ImporterConfig is canonical for managed
   definitions; core synchronization materializes URL Check rows. A URL Check
   is shared by stable key across Sources, and conflicting definitions are
   rejected. The independent URL Check scheduler remains responsible for
   observations and retention.
6. **Status authority**: the importer keeps its one-shot fetch for discovery
   details and initial ComponentInstance status. After the first URL Check
   observation, Check outcomes are authoritative: `SUCCESS` → `RUNNING`,
   `FAILURE` → `ERROR`; `MISSED`, no-data, and disabled checks preserve the
   last status. The one-shot importer request still runs, but its later status
   values do not overwrite the Check-driven status. `GONE` remains
   source-reconciliation state. Product health therefore reflects the
   monitored instance status under the unchanged ADR-112 formula.
7. **Runs and cleanup**: every configured endpoint is evaluated; a failed
   endpoint is returned as an `ERROR` instance and the run remains
   `COMPLETED` when the configured inventory is complete. There is no
   `PARTIAL` status. A failed/incomplete run does not reconcile. A managed
   URL Check is deleted with its observations only after a completed run
   leaves the instance `GONE` and no effective Source membership remains.
   Config deletion instead pauses and retains managed checks/history.

Evidence: [ADR-126](./adrs/ADR-126-web-api-importer-profiles-and-managed-url-checks.md),
[ADR-119](./adrs/ADR-119-importer-source-identity-and-lifecycle.md),
[ADR-034](./adrs/ADR-034-componentinstance-upsert-key.md),
[`ImporterConfig` validation](../packages/backend/src/services/importer-config-service.ts#L319-L325),
and [`ImporterManifest`](../packages/core/src/importer-registry.ts#L10-L16).

### Confirmed Web/API UX and contract

- The Importer UI owns managed check edits; Component detail shows imported
  checks read-only. Legacy manual checks are disabled and retained. Direct
  URL Check write routes and manual Component-create monitoring are
  deprecated and reject writes; read routes and Component monitoring-setup
  defaults remain.
- Each imported ComponentInstance has one managed URL Check, with an
  optional separate health-check URL. Methods remain GET/HEAD; auth remains
  API-category-only; per-Component cadence/vantage defaults and the
  spec-056 per-check auto-disable override remain.
- Disabling an ImporterConfig pauses its managed checks. An explicit
  false→true transition re-enables configured-enabled checks and resets the
  failure streak; normal import runs do not clear an auto-disable state.
- A shared check remains scheduled while any effective, enabled Source
  membership declares the same stable check key. Conflicting check
  definitions are rejected.
- The Component detail's existing URL Check write controls are read-only for
  all checks. `POST /components` still supports ordinary manual
  Component/Instance creation, but no longer accepts a `monitoring` block.

## Item 2 — Product Map Canvas

### Current implementation review

The existing map is a product-centered composition of three regions:
consumers, the focal Digital Product, and ComponentGroups/Components. It
draws bezier edges from fixed columns, displays several other relationship
kinds as text, and duplicates information available in the Components and
Dependencies tabs.

The draft's identified UX issues are supported by current code:

- Edges follow the fixed layout rather than distinguish relation kinds.
- ComponentGroups and Components occupy the map while also appearing in
  dedicated detail surfaces.
- Focus handlers are attached to a non-focusable `div`; keyboard users cannot
  trigger the hover-equivalent trace.
- SVG edges are hidden below `lg` while the desktop layout retains a minimum
  width, producing a scrolled card with no connectors at narrower sizes.

Evidence: [`product-map.tsx`](../packages/frontend/src/ux/components/products/product-map.tsx#L64-L110)
and [`product-map.tsx` render tree](../packages/frontend/src/ux/components/products/product-map.tsx#L143-L249).
The behavior is governed by ADR-118, including its data-true and read-only
constraints. `docs/ux.md` requires WCAG 2.1 AA and a desktop-first surface
usable down to approximately 768px.

### Design gaps resolved in the Product Map decision

1. **Include every product relation, especially `consumedBy`.** The current
   ProductDetail contract contains `composedBy`, `composes`, `consumesFrom`,
   `consumedBy`, and `dependsOnGroups`. The v0 draft lists the first, second,
   third, and fifth, but omits `consumedBy` even though the current map uses it
   to show products that consume a platform. The revised design must preserve
   both incoming and outgoing relationship directions.
2. **Resolve ComponentGroup handling.** The draft's data contract lists
   `dependsOnGroups` as an upstream relation, while Q4 recommends that neither
   groups nor Components appear. The spec must say where every group
   dependency is represented if it is not a node. A reasonable option is to
   show the group edge as a typed dependency summary/detail without expanding
   its member Components into the canvas.
3. **Preserve direction, not just left/right placement.** The backend
   confirms:
   - `composedBy`: parents whose `COMPOSES` edge targets the focused product;
   - `composes`: children targeted by the focused product's `COMPOSES` edges;
   - `consumesFrom`: platform products the focused product consumes from;
   - `consumedBy`: products that consume the focused product as a platform.

   These relations do not all have the same arrow direction. For example,
   `consumesFrom` points from the focused product to a platform dependency,
   while `consumedBy` points from a consumer product to the focused platform.
   Column placement can express “dependency” and “consumer” context, but
   arrows and accessible descriptions must preserve actual source and target.

4. **Specify the node read contract.** The proposal asks node details to show
   kind, tier, health, component count, and an open link. The existing
   `ProductRef` contains only id, name, slug, type, and lifecycle. The product
   detail response has a health result for the focal product, not for each
   related ProductRef. The user chose to extend the existing response with
   related-Product health and Component counts in a bounded batch. Any response
   change requires OpenAPI and contract-test updates under ADR-104.
5. **Use the correct health concept.** Product health is the ADR-112 derived
   rollup over that Product's declared component dependencies. It is not a
   URL Check status or ComponentInstance lifecycle/status. Related-product
   health cannot be assumed from a type/name reference. Related-node status
   uses ADR-112 Product health, with null/no-data handling; `GONE` is never
   presented as Product health.
6. **Ratify the interaction boundary.** Focus, expansion, and a detail panel
   are read-only view interactions, but ADR-118 currently says interactive
   graph work needs its own spec/ADR. The amendment should explicitly define
   permitted selection/inspection/expansion and continue to prohibit
   pan/zoom/drag/layout editing and edge authoring.

Evidence: [`ProductDetail`](../packages/frontend/src/api/types.ts#L340-L356),
[`getProductDetail`](../packages/backend/src/services/product-service.ts#L172-L205),
and [Product health derivation](../packages/core/src/product-health.ts#L28-L60).
The product page currently maps `consumedBy` to the map's consumer list and
passes the other relation arrays separately:
[`$slug.tsx`](../packages/frontend/src/ux/app/products/$slug.tsx#L64-L96).

### Ratified Product Map direction

- Move topology to the top of the Dependencies tab; keep current
  edge-authoring/list controls below it.
- Render related DigitalProducts and ComponentGroups in a deterministic,
  one-hop layout. Do not render individual Components as graph nodes; keep
  them in the Components list on the same tab.
- Include `composedBy`, `composes`, `consumesFrom`, `consumedBy`, and
  `dependsOnGroups`. The physical layout and accessible text preserve actual
  source and target direction.
- Include related-Product health and Component counts in a bounded batch
  read. Product health follows ADR-112; null remains no data.
- Support keyboard-operable focus, selection, inspection, and `+N`
  expansion. Keep pan, zoom, drag, manual layout, and edge authoring out of
  scope. Implement loading, empty, error, forbidden, partial, responsive,
  and reduced-motion states, with no horizontal overflow at 768px.
- ADR-127 records the amendment to ADR-118 and `docs/ux.md`.

## Item 3 — Reusing the Product Map pattern for Components

### Existing model and implementation seam

ADR-016 defines three typed Component-to-Component relationships:

- `DEPENDS_ON`: Component → Component runtime dependency.
- `SOURCES_FROM`: service Component → repository Component provenance.
- `EXPOSES`: service Component → API Component.

Their persistence tables exist in the initial schema and Kysely DB type:
`component_depends_on_component`, `component_sources_from`, and
`component_exposes`. However, the inspected application has no corresponding
Component relationship route, read service, API hook, detail UI, or dedicated
tests. The current Component detail read returns metadata plus non-GONE
ComponentInstances. The separate `/components/:id/dependents` read returns
active DigitalProducts with direct `DEPENDS_ON` edges only.

Evidence: [relationship ADR](adrs/ADR-016-component-component-relationships.md),
[relationship tables](../packages/backend/src/db/migrations/001_initial_schema.ts#L446-L498),
[DB table registry](../packages/backend/src/db/types.ts#L438-L452),
[Component detail query](../packages/backend/src/services/component-catalog-service.ts#L231-L282),
and [Component routes](../packages/backend/src/routes/components.ts#L19-L37).

Product-to-Component dependencies are a different direction:
`DigitalProduct DEPENDS_ON Component` or `DigitalProduct DEPENDS_ON
ComponentGroup`. A Component can therefore show Products that depend on it,
but that is a reverse presentation of product-owned edges, not a new
Component-owned relationship. If a Product depends on a group containing the
Component, the view must identify that path as “via [ComponentGroup]” rather
than present it as a direct edge.

`HAS_INSTANCE` is one-to-many and is represented by the `componentId` foreign
key on ComponentInstance. A ComponentInstance is an operational occurrence
with environment and operational status; it is not a peer Component. For
managed checks, URL Check observations update that operational status under
ADR-126, while check history remains a separate monitoring record.

### Reuse assessment

**Reuse the visual and accessibility pattern; do not generalize the current
ProductMap implementation into a universal graph module yet.**

Good patterns to reuse:

- A focused entity and a bounded one-hop view.
- Stable, deterministic placement and typed relationship lanes.
- Progressive disclosure for high-degree relationships.
- Selection/focus with a compact detail panel and direct navigation.
- Native keyboard-operable controls, accessible relation descriptions, and
  `Escape` recovery.
- Explicit loading/empty/error/forbidden states and tokenized status
  presentation.
- Read-only graph inspection; no force layout, pan/zoom, or mutation controls.

Product-specific assumptions that should not transfer:

- “Depends on → this product → used by” as universal direction.
- `COMPOSES` DAG semantics or Product type/tier/criticality details.
- Product health as the status source for a Component or ComponentInstance.
- Product Components and ComponentGroups as equivalent graph layers.

Component relationships have several edge types with different semantics and
may be many-to-many; they should remain typed in the read contract and UI.
`ComponentInstance` should be displayed as a nested/owned section or expandable
rail, not mixed into the same peer-relationship lane. Component dependency
cycles, if present, must be rendered without assuming the product DAG rules.

### Ratified Component relationship view

- Add a dedicated, read-only Relationships tab with one-hop `+N` expansion.
- Use typed lanes for Component `DEPENDS_ON` in/out, `SOURCES_FROM`,
  `EXPOSES`, direct Product dependents, and Product dependencies “via
  [ComponentGroup]”. Keep direction and source/target semantics explicit.
- Nest ComponentInstances beneath the focused Component; they are not peer
  graph nodes. Include environment and current operational status. The view
  reads existing relationship rows and shows honest empty states where no
  Component-to-Component writer has populated them.
- Use the Product Map's accessibility and interaction patterns, not a generic
  graph module or a polymorphic edges model. Relationship authoring/ingestion
  remains a separate decision.
- ADR-128 records the new view and its typed read interface.

## Handoff test strategy

The following scenarios are the verification baseline for the separate
feature specifications. Each implementation spec must refine them into
test-first, independently verifiable user-story tasks.

### Web/API importer and monitoring journey

- Test `validateDiscoveredAsset` for each importer and config validation for
  every profile, instance, and check URL independently, including unsafe URL
  rejection and stable generated Source identity.
- Test one `DiscoveredAsset` per Component profile with multiple instances,
  stable Component/instance keys across rename and URL edits, and
  cross-environment duplicate URL cases.
- Test that the first importer result sets the initial instance status, the
  first URL Check observation takes authority, and later importer status
  values cannot overwrite it. Verify `SUCCESS`→`RUNNING`, `FAILURE`→`ERROR`,
  `MISSED`/no-data/disabled preserve-last-status, and `GONE` is never revived.
- Test managed check synchronization by stable key, one shared check across
  compatible Sources, conflict rejection for different definitions, and the
  enabled-owner union when a Source is paused or removed.
- Test Source-scoped reconciliation when one configured row disappears, when
  a second Source still reports the same Component, and when an ImporterConfig
  is disabled, deleted, reattached, or recreated from its durable Source key.
- Test endpoint cleanup only after a `COMPLETED` run and only after the
  ComponentInstance becomes `GONE` with no effective Source membership; a
  failed run must never delete checks or observations.
- Test migration from existing `{ url }` configs one-to-one for identity preservation,
  ImporterSource and run-history continuity, Component/instance record
  continuity, matching URL Check ID/history preservation, and handling of
  extra/ambiguous legacy checks. Include rollback/retry behavior.
- Test the full permission matrix for Editors/Admins where Credentials and
  Import Agents are involved; assert secret values never enter importer
  scope, observations, audit records, or logs.
- Test completed-run semantics: endpoint failures are represented as
  per-instance `ERROR` outcomes after every configured row is evaluated;
  fatal/incomplete runs remain `FAILED` and do not reconcile.
- Test importer disable/re-enable and spec-056 auto-disable interaction:
  ordinary runs preserve auto-disabled state; an explicit false→true config
  transition resets the streak and re-enables configured-enabled checks.
- Test deprecated URL Check and manual Component-create write paths return
  the controlled read-only error, while read/metrics/history paths still work.
- Update both importer setup guides and generated importer docs whenever
  config fields or importer behavior changes.

### Product Map

- Add frontend tests for all relation directions, including the currently
  omitted `consumedBy` case and the chosen ComponentGroup presentation.
- Add API contract tests for related-product fields and verify the read path
  has bounded query/request count.
- Verify keyboard-only node selection, accessible names, focus announcement,
  Escape clearing, and screen-reader-readable relation semantics.
- Verify loading, empty, error, forbidden, and partial relation states; no
  relation may disappear silently.
- Verify 768px and smaller layouts, no horizontal overflow, reduced-motion
  behavior, and token/meta-derived status tones.
- Add a Playwright flow that opens a product, follows a relationship, expands
  overflow, and opens the selected Product; assert all interactions remain
  read-only.

### Component relationships

- Add backend integration fixtures for each typed relation and assert
  direction, inactive/retired filtering policy, missing targets, and
  direct-versus-group Product dependency attribution.
- Add read-contract tests for relation groups, nested instances, Product
  dependencies, empty Component-to-Component tables, and URL Check-derived
  operational status.
- Add frontend unit tests for each typed group, accessible direction text,
  overflow, empty state, and deterministic rendering.
- Add Playwright keyboard and navigation coverage. Verify default queries
  exclude `RETIRED` Components and `GONE` instances unless explicitly
  requested.
- Add no-write assertions for the read-only view; relationship mutation and
  Component-to-Component edge ingestion remain outside this feature.

All later implementation tasks must preserve the project test-first rule,
update `docs/openapi.yaml` for any endpoint/response-contract change, regenerate
owned generated docs, and update user-facing importer/catalog guides as
applicable.

## Decision record from grilling (2026-11-03)

The decisions below were confirmed by the user. Durable architecture decisions
are recorded in [ADR-126](./adrs/ADR-126-web-api-importer-profiles-and-managed-url-checks.md),
[ADR-127](./adrs/ADR-127-product-map-topology-in-dependencies.md),
[ADR-128](./adrs/ADR-128-component-relationship-read-view.md), and their
amendments to earlier ADRs.

### Web/API importer journey

- Each importer config contains Component profiles; each profile yields one
  Component with multiple ComponentInstances. Profile names are editable and
  initially suggested from the URL host. Component and instance keys remain
  stable when names, environments, or URLs change.
- A generated immutable collection Source key survives URL-list edits and
  config deletion/recreation. A recreated config can reattach to the same
  durable Source. Existing one-URL configs migrate one-to-one; separate
  configs are not automatically merged.
- Each imported ComponentInstance has one managed URL Check, with an optional
  separate check URL. ImporterConfig is canonical for managed check
  definitions; core synchronizes materialized URL Check rows. URL Check
  observations and the independent scheduler remain the monitoring history
  and execution path.
- The Component-level monitoring setup remains the shared cadence/vantage
  layer. Per-check method is `GET`/`HEAD`; API-category Components alone may
  authenticate; the spec-056 `autoDisableAfter` override remains available.
- Shared Component/instance/check keys share one URL Check across Sources;
  conflicting definitions fail. The check remains scheduled while any
  effective, enabled Source membership declares the same key.
- Component detail displays imported checks read-only; Importer UI is the
  only authoring surface. Legacy manual checks are disabled and retained.
  Direct URL Check writes are deprecated and rejected immediately; GET,
  metrics, observations, and per-Component setup reads remain. The manual
  Component-create path remains but no longer creates URL Checks.
- A config disable pauses its managed checks. An explicit re-enable
  transition re-enables configured-enabled checks and resets their failure
  streak; ordinary runs do not. Config deletion pauses and retains check
  definitions/history. After a completed run makes an instance `GONE` with
  no effective Source memberships, its managed check and observations are
  deleted; shared instances/checks remain.
- Importer one-shot requests remain for discovery details and initial
  status. Once the first URL Check observation exists, the Check is
  authoritative: `SUCCESS` → `RUNNING`, `FAILURE` → `ERROR`, while
  `MISSED`, no-data, and disabled states preserve the last status. Later
  importer status values are ignored. `GONE` remains reconciliation-owned,
  and Product health consequently includes monitored instance status.
- The run status set remains unchanged. Every configured endpoint is
  evaluated; row failures become instance `ERROR` results and a complete
  inventory is `COMPLETED`. Fatal/incomplete runs remain `FAILED` and do
  not reconcile.
- Existing configs migrate one-to-one while preserving IDs/history where
  provenance is unambiguous. A unique check whose URL matches the instance
  URL is adopted; extra legacy checks are disabled/retained. Ambiguous or
  absent matches receive a new default check without merging old histories.
- `POST /components` continues to support ordinary manual Component and
  ComponentInstance creation but rejects its old `monitoring` payload.
  Component-level monitoring-setup writes remain available.

### Product Map

- Remove the dedicated Map tab and place the topology at the top of
  Dependencies; preserve existing edge-authoring/list controls below it.
- Show ComponentGroup dependency nodes and related Products, but not
  individual Component nodes; Components remain in the Components list.
- Preserve `composedBy`, `composes`, `consumesFrom`, `consumedBy`, and
  `dependsOnGroups` with correct source/target direction.
- Extend the existing product detail response with related Product health
  and Component counts in a bounded batch. Product health follows ADR-112.
- Use one-hop focus/selection/inspection and `+N` expansion; remain
  read-only, keyboard-operable, responsive, and reduced-motion aware. Pan,
  zoom, drag, manual layout, and edge authoring remain excluded.

### Component Relationships

- Add a separate read-only Relationships tab with one-hop `+N` expansion.
- Reuse the Product Map's visual/accessibility patterns, not its
  product-specific semantics or a generic graph module.
- Render typed Component `DEPENDS_ON`, `SOURCES_FROM`, and `EXPOSES` lanes,
  direct Product dependents, and group-mediated Product dependencies
  attributed as “via [ComponentGroup]”.
- Nest ComponentInstances beneath the Component rather than rendering them
  as peer nodes; retain the existing Instances table in Overview as an
  intentional duplicate. Read existing Component-to-Component rows and show
  honest empty states until a separate authoring/ingestion feature populates
  them.
- Relationship authoring and importer-declared Component edges remain out
  of scope.

## Specification handoff

The approved handoff consists of three independent spec-kit feature folders:

1. `058-web-api-importer-journey` — importer collection model, managed
   URL Check synchronization, migration, and status propagation.
2. `059-product-map-topology` — complete product relations, Dependencies-tab
   placement, related Product read fields, and accessible one-hop topology.
3. `060-component-relationships` — typed read contract, read-only
   Relationships tab, Product/group paths, nested instances, and empty states
   for currently unwritten Component-to-Component relations.

Each feature receives `spec.md`, `plan.md`, relevant `research.md`,
`data-model.md`, `contracts/`, `quickstart.md`, and `tasks.md`. Tasks must
include test-first coverage, OpenAPI synchronization for changed contracts,
generated-doc regeneration, importer guide updates, and the UX-gap/flag
governance required for missing backend surfaces.

The planning branch is `058-web-api-importer-journey`, based on upstream
`9fcbed9`. No application implementation or application tests are included in
this handoff.
