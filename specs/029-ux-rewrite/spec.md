# Feature Specification: Frontend UX Rewrite (v0 Design Baseline)

**Feature Branch**: `029-ux-rewrite`

**Created**: 2026-10-23

**Status**: Draft

**Input**: User description: "Rewrite `packages/frontend` so the Componode dashboard matches the v0 design prototype (github.com/Componode/v0-componode-dpam). The prototype is the source of truth for layout, copy, states, and interaction; the Componode backend is the source of truth for data and rules. Stage the new UX alongside the existing UI until it is functional; on approval, documented, mapped, and a UX/UI baseline is established, it merges to main as version 1.1.0. Follow the prototype's own rewrite instructions (`docs/ux-rewrite-instructions.md`), data-model diff (`docs/ux-data-model.md`), and per-route wiring contract (`lib/wiring.ts`)."

## Clarifications

### Session 2026-10-23

- Q: When a prototype surface needs an API endpoint that doesn't exist yet, how should this feature handle it? → A: Do not build backend endpoints in this feature. Annotate each detailed gap in a control file under `researches/` specific to this job; when the UX work is 100% finished, those gaps are the next step of the 1.1.0 roadmap — grill them and create their own implementation specs. Keep this gap-governance rule clear in the repository's controls and development guides.
- Q: When release/1.1.0 merges to main and the new UX becomes default, what happens to the old UI code? → A: Remove the old UI in this feature once every in-scope route passes — the release branch merge is the cutover and no runtime fallback is kept.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Navigate and read the catalog in the new UX (Priority: P1)

An operator signs in and uses the redesigned shell — sidebar navigation, theming, and global layout — to browse the dashboard, product list/detail, component list/detail, and component-group list/detail. Every page renders the prototype's layout and copy while serving live API data, and every page handles loading, empty, error, not-found, and forbidden states.

**Why this priority**: These read paths are the daily surface of the product; they prove the design port and the fixture-to-API wiring pattern that every later route repeats.

**Independent Test**: Sign in on a seeded deployment, opt into the new UX, and walk dashboard → products → product detail → component detail → component-group detail, plus an unknown id (404), an empty tenant view, and a role-restricted page (403).

**Acceptance Scenarios**:

1. **Given** a signed-in user on the new UX, **When** they open a product detail page, **Then** they see the prototype layout populated from `GET /products/:slug` with no fixture data involved.
2. **Given** a detail page, **When** the user navigates to `?tab=<unknown>`, **Then** the first tab is shown instead of an error or blank pane.
3. **Given** a request that returns 404 or 403, **When** the page renders, **Then** the matching not-found or forbidden state is shown per the prototype.

---

### User Story 2 - Author and manage products end-to-end (Priority: P2)

A curator creates a product (`/products/new`), edits it, bulk-imports products (`/products/import`), promotes a component to a platform product (`/components/[slug]/promote`), and inspects per-entity history (`/products/[slug]/history`, `/components/[slug]/history`). Forms keep the prototype's field order, helper text, validation messages, and sticky save bar; destructive actions keep type-to-confirm and server-reported blocked reasons.

**Why this priority**: These are meaningful new authoring capabilities the current UI lacks; they exercise forms, mutations, validation, and 409-conflict handling.

