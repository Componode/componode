# Research: BOM Catalog Promotion (Phase 2)

**Date**: 2026-11-21 | **Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

Phase-0 consolidation. Every product decision was settled in the research grill (`researches/sbom_research.md`, 2026-11-20) and restated normatively in spec.md § Clarifications — this document maps those decisions onto the existing code anchors and resolves the remaining *mechanism* choices. No NEEDS CLARIFICATION items remain.

## D1 — Matching pass placement and trigger

- **Decision**: a new `runBomMatchPass({ componentIds: [...yieldedComponentIds] })` invoked inside the completed-run path of `import-run-service.ts` (and `remote-run-service.ts` for agent-mediated runs, after verifying its parity block), immediately after the existing `runSuggestionPass` call — wrapped in the same failure-isolated pattern (try/catch → metric + log, never thrown into the run). Runs ending `FAILED`/`CANCELLED`/`INTERRUPTED` never reach it because the call sites sit below the terminal `COMPLETED` write.
- **Rationale**: matches research ("triggered at run completion alongside `runSuggestionPass` and `runAutoGroupPass`") and the codebase's established pass-trigger convention (`import-run-service.ts` ~line 1370; remote path has its own completion block that also calls `runSuggestionPass`).
- **Alternatives**: inline in `processBomEntries` per-asset — rejected: per-asset staging would thrash the queue mid-run and can't see the whole run's new library components.

## D2 — Identity resolution and match reasons

- **Decision**: the pass reads `bom_entries` for the run's components where `resolvedComponentId IS NULL`. **PURL_EXACT**: `bom_entries.purlIdentity` equals `components.externalId` verbatim, or equals `normalizePurlIdentity(externalId)` computed in the service layer over the (small) `externalId LIKE 'pkg:%'` candidate set — covering components whose stored externalId carries a version/qualifiers. Exact matches set `resolvedComponentId` **and** stage a suggestion. **PURL_NAME_MATCH** / **CATALOG_SLUG_MATCH**: package `name`/`slug`-derived token equals a component `name`/`slug` (case-insensitive, normalized) — stage a suggestion only, no `resolvedComponentId` write (identity stays unconfirmed; the cell shows *Suggested*, not *Linked*). Reason ranking for scores: `PURL_EXACT` > `CATALOG_SLUG_MATCH` > `PURL_NAME_MATCH`.
- **Rationale**: `resolvedComponentId` is the "in catalog" identity link (ADR-131: set by the matching pass only) — a fuzzy name match must not mark an entry as resolved to a possibly-wrong component; the suggestion carries the candidate on `childComponentId` for human review.
- **Alternatives**: resolve on any match — rejected (would assert unverified identity); only exact-match suggestions — rejected, research requires all three reasons.

## D3 — Suggestion lifecycle = ADR-113 clone

- **Decision**: `bom_component_suggestions` mirrors `edge_suggestions`: only `PENDING` actionable; `ACCEPTED`/`DISMISSED`/`SUPERSEDED` terminal; `UNIQUE (parentComponentId, childComponentId)`; `INSERT … ON CONFLICT (parent,child) DO UPDATE … WHERE status='PENDING'` for re-staging (no resurrect, idempotent rescan); pairs already covered by a real `component_depends_on_component` edge → `SUPERSEDED` tombstones (idempotent, `reason`/`score` NULL); edge writes mark covered PENDING rows `ACCEPTED` on human action and `SUPERSEDED` when the edge came via another path — the exact semantics of `acceptSuggestion`/`supersedeSuggestionPairs` in `edge-suggestion-service.ts`/`product-edge-service.ts`.
- **Rationale**: ADR-113 is ratified and proven; divergent lifecycle semantics would create a second mental model for the same queue shape.
- **Alternatives**: reuse `edge_suggestions` rows with a `kind` column — rejected: different endpoint set (component×component vs product×component), different FK surface, different reasons; a dedicated table keeps ADR-048's typed-junction discipline.

