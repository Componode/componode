# Feature Specification: Component catalog and remaining v1 importers

**Feature Branch**: `003-component-catalog`

**Created**: 2026-09-03

**Status**: Shipped

**Input**: User description: "003-component-catalog"

## Clarifications

### Session 2026-09-03

- Q: Should the component catalog list use pagination or infinite scroll, and what is the default page size? → A: Server-driven pagination with 50 items per page (Option C).
- Q: Should a Component belong to one or many ComponentGroups? → A: At most one `ComponentGroup` via a `componentGroupId` foreign key on `components` (Option A).
- Q: What matching strategy should the catalog search use for name, slug, and externalId? → A: Case-insensitive prefix matching on `name` and `slug`; case-insensitive exact match on `externalId` (Option A).
- Q: What are the multi-value filter semantics across category, provider, lifecycle, status, and ComponentGroup? → A: OR within each dimension, AND across dimensions (Option B).
- Q: Does ComponentGroup have a lifecycle, and how does RETIRED affect member components? → A: `ComponentGroup` has `ACTIVE`/`RETIRED` lifecycle; `RETIRED` groups are hidden by default and their components are treated as ungrouped in default views (Option A).

## User Scenarios & Testing

### User Story 1 - Browse and search the component catalog (Priority: P1)

As any authenticated user, I want to browse a searchable, filterable list of components so I can find the infrastructure and code assets my team owns.

**Why this priority**: The milestone headline is "dashboard shows real components." Without a catalog UI, the imported data from 002 is invisible to users.

**Independent Test**: Load the `/components` page and verify that components imported from any source appear with their name, category, provider, and lifecycle.

**Acceptance Scenarios**:

1. **Given** at least one component exists, **when** an authenticated user opens the catalog page, **then** the list renders with server-driven pagination (50 items per page by default) and shows name, category, provider, lifecycle, and owner.
2. **Given** components with different categories and providers, **when** the user selects filters, **then** the list updates to show only matching components.
3. **Given** a search term, **when** the user types in the search box, **then** the list filters by name, slug, or externalId.
4. **Given** the default view, **when** the page loads, **then** `RETIRED` components and `GONE` instances are hidden unless an explicit filter is applied.

---

### User Story 2 - View component detail (Priority: P2)

As any authenticated user, I want to view a single component's details, including its instances, environment state, and group membership, so I can understand what the asset is and where it runs.

**Why this priority**: The list view is not enough; users need to inspect a component's operational state and metadata before making curation decisions.

**Independent Test**: Click a component in the catalog and verify the detail page shows instances grouped by environment and the component's metadata.

**Acceptance Scenarios**:

1. **Given** a component with one or more instances, **when** the user opens the detail page, **then** it displays `name`, `category`, `provider`, `resourceType`, `lifecycle`, `details`, and a list of `ComponentInstance` rows with `environment`, `status`, `lastSeenAt`, and `url`/`region`/`version` if present.
2. **Given** a component that belongs to a `ComponentGroup`, **when** the user opens the detail page, **then** the group name and slug are shown with a link to the group.
3. **Given** a component in any lifecycle state, **when** the user opens the detail page, **then** `RETIRED` is still shown if the user reached it by URL or explicit filter.
4. **Given** an unknown component `id`, **when** an authenticated user opens the detail page, **then** the API returns `404`.
5. **Given** an authenticated user without the `component:read` permission, **when** they open the detail page, **then** the API returns `403`.

---

### User Story 3 - Manage component groups (Priority: P2)

As an editor or admin, I want to create and manage `ComponentGroup` records and assign components to them so I can represent logical clusters of assets that belong together (e.g., the same service deployed across three clouds).

**Why this priority**: The environment-as-instance and grouping rules from the constitution require a first-class `ComponentGroup` entity before product hierarchy work in 004.

**Independent Test**: Create a group, assign two components, and verify the catalog can filter by that group and the detail page shows the membership.

**Acceptance Scenarios**:

1. **Given** a user with editor or admin role, **when** they create a `ComponentGroup` with `name`, `slug`, `description`, and `teamOwnerId` (uuid, nullable, references `teams.id`), **then** the API persists it and enforces unique `slug`.
2. **Given** an existing group, **when** an editor/admin assigns one or more components, **then** each component's `componentGroupId` is set to the group and the catalog reflects the change.
3. **Given** a group with members, **when** a user filters the catalog by group, **then** only components in that group are shown.
4. **Given** a user with viewer role, **when** they attempt to create or modify a group, **then** the API returns `403`.

---

### User Story 4 - Add the remaining v1 importers (Priority: P3)

As an admin, I want to configure and run the remaining v1 importers so the catalog can be populated from AWS, Azure, Kubernetes, Web URLs, API endpoints, and MCP servers.

**Why this priority**: Real-world deployments use more than GitHub. The 002 framework makes adding importers mechanical; 003 fills in the catalog's breadth.

**Independent Test**: Configure one of the new importers, trigger a run, and verify the resulting components appear in the catalog with the correct category and provider.

**Acceptance Scenarios**:

1. **Given** the 002 importer framework, **when** the AWS importer is configured and run, **then** it yields `DiscoveredAsset` records with `category` values from the 24-value taxonomy and `provider = AWS`.
2. **Given** the same framework, **when** the Azure, Kubernetes, Web URL, API URL, and MCP importers run, **then** each populates `Component` and `ComponentInstance` rows matching its source.
3. **Given** an importer that cannot classify an asset confidently, **when** it runs, **then** it uses `category = OTHER` or `provider = OTHER` as appropriate per the taxonomy rules.
4. **Given** a component imported by GitHub (002), **when** the same logical component is later imported by another provider, **then** it appears as a separate `Component` (human grouping happens through `ComponentGroup`, not automatic dedup across providers).

