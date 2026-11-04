---
description: "Task list for prototype UX parity polish"
---

# Tasks: Prototype UX parity polish

**Input**: Design documents from `/specs/062-prototype-ux-parity/`
**Prerequisites**: `spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/visual-parity-contract.md`

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- All implementation tasks cite exact file paths.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Prepare the dependency and test seams required by all stories.

- [x] T001 [P] Add failing visual-token assertions for Geist Sans/Mono and the globally available `bg-grid` utility in `packages/frontend/src/test/unit/theme-tokens.test.ts`
- [x] T002 [P] Add failing Product detail tab assertions for a dedicated `map` tab and `?tab=map` resolution in `packages/frontend/src/test/unit/ux-parity.test.tsx`
- [x] T003 [P] Add failing shell assertions for live nav badges and real Help/docs + Notifications header controls in `packages/frontend/src/test/unit/ux-parity.test.tsx`
- [x] T004 Add `@fontsource-variable/geist` and `@fontsource-variable/geist-mono` to `packages/frontend/package.json` and `pnpm-lock.yaml` using `pnpm add`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Make the prototype visual baseline available to every route before story-specific UI work.

- [x] T005 Load the Fontsource CSS and `ux/styles.css` globally from `packages/frontend/src/main.tsx`
- [x] T006 Apply `.ux-root` around the complete routed application in `packages/frontend/src/app.tsx` and remove the now-redundant scoped wrapper/CSS import from `packages/frontend/src/ux/ux-shell.tsx`
- [x] T007 Define `--font-sans`, `--font-mono`, and global body font settings in `packages/frontend/src/index.css`; update `.ux-root` font-family in `packages/frontend/src/ux/styles.css` to use the shared font tokens
- [x] T008 Keep the `bg-grid` utility, tabular figures, density, and reduced-motion rules working for both public auth routes and authenticated shell routes in `packages/frontend/src/ux/styles.css`

**Checkpoint**: Auth and shell routes share the same tokens, font, canvas utility, and state styling.

---

## Phase 3: User Story 1 — Prototype visual identity end to end (Priority: P1) 🎯 MVP

**Goal**: Auth, shell, dashboard, lists, detail pages, and settings use the prototype's Geist/typeface, canvas, headers, pills, and page disposition without introducing fake controls.

**Independent Test**: Open `/login`, `/register`, `/`, `/products`, and a detail page in both themes; verify the shared font, token palette, canvas, header chrome, and badge/pill styling.

- [x] T009 [US1] Verify `AuthShowcase` uses `bg-grid` and inherits the hoisted `.ux-root` visual scope in `packages/frontend/src/ux/components/auth/auth-showcase.tsx`
- [x] T010 [US1] Add a real external Help/docs icon link to `https://componode.github.io/componode/` in `packages/frontend/src/ux/components/app/app-header.tsx`
- [x] T011 [US1] Add a real Notifications icon link to `/settings/notifications` (no unread dot) in `packages/frontend/src/ux/components/app/app-header.tsx`
- [x] T012 [US1] Preserve accessible names, focus-visible treatment, dark/light token behavior, and reduced-motion behavior across the updated global surfaces in `packages/frontend/src/index.css` and `packages/frontend/src/ux/styles.css`

**Checkpoint**: User Story 1 is independently complete when auth and shell surfaces share the prototype identity and all header controls have real behavior.

---

## Phase 4: User Story 2 — Dedicated Product Map tab (Priority: P1)

**Goal**: Product detail exposes a first-class, read-only Map tab while Dependencies retains authoring and list workflows.

**Independent Test**: Open `/products/:slug?tab=map`, switch tabs, and verify the topology renders only on Map while Dependencies retains consumers, suggestions, and edge authoring.

- [x] T013 [US2] Add `map` to the canonical tab list and remove the `map → dependencies` alias in `packages/frontend/src/ux/components/products/product-detail.tsx`
- [x] T014 [US2] Render the `Map` tab trigger and move `<ProductMap product={product} topology={topology} />` into its dedicated `TabsContent value="map"` in `packages/frontend/src/ux/components/products/product-detail.tsx`
- [x] T015 [US2] Remove `ProductMap` from the Dependencies content while preserving `EdgeAuthoring`, consumer list, and suggested-edge actions in `packages/frontend/src/ux/components/products/product-detail.tsx`
- [x] T016 [US2] Update `useValidatedTab` documentation so it no longer describes `?tab=map` as a retired alias in `packages/frontend/src/ux/lib/use-validated-tab.ts`