## D4 — Dependency queue endpoints

- **Decision**: extend `GET /suggestions` with `kind=edge|dependency` (default `edge` — existing URLs and the nav badge, which reads `status=PENDING` without `kind`, keep counting product edges only). `kind=dependency` returns paginated `DependencySuggestionQueueItem`s for both Pending-expanded and History views. `GET /suggestions/dependencies/groups` returns server-paginated **groups** (one per `childComponentId`: library ref, reason rollup, versions count, purl, pending count) with sort `score|components|name`. `POST /suggestions/dependencies/:id/accept|dismiss` for per-row decisions; `POST /suggestions/dependencies/bulk { childComponentId, action }` for group decisions — `accept` 409s unless every pending row in the group is `PURL_EXACT`.
- **Rationale**: exactly the research's Phase-2 write contract; grouped reads keep the queue bounded when one library has thousands of consumers.
- **Alternatives**: a separate `/dependency-suggestions` namespace — rejected, research fixes the `/suggestions?kind=` shape and the segment UI expects it.

## D5 — Curation write path (atomic)

- **Decision**: `POST /packages/add-to-catalog { purl, linkConsumers }` and `POST /packages/link { purl, componentId, linkConsumers }` run **one transaction**: (a) resolve/normalize the purl (`normalizePurlIdentity`, fallback verbatim); (b) add path — create the `LIBRARY` component (uuidv7; slug `pkg-{type}-{name}` slugified, numeric `-2`, `-3`… suffix on conflict; category/provider/`resourceType`/`externalId` per mapping; audit `writeEntityChange`); link path — verify the component exists; (c) set `resolvedComponentId` on every `bom_entries` row with that `purlIdentity`; (d) for each distinct ACTIVE consuming `componentId`: `linkConsumers=true` → `INSERT component_depends_on_component … ON CONFLICT DO NOTHING` (pre-existing edges preserved, counted separately) and flip covered PENDING suggestions to `ACCEPTED` (human decided) / `SUPERSEDED` where the edge already existed; `linkConsumers=false` → stage a `PURL_EXACT` suggestion per consumer (ON CONFLICT no-op on decided pairs). Any failure rolls the whole thing back — the dialog's atomicity requirement.
- **Rationale**: one transaction is the only way "Add and link N" can honestly claim all-or-nothing; suggestion bookkeeping inside the same tx keeps queue truth aligned with edge truth.
- **Alternatives**: per-consumer best-effort writes — rejected (violates UX-ADD-05 atomicity).

## D6 — Permission model

- **Decision**: new RBAC action `component:edge:add` → `EDITOR` for all curation writes (`add`, `link`, dependency accept/dismiss/bulk). The preview GET and all reads stay `verifySession`-only (any role); `x-permission` is declared on each write route for the ADR-104 contract test.
- **Rationale**: parallel to `product:edge:add` gating the product-edge queue; Editor is the curator role per the research Roles table.
- **Alternatives**: reuse `product:edge:add` — rejected: wrong domain (product edges ≠ component dependency edges).

## D7 — Relationships bounded contract

- **Decision**: `GET /components/:id/relationships` partitions `LIBRARY`-category neighbours out of the `dependsOn`/`dependedOnBy` lane node lists into `libraryCounts: { dependsOn: number, dependedOnBy: number }`. All other lanes are unchanged (`LANE_LIMIT` behaviour preserved).
- **Rationale**: UX-LIB-05 requires the summary node and a bounded read; counting instead of listing libraries keeps the contract O(lanes), not O(deps).
- **Alternatives**: paginate library lanes — rejected: a lane is a canvas affordance, not a list; the summary node links out to the paginated surfaces (`?tab=bom` / Used-by).

## D8 — Components-list library visibility