### Edge Cases

- What happens when a component has zero instances? The catalog still renders it and the detail page shows an `instances` section with an explicit empty-state message.
- How are `GONE` instances displayed? They are hidden by default and shown only when the user explicitly selects a "include gone" filter.
- What if a component's `slug` collides with an existing one? The system applies the existing suffix-collision rule (`-2`, `-3`) for importer-managed slugs; user-owned slugs (e.g., `ComponentGroup`, `DigitalProduct`) are rejected with a conflict error.
- What if an importer yields a resource that already exists for another provider? Separate `Component` rows are created; the user may later group them under a `ComponentGroup`.
- The milestone implements the six remaining v1 importer packages: AWS, Azure, Kubernetes, Web URL, API URL, and MCP server. GitHub was delivered in `002-importer-framework` and is not repeated here.
- Component-to-component edges (`DEPENDS_ON`, `SOURCES_FROM`, `EXPOSES`) are deferred to v2; `003` importers must not yield them.

## Requirements

### Functional Requirements

- **FR-001**: Authenticated users MUST be able to list `Component` records in the catalog with server-driven pagination (50 items per page by default). The response envelope MUST contain `data` and `pagination: { page, pageSize, total, pageCount, hasNext }`.
- **FR-002**: The catalog MUST support filtering by `category`, `provider`, `lifecycle`, `status` (via instances), and `ComponentGroup`. Multiple values within one dimension are passed as repeated query parameters (e.g. `?category=REPOSITORY&category=API`) and are ORed; values across different dimensions are ANDed.
- **FR-003**: The catalog MUST support a `search` query parameter. One value is matched as a case-insensitive prefix on `name` and `slug` and as a case-insensitive exact match on `externalId`.
- **FR-004**: Default catalog queries MUST exclude `lifecycle = RETIRED` components and `status = GONE` instances unless an explicit filter is applied. Explicit overrides are the boolean query parameters `includeRetired` and `includeGone`.
- **FR-005**: Authenticated users MUST be able to view a `Component` detail page with its metadata and `ComponentInstance` list.
- **FR-006**: Editors and admins MUST be able to create, update, and delete `ComponentGroup` records; viewers MUST only be able to read them.
- **FR-007**: `ComponentGroup` MUST be a first-class entity with `name`, `slug`, `description`, `teamOwnerId` (uuid, nullable, references `teams.id`, representing the group `owner`), and `lifecycle` (`ACTIVE`/`RETIRED`). A `Component` MAY belong to at most one `ComponentGroup` via a `componentGroupId` foreign key. `RETIRED` groups are hidden by default and their components are treated as ungrouped in default views.
- **FR-008**: The AWS, Azure, Kubernetes, Web URL, API URL, and MCP server importers MUST be implemented using the 002 `Importer` contract and `DiscoveredAsset` validation. Each importer must pass `validateDiscoveredAsset` from `@componode/core` on every yielded asset.
- **FR-009**: No importer may access `process.env` or the `SecretResolver`; the framework resolves `secretRefs` before calling `run`.
- **FR-010**: Importers in `003` MUST NOT yield component-to-component edges (`DEPENDS_ON`, `SOURCES_FROM`, `EXPOSES`); those edges are reserved for `v2`. Add a contract test to each importer that asserts no `DEPENDS_ON`, `SOURCES_FROM`, or `EXPOSES` relationships are yielded.

### Key Entities

- **Component**: Existing 002 entity. Extended in the catalog by showing all fields imported and its related instances/group.
- **ComponentInstance**: Existing 002 entity. Operational state per environment; surfaced in the component detail page.
- **ComponentGroup**: New first-class entity to group distinct `Component` records that a human considers the same logical component. Owns `name`, `slug`, `description`, `lifecycle`, `teamOwnerId` (uuid, nullable, references `teams.id`). A `Component` has at most one `componentGroupId`.
- **Importer (new packages)**: In-tree packages for AWS, Azure, Kubernetes, Web URL, API URL, and MCP server, following the 002 contract.

## Success Criteria

- **SC-001**: The initial catalog page loads in under 1 second for 1,000 components.
- **SC-002**: The catalog UI remains responsive when rendering up to 1,000 components in the default view.
- **SC-003**: Each new v1 importer has passing unit and integration tests that exercise its mocked source API, validate yielded `DiscoveredAsset` records, and assert that no importer accesses `process.env` or the `SecretResolver`.
- **SC-004**: All unit and integration test suites pass for `core`, `backend`, all importer packages, and `frontend`.

## Assumptions

- The GitHub importer and 002 generic framework are already complete and operational.
- The component taxonomy with 24 `category` values and the `provider` `OTHER` escape hatch are already in place from 002.
- Product hierarchy (`DigitalProduct`, edges, composition, platform promotion) is out of scope and will be addressed in `005-product-hierarchy`.
- Product-level edges (`COMPOSES`, `CONSUMES_FROM`, `OWNS`, `BELONGS_TO`) are out of scope.
- Component-to-component provenance/dependency edges are a v2 feature; `003` importers must not yield them.
- Importers run in the same Node.js process with in-process scheduling from 002.