**Checkpoint**: `?tab=map` lands on a dedicated map surface and dependency authoring remains fully usable.

---

## Phase 5: User Story 3 — Live shell context cues (Priority: P2)

**Goal**: Sidebar pills and header context convey live state rather than prototype fixture values.

**Independent Test**: Mock zero, positive, loading, and role-restricted cue states; verify badges are accurate, hidden when unavailable, and role-gated with their nav items.

- [x] T017 [US3] Add a `badgeKey` field to `NavItem` and mark Suggestions as `pendingSuggestions` and Import agents as `agentsAttention` in `packages/frontend/src/ux/lib/nav.ts`
- [x] T018 [US3] Implement `NavBadge` in `packages/frontend/src/ux/components/app/app-sidebar.tsx`, reading pending suggestion totals from `useSuggestions("PENDING", 0, 1)`
- [x] T019 [US3] Implement `AgentsAttentionBadge` in `packages/frontend/src/ux/components/app/app-sidebar.tsx`, counting `ImportAgent.status` values `OFFLINE` or `NEVER_CONNECTED` from `useAgents()` and rendering only for visible ADMIN nav items
- [x] T020 [US3] Render `SidebarMenuBadge` only for positive, loaded counts in `packages/frontend/src/ux/components/app/app-sidebar.tsx` and `packages/frontend/src/ux/components/ui/sidebar.tsx`

**Checkpoint**: The shell is denser and more informative without any fabricated badge, workspace, notification, or role-preview state.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Governance, documentation, and full-package verification.

