# Feature Specification: UX Conformance — v1.1.0 Review Corrections

**Feature Branch**: `038-ux-11-conformance`

**Created**: 2026-10-30

**Status**: Draft

**Input**: User description: "Correct the UX non-conformities found by the 1.1.0-vs-v0 conformance review. The review compared `packages/frontend/src/ux` (plus `src/pages` auth pages) against the `v0-componode-dpam` design prototype, `docs/ux.md` (ratified baseline), spec-029 FRs, and the `flags.ts`/`ux-rewrite-gaps.md` gap registry. A grilling session ratified every disposition: defects get regression-tested fixes, silently-vanished prototype elements get restored or gap-registered, fakes get deleted, and the shipped product-map canvas is ratified via an ADR amendment instead of removed."

**Decision record**: All dispositions were settled in a review/grilling session on 2026-10-30 (see `researches/` review notes below). This spec encodes that record; no open design questions remain except where flagged for plan-time verification.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Correct functional defects in the shipped UX (Priority: P1)

An operator clicks a dashboard attention row and lands on the real component (not "Component not found"); sees per-row health and last-seen data where the API supplies it (or nothing, via a flag — never a permanently dead column); can revoke another user's session via a working "Send password reset" menu item; sees a labeled badge for every agent disconnect reason; is blocked from deleting a LOB that still owns teams; and browses component lists where GONE and RETIRED records are reachable through explicit opt-in, with copy that describes what the API actually does.

**Why this priority**: These are broken or misleading surfaces shipping today — dead links, dead controls, invisible data, copy that lies. Everything else in this spec is conformance polish on top of a working product; this story is what makes it working.

**Independent Test**: Walk dashboard attention links, users-table row menu, agent detail sessions tab, LOB detail delete, components list with `includeGone`, and component-groups list with retired opt-in — every control acts or is explicitly hidden behind a flag.

**Acceptance Scenarios**:

1. **Given** a dashboard attention row referencing a component, **When** the user clicks it, **Then** the component detail page loads (backend emits slug-keyed hrefs, or the link resolves by whichever key the route accepts).
2. **Given** the users table row menu, **When** "Send password reset" is clicked, **Then** `useResetPassword` fires and the reset token surfaces once in a toast for admin copy-out.
3. **Given** an agent session ended with reason `replaced`, **When** the sessions tab renders, **Then** a labeled badge appears (no empty badge).
4. **Given** a LOB owning teams but zero products, **When** delete is attempted, **Then** the blocked-reason names the teams; the guard is advisory and the API's 409 is surfaced.
5. **Given** the components list, **When** the user opts into GONE instances / the groups list opts into RETIRED groups, **Then** the existing backend filter params are sent and the rows appear with correct badges.
6. **Given** the importer detail page, **When** the "convert secrets" affordance is used, **Then** the existing `useConvertSecrets` hook runs (the control exists and is wired).
7. **Given** a 403 on lobs/component-groups/users detail, **When** the page renders, **Then** `ForbiddenState` appears instead of a generic error (FR-003 parity with products/agents/importers).

---

### User Story 2 - Restore prototype conformance where it was silently lost (Priority: P2)

An admin sees the credentials list's "write-only by design" explainer; a registering user gets the live password-rules checklist and the "starts as Viewer" notice; the OIDC callback renders inside the two-column `AuthShowcase` shell; the app header breadcrumb resolves entity names and never passes through the `/ux/*` staging redirect; org detail tables use the prototype's column sets; settings security lists device + location (flags are ON); the workspace default-role select cannot mint admins; and the activity feed reads human sentences instead of raw change keys.

**Why this priority**: These restore design/copy/layout that was dropped without a documented decision. Each is small and independent; together they close the conformance gap the review measured.

**Independent Test**: Open each affected page and diff it against the v0 prototype element-by-element — every restored element renders, and nothing restored requires a backend capability that doesn't exist.

**Acceptance Scenarios**:

