# Follow-up findings — spec 068 review & e2e debt

> **Purpose**: input document for composing a new spec (candidate `specs/069-…`).
> Captures (A) the reproducible Playwright failures observed during the spec-068
> full-workload run, with root causes, and (B) the Standards-axis judgement
> calls from the spec-068 code review, each with resolution options that need a
> decision. Everything below was verified against the code on
> `068-list-page-standards` @ `52c3184` (PR #254).

---

## A. Playwright e2e failures

Context: the full `pnpm e2e` workload run during spec-068 showed failures in
older journeys. A targeted rerun of the six suspect specs
(`list-standards`, `component-relationships`, `organization`, `product-map`,
`github-reconciliation`, `docker-enrichment` — 44 tests) reproduced **10
consistent failures**, all in two spec files. Two additional failures seen only
in the full-suite run (`github-reconciliation`, `docker-enrichment`) passed on
the targeted rerun and are classified as load flakes (see A.3).

**Key fact: none of the 10 are spec-068 regressions.** Both root causes are
stale test expectations vs. intentional UI changes that landed on `main`
after the specs were written.

### A.1 `product-map.spec.ts` — 8 failures (4 tests × chromium-desktop + chromium-narrow)

File: `playwright/tests/journeys/product-map.spec.ts` (spec 059 coverage,
last touched by `0da92f4`).

| Test (line) | Title | Failing assertion |
|---|---|---|
| :35 | all relation families render at the top of Dependencies with direction | `getByText('Product topology')` never appears on `?tab=dependencies` |
| :53 | inspection panel, +N expansion, and keyboard operation work without a mouse | same — navigates to `?tab=dependencies` |
| :87 | legacy `?tab=map` links land on Dependencies; empty products show an empty state | asserts the **Map tab does not exist** (`getByRole('tab', {name:'Map'})` → count 0) and `?tab=map` redirects to Dependencies |
| :101 | topology stays usable without horizontal overflow and honors reduced motion | `getByText('Product topology')` on `?tab=dependencies` |

**Root cause**: commit `2f77c56` *"feat(ux): align app with prototype visual
baseline"* introduced a **dedicated Map tab** and moved `<ProductMap>` there
(`product-detail.tsx`: `TabsTrigger value="map"`, `TabsContent value="map"` →
`<ProductMap>`). The current tab set is
`overview | map | components | dependencies | activity`, and `?tab=map` is now a
valid deep link — the exact opposite of what the spec asserts. The spec file
was never updated after the layout change.

Verified: `git diff main...HEAD` on `product-detail.tsx`/`product-map.tsx`
shows spec-068 only added `activityPagination` — the topology code is
untouched. The failures reproduce identically on `main`.

**Fix direction** (needs spec decision on intended behavior):
- Tests :35/:53/:101 should navigate to `?tab=map` (or click the Map tab) and
  assert `Product topology` + the relation families / inspection panel /
  keyboard operation / responsive behavior **there**.
- Test :87 is now semantically wrong twice over: `?tab=map` no longer
  "redirects to Dependencies" — it *is* the map. Decide what the test should
  assert: likely that `?tab=map` selects the Map tab, and that an empty
  product shows the map's empty state (check what `ProductMap` renders with no
  topology — possibly "no relationships" copy already exists).
- Keep the a11y/keyboard/reduced-motion assertions — they still apply, just on
  the Map tab.

### A.2 `component-relationships.spec.ts` — 2 failures (1 test × 2 projects)

File: `playwright/tests/journeys/component-relationships.spec.ts:60`
(spec 060 coverage, last touched by `d671e87`).

Test: *"renders typed lanes, provenance, and nested instances"* — fails at
`getByText('Depended on by', { exact: true })` (the first of seven expected
lane titles). The `Component relationships` heading itself renders fine.

