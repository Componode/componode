# Feature Specification: Catalog Authoring — manual creation, edge authoring, suggestion history

**Feature Branch**: `042-catalog-authoring`

**Created**: 2026-10-31

**Status**: Draft

**Input**: Gap-registry entries G29, G31, G32 (`researches/ux-rewrite-gaps.md`) — the three remaining feature-spec gaps of the UX rewrite. Bundled like specs 039/040 bundled related gaps.

- **G29**: "Add manually" on `/ux/components` and "New group" on `/ux/component-groups` are disabled behind `manualEntityCreate`. `POST /component-groups` exists (`componentGroup:create`); `POST /components` does **not** exist — the endpoint plus both creation forms are needed.
- **G31**: `useAddEdge`/`useRemoveEdge` hooks exist (`api/hooks/products.ts`) with zero call sites — no UI adds/removes `composes`/`consumes-from`/`depends-on` edges on a product, and no `409 CYCLE` surface exists.
- **G32**: `/ux/suggestions` shows `PENDING` rows only; ADR-113 terminal states (`ACCEPTED`/`DISMISSED`/`SUPERSEDED`) are unobservable. `useSuggestions` already accepts a `status`/`view` param; the page needs a history view. Flag `suggestionsHistory`.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Manual component & group creation (Priority: P1)

A catalog maintainer needs a component that no importer discovered (a spreadsheet-tracked vendor tool, a manually-managed service). On `/ux/components` they click "Add manually", fill in a form (name, slug auto-derived but editable, component type, optional description, optional team owner), submit, and land on the new component's detail. On `/ux/component-groups`, "New group" offers the same flow for a group (name, description, optional team owner). Duplicate slugs and validation errors surface inline.

**Why this priority**: G29 is the largest missing write capability — the catalog is currently import-only for components; manual authoring unblocks real-world completeness.

**Independent Test**: create a component and a group through the UI; verify they appear in lists/details and persist across reload; verify `POST /components` exists with Zod validation + `component:create` permission + audit event (matching `componentGroup:create` precedent).

**Acceptance Scenarios**:

1. **Given** the components list, **When** the user submits valid form data, **Then** `POST /components` creates the record (uuid v7, unique slug, audit event, `toActor` attribution) and the UI shows the new component.
2. **Given** a name already taken (slug conflict), **When** the form submits, **Then** the API returns a 4xx with a controlled error code and the form surfaces it — never a crash or silent loss.
3. **Given** the component-groups list, **When** the user submits the group form, **Then** the existing `POST /component-groups` is used and the group appears.
4. **Given** a VIEWER session (or whichever role lacks the create permission), **When** either surface renders, **Then** the controls stay hidden/disabled per existing RBAC conventions.
5. **Given** the flags deleted, **When** the surfaces render, **Then** the enabled controls show — `manualEntityCreate` removed from `flags.ts`.

### User Story 2 - Edge authoring on product detail (Priority: P2)

A product owner on `/ux/products/:slug` wants to record that the product composes a platform product, consumes from a platform product, or depends on a component/group. In the product's relations area they pick the edge kind, search/select a target, and add the edge; they can remove an existing edge. Adding an edge that would create a cycle surfaces the `409 CYCLE` error clearly. Attempting `consumes-from` to a non-PLATFORM target is prevented or rejected visibly.

**Why this priority**: G31 — the read-only map shipped in spec 038; authoring was explicitly deferred. This completes the product-model editing surface using already-live endpoints/hooks. P2 because it's a focused workflow on one page, not daily driver for most users.

**Independent Test**: on a product detail, add a `composes` edge to a valid target → edge appears in relations/map; remove it → gone; craft a cycle → `409 CYCLE` shown (no state change).

**Acceptance Scenarios**:

1. **Given** the relations/card area of a product detail, **When** the user adds a `composes` or `consumes-from` edge to a product target or a `depends-on` edge to a component/group target, **Then** the mutation runs via the existing `useAddEdge`/`useRemoveEdge` hooks, the lists/map invalidate and show the change.
2. **Given** the user constructs a `composes` cycle, **When** the API returns `409 CYCLE`, **Then** the error is surfaced in the UI (toast or inline) with the server message.
3. **Given** edge-kind target rules (consumes-from → PLATFORM products only; depends-on → components or component groups per ADR-110), **When** the target picker presents candidates, **Then** the selection respects the kind's allowed target types.
4. **Given** insufficient permissions, **When** the surface renders, **Then** authoring controls follow the existing edge-mutation permission (hidden/disabled for viewers).

### User Story 3 - Suggestions decided-history (Priority: P2)

A reviewer wants to see what was decided: on `/ux/suggestions` they switch between the pending queue and a history view showing `ACCEPTED`, `DISMISSED`, and `SUPERSEDED` suggestions with their decided timestamp and decision summary.