1. **Given** `/register`, **When** the page renders, **Then** the password-rules checklist (live ✓/✗) and the "New accounts start as Viewer" alert are present; the work-email field is NOT present (no backend field — gap-registered, not faked).
2. **Given** the OIDC callback, **When** it renders success or `?error=` states, **Then** it sits inside the `AuthShowcase` two-column shell like login/register.
3. **Given** the credentials list, **When** it renders, **Then** the "Write-only by design" ShieldCheck alert is present.
4. **Given** settings → workspace, **When** the default-role select renders, **Then** only Viewer and Editor are offered (Admin removed — self-registration must not default to admin).
5. **Given** settings → security, **When** the sessions list renders, **Then** device and location columns show (flags `sessionDevice`/`sessionLocation` are ON).
6. **Given** any header breadcrumb beyond the section root, **When** it renders, **Then** entity segments show resolved names and all crumb hrefs use the `ux()` helper (no `/ux/` prefix, no hand-built paths).
7. **Given** the activity feed, **When** an audit event with field changes renders, **Then** the summary is a human sentence, not `Object.keys(changes)` output.

---

### User Story 3 - Ratify the product map and make it consume real graph data (Priority: P2)

A product owner opens the Map tab and sees the shipped SVG canvas — now displaying the relations the API actually returns (`composes`, `consumesFrom`, `dependsOnGroups`, `composedBy`), with real consumer criticality feeding the previously dead `CriticalityBadge`. The canvas's existence is ratified by an ADR amendment to the ADR-103/`docs/ux.md` §8 boundary rather than shipped in violation of it.

**Why this priority**: The canvas is the single largest spec-vs-implementation divergence in the review. The grilling decision was to keep it — but "keep" is only honest if the doc boundary is amended (ADR fidelity rule) and the graph data already on the wire is displayed.

**Independent Test**: Open a product with COMPOSES parents/children, CONSUMES_FROM consumers, and DEPENDS_ON groups; verify all relation kinds are visible on the canvas and consumer rows show real criticality values; verify the new ADR exists, amends ADR-103, and `docs/ux.md` §8 is updated with a back-pointer.

**Acceptance Scenarios**:

1. **Given** a product detail with `composedBy`/`composes`/`consumesFrom`/`dependsOnGroups` data, **When** the Map tab renders, **Then** all four relation kinds are represented (labeled edges or a relations legend) and no fetched relation is silently dropped.
2. **Given** consumers with `criticality` values, **When** the map or Consumed-by card renders, **Then** `CriticalityBadge` shows the real value (never a permanently null badge).
3. **Given** the merged change, **When** `researches/architecture-decisions.md` is checked, **Then** the new ADR is indexed, ADR-103 carries an `Amended by` back-pointer, and `docs/ux.md` §8 reflects the ratified canvas.

---

### User Story 4 - Close the governance holes (Priority: P3)

A maintainer audits `flags.ts` and `researches/ux-rewrite-gaps.md` and finds: every UI element that can't be backed by the API is behind a flag with a registry entry; every flag is consumed; no fake interactions exist; every deferred capability has a registered gap entry pointing at a follow-on spec; and `docs/ux.md` §9 records the intentional descopes (standards surfaces, Provider scaffold).

**Why this priority**: AGENTS.md gap governance is the control that keeps this exact class of drift from recurring. Lowest urgency — it's bookkeeping — but it is the deliverable that feeds the next roadmap batch.

**Independent Test**: Grep `flags.` usage (every key consumed), read `researches/ux-rewrite-gaps.md` (every flagged surface has an entry and vice versa), and click every formerly-dead control (deleted or wired — nothing inert).

**Acceptance Scenarios**:

1. **Given** `flags.ts`, **When** the tree is searched, **Then** every flag key has ≥1 consumption site and every consumption maps to a registry entry; `profileSelfEdit` is removed.
2. **Given** the app header, **When** it renders, **Then** no Help/Notifications buttons or unread dot exist (deleted, not flagged — no capability is coming in 1.1.x).
3. **Given** "Add manually" / "New group" disabled buttons, **When** they render, **Then** each is gated by a flag whose registry entry describes the missing capability and resolution plan.
4. **Given** the six dead-data elements (component-list health/last-seen, team members, stat deltas, attention detail, agent enrolled-by), **When** they render with no API backing, **Then** each is flag-hidden per its registry entry — nothing displays permanently-dead output.
5. **Given** `docs/ux.md` §9, **When** read, **Then** the deferred in-app standards surface, descoped credential Provider scaffold, and other intentional omissions are listed as decisions.

---

### Edge Cases