- **Decision**: `listComponentsQuerySchema` gains `libraries` (`"1"|"true"` → include). Default (`libraries` absent) adds `category != 'LIBRARY'` to the components population; the response gains `librariesHidden: number` (count of excluded ACTIVE libraries) so the toggle can render "Show libraries (212)". Direct links to Library components always resolve (detail read unaffected).
- **Rationale**: UX-LIB-01; keeping the hidden count server-side avoids a second query from the UI.
- **Alternatives**: a `category` filter value users toggle — rejected: hides the mechanism behind a generic filter and can't express "everything except LIBRARY".

## D9 — Coverage exclusion

- **Decision**: `coveragePopulationPredicate` (`catalog-coverage-service.ts`) gains `components.category != 'LIBRARY'` — the single predicate feeds the list Coverage filter and dashboard wired/unwired denominators. The amendment is recorded in `specs/023-coverage-and-hygiene/spec.md` (UX-LIB-02's "MUST be recorded there") and `docs/ux.md`.
- **Rationale**: libraries are meaning-layer leaves, not coverage population; one predicate change covers every denominator.
- **Alternatives**: excluding at each call site — rejected: the predicate exists precisely to keep population math single-sourced.

## D10 — Library detail reads

- **Decision**: **Used by** reuses `GET /packages/consumers?purl={externalId}` (the Library's `externalId` IS its purl identity — zero new contract). **Versions in use** needs *all* versions (not the top-5 of the `/packages` row): new `GET /packages/versions?purl=` returning every `{version, componentCount}` for the identity, cheap grouped read. Category section component `package-details.tsx` renders identity (purl `MonoValue`, ecosystem, provider) + the two lists; `component-detail.tsx` swaps the Instances card for LIBRARY components.
- **Rationale**: maximal contract reuse; one small read where the existing rollup truncates.
- **Alternatives**: new `/components/:id/used-by` endpoint — rejected: identical data already exposed under the purl key.

## D11 — Preview endpoint

- **Decision**: `GET /packages/add-to-catalog/preview?purl=` returns `{ name, category, provider, providerGroup, resourceType, identity, consumerCount, versions, mappedFrom: { cdxType, ecosystem } | null, existingComponent | null }` — the dialog renders verbatim. `existingComponent` drives Link mode; `mappedFrom` is non-null when the `cdxType`→category mapping was lossy (e.g. `firmware`→`COMPUTE`, unmapped→`OTHER` provider) and renders the muted note.
- **Rationale**: UX-ADD-02/07 require the preview and anomaly visibility before commit; deriving server-side keeps the mapping tables single-sourced in `core`.
- **Alternatives**: client-side derivation — rejected: duplicates the mapping tables and drifts.

## D12 — Docs/ADR/flag surface

- **Decision**: same-change deltas — `docs/openapi.yaml` for every new/changed route (ADR-104, contract-test enforced); `bomCuration: false → true` + `flagOverride` in `flags.ts`; **G38 entry** in `researches/ux-rewrite-gaps.md` (G36/G37/G40 exist — G38 fills the reserved slot); `docs/ux.md` (dependency segment, new surfaces, flag row already present → flip note); `docs/roadmap.md` (075 shipped + Next revision); new `researches/adrs/ADR-132-catalog-promotion-of-bom-entries.md` + index row; `research/adrs/ADR-013` Amendment 2 (providers + cdxType mapping); back-pointer on ADR-131 (`resolvedComponentId` now written by the pass); CONTEXT.md already carries the vocabulary. Playwright seed fixtures gain library/suggestion data.
- **Rationale**: AGENTS.md done-criteria and ADR-104 require docs in the same change.
- **Alternatives**: none — non-negotiable project rules.

## Open implementation notes (not decisions)

- Per-entry `POST /bom-entries/:id/promote|wire` aliases are **omitted** — spec marks them optional and nothing consumes them; adding untested surface would violate the coverage gate. Note in spec/plan so reviewers know the omission is deliberate.
- `components.externalId` has no unique constraint — Link-mode dedupe is service-layer (spec assumption). A DB unique index on normalized purl externalIds is **not** added: `externalId` is provider-native for other components and NULL-heavy; uniqueness stays a service concern.