**Independent Test**: Create a product, edit its metadata, run a bulk import with a deliberately bad row (see the API's per-row error), promote a component to platform, and open the history page for both.

**Acceptance Scenarios**:

1. **Given** the new-product form, **When** the user submits valid input, **Then** a `POST /products` call succeeds, the read query invalidates, and a success toast confirms.
2. **Given** a promote form for a component with dependents, **When** the user selects consumers and confirms, **Then** the API creates the platform product and `CONSUMES_FROM` edges, and failures display the API error message.
3. **Given** a delete action blocked by dependents, **When** the API returns 409, **Then** the dialog shows the "blocked because…" reason from the server.

---

### User Story 3 - Operate importers, runs, agents, and suggestions (Priority: P3)

An operator manages importer configs (list, detail, `/importers/new`, `/importers/[id]/edit`), inspects run detail including errors and phases (`/importers/[id]/runs/[runId]`), reviews the suggestions queue, and administers import agents (detail with policy, sessions, activity tabs; enroll/rotate/revoke flows). Scope fields on importer forms are rendered from the importer manifest's config schema; credential linking is by id; agent-bound configs honor execution binding and incompatibility flags.

**Why this priority**: Import operations are the product's headline value; the prototype adds run detail and agent operations surfaces that don't exist in the current UI.

**Independent Test**: Create an importer config bound to an agent, trigger a run, open run detail to watch phases/errors, cancel an active run, and rotate an agent's enrollment token (token displayed once).

**Acceptance Scenarios**:

1. **Given** the importer form, **When** the user picks an importer type, **Then** scope fields render from that importer's `configSchema`, not a hardcoded list.
2. **Given** an active remote run, **When** the user cancels, **Then** the UI sends the cancel call, reflects the cancelling state, and resolves on `run.complete{result:"CANCELLED"}`.
3. **Given** the agent detail page, **When** the user rotates the token, **Then** the new enrollment token is shown once in the dialog and never stored or re-rendered afterward.

---

### User Story 4 - Administer users, sessions, credentials, and org structure (Priority: P4)

An admin manages user detail (role, activation, sessions, activity), credential detail and creation (masked key hints only; `AGENT_MANAGED` sends references, never values), team and LOB detail pages, the global sessions list, activity/audit views, and the settings section. The OIDC callback screen replaces the current stub. Role changes, deactivation, deletes, and revokes are advisory in the UI and enforced by the API (403/409).

**Why this priority**: Admin surfaces are lower-traffic but complete the coverage; several (teams/LOBs detail, run-change feed, password reset) depend on documented backend gaps and degrade gracefully behind flags.

**Independent Test**: Change another user's role (succeeds), try changing your own role (API 403 surfaced in UI), revoke a session, create an `AGENT_MANAGED` credential (reference names only leave the browser), and open team/LOB detail pages.

**Acceptance Scenarios**:

1. **Given** an admin editing their own role, **When** they save, **Then** the API rejects with 403 and the UI displays that message.
2. **Given** a credential detail page, **When** key hints render, **Then** only masked strings from the API are shown — never secret material.
3. **Given** a team or LOB slug route, **When** only list endpoints exist, **Then** the page resolves the entity via the filtered-list strategy or is flagged as a documented gap.

---

### User Story 5 - Establish the documented UX/UI baseline (Priority: P5)

The ported design tokens, shared patterns (`PageHeader`, `DangerZone`, `ConfirmDialog`, `EntityHistory`, `ActivityFeed`, `ProviderMark`, form shell, list editors), status metadata, and the standards surfaces are ported as the project's canonical UX/UI baseline, so subsequent frontend work reuses rather than re-implements them.

**Why this priority**: The baseline is what makes 1.1.0 a foundation, not a one-off restyle; it lands naturally as the last slice because it stabilizes through the preceding stories.

**Independent Test**: Every ported page consumes shared tokens/patterns — a search shows no per-page hardcoded colors, status labels, or re-implemented confirm dialogs.

**Acceptance Scenarios**:

1. **Given** any new page, **When** it shows a destructive action, **Then** it uses the shared `DangerZone`/`ConfirmDialog` with type-to-confirm.
2. **Given** any status badge in the app, **When** it renders, **Then** its label and color come from shared status metadata.

---

### Edge Cases

- Nullable API fields (`displayName`, `email`, `startedAt`, `lastSeenAt`, agent `reportedStatus`) render defined fallbacks; the UI never crashes on null.
- A `PENDING` run has no `startedAt`; `durationSec` is derived only after completion; `cancelRequestedAt` drives a distinct "cancelling" state.
- Unknown enum values from the API (status, role, audit action) fall back to a neutral badge rather than throwing.
- Entities deleted between list and detail navigation render the not-found state.
- Elements with no API backing (run history aggregates, session device/location, run change feed, expired-credential state) are hidden behind feature flags and tracked in the documented gap list — never populated with invented data.
- OIDC callback renders error states from `?error=` without a backend round trip.
- Users and credentials use `id` params while products/components/groups/teams/lobs use `slug`; resolution happens in the read layer.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The new UX MUST be staged alongside the existing UI: the existing UI remains the default until explicit cutover, and the new UX is reachable during development via an opt-in mechanism (flag, route prefix, or equivalent chosen at planning time).
- **FR-002**: At cutover (merge of `release/1.1.0` to `main` for v1.1.0), the new UX MUST be the sole experience — the old UI code is removed in this feature once every in-scope route passes; no runtime fallback ships in 1.1.0.
- **FR-003**: Every page MUST render loading, empty, error, not-found, and forbidden states matching the prototype's states (adding loading and error where the prototype omits them).
- **FR-004**: `?tab=` MUST remain the source of truth for active tab, validated against the known tab list; unknown values fall back to the first tab.
- **FR-005**: No fixture or mock data may remain in any route marked complete; all data MUST come from the real API.
- **FR-006**: API responses MUST be mapped to per-entity view models in dedicated mapper functions before reaching components; ids, tokens, session internals, and other non-display fields MUST NOT reach the browser surface.
- **FR-007**: Every mutation MUST call the real API, invalidate the corresponding read query, keep the success toast, and display the API error message on failure.
- **FR-008**: UI guards (self role-change lock, self-deactivation, last-admin removal, blocked deletes) are advisory only; the API MUST enforce them via 403/409 and the UI MUST surface the returned reason.
- **FR-009**: Destructive actions MUST keep type-to-confirm and display the server-provided "blocked because…" reason on 409.
- **FR-010**: Secret values MUST never be displayed. Credential key hints are masked API strings; `AGENT_MANAGED` credentials send reference names only; enrollment tokens are displayed once in the issuing dialog and not persisted in UI state.
- **FR-011**: Pages MUST consume the ported design tokens and shared status metadata; hardcoded colors or status labels per page are prohibited.
- **FR-012**: Shared patterns MUST be reused as defined by the prototype: `PageHeader`, `DangerZone`, `ConfirmDialog`, `EntityHistory`, `ActivityFeed`, `ProviderMark`, the form shell, and list editors — no per-page re-implementations.
- **FR-013**: Icon-only buttons MUST have accessible names; existing focus order and keyboard behavior MUST be preserved.
- **FR-014**: The following routes MUST exist and be wired: `/products/new`, `/products/[slug]/edit`, `/products/import`, `/products/[slug]/history`, `/components/[slug]/history`, `/components/[slug]/promote`, `/importers/new`, `/importers/[id]/edit`, `/importers/[id]/runs/[runId]`, `/credentials/new`, `/users/[id]`, `/credentials/[id]`, `/teams/[slug]`, `/lobs/[slug]`, `/component-groups/[slug]`, `/agents/[id]`, `/auth/oidc/callback`, plus the prototype's list/settings/standards surfaces.
- **FR-015**: Importer scope fields MUST be rendered from `ImporterManifest.configSchema`, not hardcoded per provider; credential linking MUST use `credentialIds` (not deprecated `secretRefs`); execution binding (in-process vs agent) MUST honor `agentId`/`agentIncompatible`.
- **FR-016**: Features with no API backing MUST be hidden behind feature flags; the UI MUST NOT invent data. Every such gap MUST be annotated in detail in a dedicated control file under `researches/` for this feature (`researches/ux-rewrite-gaps.md` or equivalent), covering what the UX needs, the endpoint or data missing, and the affected routes — this file is the input for the next 1.1.0 roadmap step, where each gap is grilled and promoted to its own spec.
- **FR-016a**: The repository's controls and development guides MUST record this gap-governance rule explicitly: UX gaps discovered during the rewrite are catalogued in the `researches/` control file and become sequenced specs after the UX is complete — they are never silently deferred or implemented ad hoc inside this feature.
- **FR-017**: Route params stay as in the prototype; slug→id resolution MUST occur inside read hooks/mappers, not components.
- **FR-018**: Remote run cancellation, queued-run handling, and agent session states MUST reflect the spec-027/028 semantics (e.g., `AGENT_LOST`, `AGENT_UNAVAILABLE`, superseded sessions) using the status metadata.
- **FR-019**: Every mapper MUST have unit tests; every completed route MUST pass the existing frontend test suite and typecheck.
- **FR-020**: The design tokens, pattern catalog, and state conventions MUST be captured as the project's documented UX/UI baseline (standards surface and/or docs) before the feature is considered complete.

### Key Entities *(include if feature involves data)*

- **View models (new)**: Per-entity UI shapes defined by the prototype (`lib/mock-data.ts` types) — `Product`, `Component`, `ComponentInstance`, `ComponentGroup`, `ImporterConfig`, `ImportRun`, `RunError`, `RunChange`, `User`, `Session`, `Credential`, `ImportAgent`, `AgentSession`, `AuditEvent`, `Suggestion` — produced by mappers from API responses.
- **Domain entities (existing, unchanged)**: All Componode entities above plus `DigitalProduct` graph edges; no schema or contract changes are introduced by this feature.
- **Feature flags / gap list**: A documented registry of UI elements hidden pending backend support.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of in-scope routes serve live API data — zero imports from fixture data remain in the shipped route set.
- **SC-002**: 100% of in-scope routes render all five states (loading, empty, error, not-found, forbidden where role-restricted); every invalid `?tab=` value falls back to the first tab.
- **SC-003**: Zero secret values, raw tokens, or session internals are rendered anywhere in the UI; enrollment tokens appear exactly once per issuance.
- **SC-004**: Frontend typecheck and test suite pass, including a unit test per mapper and coverage of each completed route's state matrix.
- **SC-005**: A user can complete the core journeys — browse catalog, create/edit/import products, promote a component, configure and run an importer, inspect a run, manage credentials, administer an agent — entirely within the new UX without falling back to the old UI.
- **SC-006**: Switching between old and new UX during the staged period requires no redeploy (runtime opt-in), and the final cutover is a single controlled change.

## Assumptions

- The v0 prototype repository (`github.com/Componode/v0-componode-dpam`, reference commit `916f9a7` / merge `9b040bc`) is the UX source of truth; `docs/ux-rewrite-instructions.md`, `docs/ux-data-model.md`, and `lib/wiring.ts` in that repo are this feature's working contracts.
- The existing frontend stack is retained: Vite + React + TanStack Query + React Router + Tailwind + shadcn/ui. The prototype's Next.js App Router structure is a reference, not the target stack — pages are ported to React Router routes.
- Backend contract changes are out of scope for this feature. The documented gaps (per-day run aggregates, session device/location/owner, run change feed, password reset endpoint, expired-credential state, `credentialId` filter on `GET /importers`, team/LOB detail endpoints) are hidden behind flags and annotated in the `researches/` control file; after the UX is complete they are grilled and promoted to their own specs as the next 1.1.0 roadmap step.
- Existing auth (local sessions + OIDC) carries over; the OIDC callback page replaces the stub but the backend callback contract is unchanged.
- E2E test coverage remains deferred per ADR-029; route verification uses the existing test stack plus mapper unit tests.
- The feature branch targets `release/1.1.0` as its merge base; the release branch aggregates this and any sibling UX specs before the main merge.