- [x] T021 Update `docs/ux.md` typeface, shell context, auth-surface, and Product Map placement language for the new baseline
- [x] T022 Add an ADR-127 amendment restoring the dedicated Map tab and record back-pointers in `researches/adrs/ADR-127-product-map-topology-in-dependencies.md`, `researches/adrs/ADR-103-ux-ui-reference-adoption.md`, and `researches/architecture-decisions.md`
- [x] T023 Update `docs/roadmap.md` to mark `062-prototype-ux-parity` shipped and revise the Next entry
- [x] T024 Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` in `packages/frontend`
- [x] T025 Run the repository root `pnpm build` after frontend verification

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1**: No dependencies; tests are written first and dependency installation prepares assets.
- **Phase 2**: Depends on T004; blocks all story work.
- **Phase 3 (US1)**: Depends on Phase 2.
- **Phase 4 (US2)**: Depends on Phase 2; can run in parallel with Phase 3/5 by different implementers.
- **Phase 5 (US3)**: Depends on Phase 2; can run in parallel with Phase 3/4.
- **Phase 6**: Depends on Phases 3–5.

### User Story Dependencies

- **US1**: Independent after foundational token/font scope is available.
- **US2**: Independent after foundational styling; reuses existing `ProductMap` data/view model.
- **US3**: Independent after foundational styling; reuses existing authenticated API hooks.

### Parallel Opportunities

- T001, T002, and T003 can be written in parallel.
- US1, US2, and US3 implementation can run in parallel after Phase 2.
- T021 and T022 can run in parallel after implementation.
- T024 and T025 are sequential verification tasks.

## Parallel Example

```text
After Phase 2:
- Implement US1 header/auth/global visual parity in app-header.tsx, auth-showcase.tsx, and CSS files.
- Implement US2 dedicated Product Map tab in product-detail.tsx and use-validated-tab.ts.
- Implement US3 live badges in nav.ts and app-sidebar.tsx.
```

## Implementation Strategy

1. Add failing tests and font dependencies.
2. Hoist shared visual scope globally.
3. Complete US1 as the MVP visual baseline.
4. Restore dedicated Product Map discoverability.
5. Add only live, role-gated context cues.
6. Update governance docs and run package/root verification.

## Phase 7: Convergence

- [x] T026 Align the suggestion badge key name in `specs/062-prototype-ux-parity/contracts/visual-parity-contract.md` with `pendingSuggestions` per `FR-008` (partial)

## Phase 8: Review

- [x] T027 Use the shared `ExternalLink` pattern for the Help/docs control so the external anchor validates `safeUrl` and emits `rel="noopener noreferrer"` in `packages/frontend/src/ux/components/app/app-header.tsx` (code-review: standards)
- [x] T028 Update stale Product Map and shell-context documentation in `docs/using-the-catalog.md` and `docs/ux.md`, including the dedicated Map tab, `?tab=` behavior, live nav badge semantics, and real Help/Notifications destinations (code-review: standards)
- [x] T029 Restore `docs/roadmap.md` to its pre-merge state until Stage 8 ships the feature, keeping `specs/062-prototype-ux-parity/spec.md` consistent with the Draft→Shipped convention (code-review: standards)
- [x] T030 Add zero/loading/role-restricted live-badge coverage in `packages/frontend/src/test/unit/ux-parity.test.tsx` (code-review: spec)
- [x] T031 Confirm the Notifications header control has a real destination and document why `/settings/notifications` is acceptable despite its governed G15 preview state, or remove the control if it is not (code-review: spec)
- [x] T032 Prevent the dedicated Map tab from rendering a blank panel when `flags.productMapTopology` is unavailable in `packages/frontend/src/ux/components/products/product-detail.tsx` (code-review: spec)
- [x] T033 Remove the now-unused `aliases` parameter from `packages/frontend/src/ux/lib/use-validated-tab.ts` and its obsolete tests in `packages/frontend/src/test/unit/use-validated-tab.test.tsx` (code-review: standards)
- [x] T034 Make `NavBadge` dispatch exhaustive and share the positive-count badge rendering in `packages/frontend/src/ux/components/app/app-sidebar.tsx` (code-review: standards)
- [x] T035 Make `HeaderIconButton` destinations type-safe and mutually exclusive in `packages/frontend/src/ux/components/app/app-header.tsx` (code-review: standards)
- [x] T036 Remove duplicated global styling now inherited through the app-level `.ux-root` in `packages/frontend/src/index.css`, `packages/frontend/src/ux/styles.css`, and `packages/frontend/src/ux/ux-shell.tsx` (code-review: standards)

## Phase 9: Review

- [x] T037 Update the stale G34 Product Map resolution wording in `researches/ux-rewrite-gaps.md` to point at the dedicated Map tab from ADR-127 Amendment 3 (code-review: standards)
- [x] T038 Remove the now-unused `productMapTopology` feature flag from `packages/frontend/src/ux/lib/flags.ts` and keep its registry semantics consistent (code-review: standards)
- [x] T039 Fix the stale `ProductDetailProps.topology` comment that still says the map renders at the top of Dependencies in `packages/frontend/src/ux/components/products/product-detail.tsx` (code-review: spec)
- [x] T040 Remove the stray blank-line-only diff in `docs/roadmap.md` so the pre-merge file is restored cleanly (code-review: standards)
- [x] T041 Prevent the sidebar agent-attention cue from introducing a new always-on 15-second polling loop while preserving a live bounded read in `packages/frontend/src/api/hooks/agents.ts` and `packages/frontend/src/ux/components/app/app-sidebar.tsx` (code-review: spec)
- [x] T042 Scope Geist-specific font feature settings to `.ux-root` instead of applying them globally to fallback fonts in `packages/frontend/src/index.css` and `packages/frontend/src/ux/styles.css` (code-review: standards)

## Phase 10: Review

- [x] T043 Map suggestion and agent API payloads to count-only nav-cue view models under `packages/frontend/src/api/mappers/` and consume them from `packages/frontend/src/ux/components/app/app-sidebar.tsx` (code-review: standards)
- [x] T044 Move `.ux-root` from the inner React wrapper to a shared scope that covers Radix portals in `packages/frontend/index.html` and `packages/frontend/src/app.tsx` (code-review: standards)
- [x] T045 Document the bundled-Geist typeface and shared auth/shell visual-scope amendment in `researches/adrs/ADR-103-ux-ui-reference-adoption.md` and `researches/architecture-decisions.md` (code-review: standards)
- [x] T046 Update stale Product Map comments and empty-state copy that still references Dependencies placement in `packages/frontend/src/ux/components/products/product-map.tsx` (code-review: spec)
- [x] T047 Add tests for portal-scope application and mapper-backed nav-cue count semantics in `packages/frontend/src/test/unit/ux-parity.test.tsx` (code-review: spec)