**Root cause**: commit `7e33ef2` *"fix(ux): align component relationships map
with prototype polish"* changed lane rendering — **"Hide relation lanes with
no data; keep only the header of lanes whose relation kind failed to load"**.
The fixture's component-to-component lanes (`Depended on by`, `Depends on`)
have no writer yet, so those lanes are now hidden entirely. The spec still
expects all seven lane titles visible **and** asserts `'None'` empty states
inside the two empty lanes — directly contradicting the shipped behavior.

Verified: `component-relationships.tsx`, `component-detail.tsx`, and the
relationships API hook are untouched by spec-068. Reproduces on `main`.

**Fix direction**:
- Update the lane loop to expect only **populated** lanes
  (`Sourced by`, `Exposed by`, `Product dependents`, `Sources from`, `Exposes`
  for this fixture — verify against `buildRelationshipFixture`) and assert the
  empty lanes (`Depended on by`, `Depends on`) are **absent**.
- Remove or invert the `'None'` empty-state assertions — they encode the
  pre-`7e33ef2` behavior. (Open question for the spec: is "hide empty lanes"
  the intended permanent behavior, or should empty lanes show a collapsed
  "None" affordance? The commit message says hide is intentional.)
- Keep provenance-label and nested-instances assertions — unaffected.

### A.3 Load flakes observed once (not in the 10)

- `importers/github-reconciliation.spec.ts:26` — failed once in the full-suite
  run (36s), passed on targeted rerun.
- `importers/docker-enrichment.spec.ts:193` — failed once in the full-suite
  run on chromium-narrow, passed on targeted rerun.
- Mechanism: the app's global rate limit is **300 req/min keyed by user id**
  (`packages/backend/src/plugins/rate-limit.ts`); all journey tests share the
  same seeded users, so cumulative traffic late in a long run can 429 a test's
  bootstrap. Spec-068 added `retries: 1` to `playwright.config.ts` (`52c3184`)
  which absorbed one observed webkit flake. These two failures predate that
  change and may still flake occasionally — candidate for the same treatment
  or a fixture-level retry if they recur.

---

## B. Standards-axis judgement calls (spec-068 code review)

These are **not** spec violations — the review found zero hard violations. They
are pre-existing patterns the diff entrenches or new minor smells. Each needs a
decision: fix now, codify as accepted convention, or defer.

### B.1 Mapper-rule deviation in the patterns layer

`docs/ux.md` §5: *"No component reads API contracts directly."* Spec-068 added
direct `@/api/types` imports in shared patterns:

- `ux/components/patterns/title-with-summary.tsx` imports `OrgEntity`,
  `TeamEntity`
- `ux/components/org/org-tables.tsx` imports `LobListItem`, `TeamListItem`
- `ux/app/docker-targets/index.tsx` imports `DockerTarget`

Org/docker-target entities have no view types or mappers — the spec codified
direct API-type reads rather than adding the missing mapper layer.

**Decision needed**: (a) add proper view types + mappers for
org/docker-target/importer entities and route everything through them
(more work, restores the rule); (b) amend `docs/ux.md` to carve out an
exception for leaf display patterns; (c) accept as-is and record the
deviation. Option (a) is the "correct" one but touches many files.

### B.2 Four spellings of the same 400-validation failure

Identical `{code, message, details}` 400 envelope, four implementations:

- `validationFailed()` helper ("Invalid input") in org/sessions/users/
  importer-sources routes
- hand-rolled `message: "Invalid query"` in agents.ts, importers.ts (×4),
  credentials.ts
- `"Invalid query parameters"` in component-groups.ts
- file-local `invalid()` in docker-targets.ts:8

**Decision needed**: unify into one shared helper (e.g.
`utils/http-errors.ts` `invalidQuery(details)`) — cheap, mechanical, removes
drift in user-facing copy. Recommend fix.

### B.3 Sort-dispatch ternary chains repeated ~12×

Every migrated service orders via nested ternaries:

```ts
.sort === "name" ? qb.orderBy("name", ord)
: .sort === "health" ? qb.orderBy(sql`…`, ord)
: …
```