- Unknown API enums (run status, credential status, product type, provider) MUST fall back to a neutral badge — never a destructive/success tone by accident, never a throw (`ProductTypeBadge`/`ProviderMark` get lookup guards).
- Sidebar persistence moves to `sessionStorage` per `docs/ux.md` (per-tab intent); the dead `sidebar_state` cookie write in `ui/sidebar.tsx` is removed.
- Promote-form `409 SLUG_TAKEN` maps to a field-level error under the Slug input (prototype behavior), not only a toast.
- `PENDING_ENROLLMENT` agent reissue flows through `rotateAgent` — plan-time verification that the backend accepts rotation on that status.
- Sessions page "User" column on a self-scoped list: conform copy/columns to the prototype rather than rendering a redundant self-only column.
- `?incomplete` filter on products index stays but is documented as an added param (validated against known values).
- Importer-card `lastRun`: if `DashboardSummary.lastRuns` or a runs-list read supplies it cheaply, wire it; otherwise it joins gap G21 (list enrichment) — decision recorded at plan time.
- `agentIncompatible` shows a degraded state on the importer-detail Executor row, not only inside the edit form.

## Requirements *(mandatory)*

### Functional Requirements

**Defect fixes (each with a regression test)**

- **FR-001**: Attention/health rows MUST link to components by the key the route accepts (slug); backend-emitted hrefs use slugs, or the frontend resolves ids. No dead links.
- **FR-002**: "Send password reset" in the users-table row menu MUST call `useResetPassword` and surface the token once in a toast.
- **FR-003**: `DISCONNECT_REASON_META` MUST cover every core `AGENT_DISCONNECT_REASONS` member (including `replaced`); unmapped reasons fall back to a neutral badge, never an empty badge.
- **FR-004**: The LOB delete guard MUST count owned teams AND owned products when computing the blocked reason (advisory; API 409 remains authoritative).
- **FR-005**: The components list MUST expose the existing `includeGone` backend param and the component-groups list the existing `lifecycle` param via opt-in UI consistent with the retired-toggle pattern.
- **FR-006**: Breadcrumbs MUST use the `ux()` helper, drop the `/ux` segment handling, and resolve entity segments to display names.
- **FR-007**: The "convert secrets" affordance on importer detail MUST invoke the existing `useConvertSecrets` hook.
- **FR-008**: Promote MUST map `409 SLUG_TAKEN` to a field-level error under the Slug input.
- **FR-009**: Activity/audit feed summaries MUST render human sentences for known actions with a generic fallback — never raw change-key joins.
- **FR-010**: The catch-all 404 MUST use the prototype copy; the root `ErrorBoundary` MUST render the shared `ErrorState` pattern and MUST NOT echo raw `error.message`.
- **FR-011**: Lobs/component-groups/users detail pages MUST render `ForbiddenState` on 403.
- **FR-012**: Sidebar collapse state MUST persist via `sessionStorage` (per `docs/ux.md`); the dead `sidebar_state` cookie write MUST be removed.
- **FR-013**: Enum mapper fallbacks MUST produce a neutral badge for unknown values (run status, credential status); `ProductTypeBadge`/`ProviderMark` MUST NOT throw on out-of-union input.
- **FR-014**: Settings → security sessions list MUST render device and location (flags ON).
- **FR-015**: Org owned-entity tables (team components, LOB products, LOB teams) MUST conform to the prototype's column sets; group member tables MUST use `CATEGORY_LABELS`.
- **FR-016**: The workspace default-role select MUST offer Viewer and Editor only.
- **FR-017**: `KIND_META` MUST move to `ux/lib/domain.ts`; `product-map`'s status→color map MUST consume `HEALTH_META` instead of a local `DOT` table.
- **FR-018**: Command-menu results MUST restore the prototype's adornments (ProviderMark + mono on components, team-owner suffix on products).
- **FR-019**: The `agentIncompatible` state MUST surface on the importer-detail Executor row, not only inside the edit form.

**Deletions**

- **FR-020**: The header MUST NOT render Help/Notifications buttons or any unread-dot indicator (deleted, not flagged).
- **FR-021**: `flags.profileSelfEdit` MUST be removed (resolved gap, zero consumers).

**Gap registry + flags**