**Why this priority**: G32 — smallest, pure read surfacing on an already-parameterized endpoint.

**Independent Test**: page shows pending queue by default; switching to history lists decided rows; pending-only actions (accept/dismiss) do not appear on history rows.

**Acceptance Scenarios**:

1. **Given** decided suggestions exist, **When** the user opens the history view, **Then** rows show status, decided timestamp (per the existing `useSuggestions` status/view param), and no pending-only actions.
2. **Given** the queue is the default view, **When** the page loads, **Then** `PENDING` rows render exactly as today.
3. **Given** the flag deleted, **When** the page renders, **Then** the history view is always available — `suggestionsHistory` removed from `flags.ts`.

---

### Edge Cases

- Manual component creation with importer-managed fields — the form exposes only the authoring fields the schema accepts; importer-populated fields stay untouched (import reconciliation must not clobber manual rows — existing `import_source`/reconciliation semantics apply unchanged).
- Slug collision on submit → controlled 4xx (`VALIDATION_FAILED`/`CONFLICT`), surfaced inline.
- Edge target pickers with large catalogs — use existing search/select patterns, no new data model.
- 409 CYCLE and any other controlled error code — rendered with the server message, never swallowed.
- History view with zero decided rows → honest empty state.
- `manualEntityCreate`/`suggestionsHistory` flags: removed only when the surfaces actually work (gap governance).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `POST /components` MUST be added: Zod body schema (name, optional slug/type/description/teamOwnerId per the Component contract), `component:create` permission consistent with the per-resource RBAC convention, uuid v7, unique-slug enforcement with controlled 4xx on conflict, audit event with `toActor`, `docs/openapi.yaml` updated in the same change (ADR-104).
- **FR-002**: `/ux/components` "Add manually" and `/ux/component-groups` "New group" MUST open real creation flows (dialog/drawer consistent with existing UX patterns) wired to the endpoints, with inline validation-error display.
- **FR-003**: Product detail MUST offer edge authoring for `composes`, `consumes-from`, `depends-on` via the existing `useAddEdge`/`useRemoveEdge` hooks: kind-appropriate target selection, add + remove actions, permission-gated, and `409 CYCLE` surfaced with the server message.
- **FR-004**: `/ux/suggestions` MUST expose a decided-history view (tab or toggle) for `ACCEPTED`/`DISMISSED`/`SUPERSEDED` using the existing `status`/`view` param; history rows show status + decided timestamp and no pending actions; empty state when none.
- **FR-005**: `manualEntityCreate` and `suggestionsHistory` MUST be removed from `ux/lib/flags.ts` when their surfaces work (resolved-flag precedent).
- **FR-006**: G29/G31/G32 MUST be marked RESOLVED by spec 042 in `researches/ux-rewrite-gaps.md`; `docs/roadmap.md` records 042 under Shipped.
- **FR-007**: Any enumerated contract surface touched (new endpoint, new permission name if `component:create` is absent, new error code) MUST be ratified per ADR fidelity (Amendment or new ADR + back-pointers).

### Key Entities

- **Component** — create payload subset of the contract (name, slug, type, description?, teamOwnerId?, lifecycle defaults `ACTIVE`).
- **ComponentGroup** — `POST /component-groups` exists; only the form is new.
- **Product edges** — `composes` (product→product DAG), `consumes-from` (product→PLATFORM product), `depends-on` (product→component | component group); `409 CYCLE` on cycle.
- **EdgeSuggestion** — decided rows already persisted; status param already supported by `useSuggestions`.

## Success Criteria *(mandatory)*

- **SC-001**: A user can create a component and a group entirely in the UI; both persist, appear in lists, and produce audit events.
- **SC-002**: A user can add and remove each edge kind on product detail; cycles are blocked server-side and the `409 CYCLE` message is shown.
- **SC-003**: The suggestions page renders the decided history without changing pending-queue behavior.
- **SC-004**: `manualEntityCreate` + `suggestionsHistory` are gone with zero consumers; G29/G31/G32 resolved; lint/typecheck/tests/build green.

## Assumptions

- The edge-authoring affordance lives in the product detail's relations surfaces (not canvas authoring — the spec-038 map stays read-only; canvas authoring is a separate future spec).
- `POST /components` follows the `componentGroup:create` precedent for schema/permission/audit shape.
- `useAddEdge`/`useRemoveEdge` bodies already match the backend contract (verified at plan; hooks were scaffolded spec-038).
- History uses a tab/toggle on the existing page, not a new route.
- Default list filters still exclude RETIRED/GONE — new creation defaults lifecycle `ACTIVE`.