Locations: `agent-service.ts:321`, `credential-service.ts:159`,
`import-run-service.ts:1453/1537`, `importer-source-service.ts:379`,
`org-service`, `product-service`, `component-catalog-service.ts:195`,
`component-group-service.ts:117`, `audit-query-service.ts:453/555`.

Adding a sort key today means editing N ternary chains (shotgun surgery) and
the chains are hard to audit against the Zod whitelist.

**Decision needed**: refactor to `Record<SortKey, OrderByExpr>` maps per
service (medium effort, big readability win, makes whitelist drift
impossible); or accept the duplication. Recommend fix as part of a
backend-cleanup spec.

### B.4 Adapter-lambda duplication in frontend hooks

The `"all"`-sentinel → API-param mapping is copy-pasted:

- `componentsListParams` (hooks/components.ts:74)
- `productsListParams` (hooks/products.ts:67)
- `activityFeedParams` + `auditFacet` (hooks/audit.ts:95)
- `useDebouncedFilter` (activity.tsx:96) ≈ `useListSearch` with sentinel mapping

**Decision needed**: extract a shared `facetParam(urlValue, apiValues)` helper
+ consolidate the two debounced-filter hooks. Small, safe. Recommend fix.

### B.5 Dual-signature compat hooks

`useSuggestions(view, offsetOrOptions?, limit?)` and `normalizeFeedQuery`
translate legacy `limit`/`offset` callers to the new `page`/`pageSize`
contract. Non-aligned offsets silently clamp
(`Math.floor(offset/pageSize)+1`) — a caller passing `offset=10, pageSize=25`
gets page 1, not an error.

**Decision needed**: (a) keep compat but log/warn on clamped offsets;
(b) migrate remaining legacy callers and drop the dual signature;
(c) accept silent clamp (documented). Inventory of remaining legacy callers
needed first — grep `useSuggestions(` / `useEntityHistory(` call sites.

### B.6 Speculative generality + inconsistent type extension

- `SummaryRowMap` in `title-with-summary.tsx:73-79` carries optional
  "forward-compat" fields for payloads "the current list payloads don't all
  carry yet" — speculative.
- `ImportRun.completedAt` is handled via an inline `& {…}` intersection at the
  call site instead of updating the `ImportRun` view type — inconsistent with
  how `Suggestion` was extended.

**Decision needed**: either populate the fields for real (if the API already
returns them) or delete the speculative members; move `completedAt` into the
view type properly. Small cleanup. Recommend fix.

### B.7 `ENTITY_TYPE_LABELS` duplicates domain vocabulary

`activity.tsx:52` hardcodes a 19-entry entity-type→label map that duplicates
`ENTITY_KIND` in `mappers/dashboard.ts` and backend audit vocabulary. Also
`importer_config: "Importer"` is inconsistent with sibling labels
("Importer source", "Importer config").

**Decision needed**: consolidate to one label registry (frontend mapper or
core constant shared with backend); fix the "Importer" label. Small. Recommend
fix.

### B.8 `?tab=` convention vs `?status=` on suggestions (note only)

Suggestions tabs are now driven by the `?status=` list filter rather than
`?tab=`/`useValidatedTab`. The convention rule scopes to detail pages and the
URL-state spirit is preserved — flagged for awareness only. **Decision**:
confirm acceptable, or align suggestions to `?tab=` + internal state.

---

## Suggested spec shape

Two candidate workstreams — could be one spec ("test debt + UX cleanup") or
two:

1. **`specs/NNN-e2e-spec-debt`** (bugfix-flavored): update
   `product-map.spec.ts` and `component-relationships.spec.ts` to the current
   UI (Map tab, hidden empty lanes), re-run affected specs green. Small,
   mechanical, unblocks a clean full-suite signal.
2. **`specs/NNN-list-standards-cleanup`** (tech-debt): B.2 + B.4 + B.6 + B.7
   (cheap unifications), then B.3 + B.1 + B.5 as the heavier decisions.
   B.8 is a clarification-only item.