- **FR-022**: Every UI element lacking API backing MUST be behind a `flags.ts` flag with a `researches/ux-rewrite-gaps.md` entry covering flagged surface, missing capability, and resolution plan. New entries: component-list enrichment (instances/last-seen, folding in importer `lastRun` if unwired), team member counts, stat deltas, attention `detail` + `CREDENTIAL_EXPIRING`, agent enrolled-by, detail-level `includeGone`, auth hardening (allowed domains/password-policy/email-on-register), LOB owner, manual component/group creation, keep-signed-in, edge-authoring UI, suggestions decided-history.
- **FR-023**: Backend gap specs are grouped and queued: **list enrichment** (component list instances+lastSeen, team members, importer lastRun) and **dashboard intelligence** (deltas, attention detail, credential-expiring kind, enrolled-by) — entered in the registry spec queue after 037.
- **FR-024**: Flagged surfaces that would otherwise render dead output MUST be flag-hidden (stat deltas, attention detail, health/last-seen/members columns); the workspace page's `workspaceProfile` flag MUST render a gap notice like the other flagged settings pages, not an empty section.

**Product map ratification**

- **FR-025**: The product map MUST display `composedBy`/`composes`/`consumesFrom`/`dependsOnGroups` relations fetched on the detail read (labeled edge types or legend), and consumer `criticality` MUST reach `CriticalityBadge`.
- **FR-026**: A new ADR MUST ratify the in-app graph canvas (amending the ADR-103/`docs/ux.md` §8 boundary), with `Amended by` back-pointers on ADR-103 and `ux.md` §8, and an entry in `researches/architecture-decisions.md`.

**Restorations**

- **FR-027**: Register MUST restore the live password-rules checklist and the "starts as Viewer" alert; login/register/OIDC auth pages MUST show the versioned footer; the OIDC callback MUST render inside `AuthShowcase`. The work-email field is NOT restored (no backend field — gap-registered under auth hardening).
- **FR-028**: The credentials list MUST restore the "Write-only by design" explainer alert.
- **FR-029**: `styles.css`/`index.css` MUST define the full `--radius-sm…4xl` scale matching the prototype derivation.

**Held as intentional** (recorded in `ux.md`/Assumptions — no code change): open nav per `ux.md` route map; no undo on suggestion decisions; immutable slugs; Active-only lifecycle on create; cross-LOB team selection; free-form credential keys; create-user-with-temp-password model; promote→product navigation; "Self-hosted" tagline; `/ux/*` redirect shim; computed greeting; promote slug field error is the only field-error restoration.

**Docs**

- **FR-030**: `docs/ux.md` MUST be amended: §2 records the ratified system-font stack, §8 the ratified canvas (with ADR back-pointer), §9 the deferred standards surface + descoped Provider scaffold + pending decided-history view.
- **FR-031**: `docs/roadmap.md` MUST be updated at ship: feature marked complete under Shipped, Next entry revised (the queued gap specs).

### Key Entities

- **Gap registry entries (new, G21–G32)**: governed deferral records in `researches/ux-rewrite-gaps.md` — flagged surface, missing backend capability, resolution plan, spec-queue position.
- **Flags (new/removed)**: `flags.ts` keys for each flagged surface; `profileSelfEdit` removed.
- **No schema or contract changes** except defect-level href keys (FR-001) — slugs already exist on component payloads.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Zero dead controls — every rendered button/menu/link either performs an action, navigates to a resolving route, or is flag-hidden with a registry entry. Verified by clicking every interactive element on the affected pages.
- **SC-002**: Zero permanently-dead data displays — every column, badge, sub-line, and delta either renders API-backed data or is flag-hidden; a source audit finds no hardcoded-null view fields rendered to users.
- **SC-003**: 100% of enum-bearing badges render a labeled neutral fallback for out-of-union input; no component throws.
- **SC-004**: Every defect fix ships with a regression test; frontend typecheck + test suite + lint pass.
- **SC-005**: `docs/ux.md`, the new canvas ADR, and `researches/architecture-decisions.md` contain no unresolved contradiction about the canvas, fonts, or deferred surfaces — every intentional omission is written down as a decision.
- **SC-006**: The gap registry covers all twelve deferred capabilities with spec-queue positions; `flags.ts` has zero unconsumed keys.

## Assumptions

- All dispositions were ratified in the 2026-10-30 grilling session; this spec encodes that record verbatim — it is not a re-open for debate.
- `037` is reserved for the G13 schema-driven-importer-forms spec (per the registry queue); this feature is `038`.
- The product-map canvas stays read-only; edge authoring (G31) is a separate spec.
- Backend work inside this feature is limited to defect-level fixes (attention href slugs) — no new endpoints; missing data is flagged, not built.
- The v0 prototype remains the source of truth for layout/copy/states/interaction; `docs/ux.md` wins where they conflict (ratified baseline).
