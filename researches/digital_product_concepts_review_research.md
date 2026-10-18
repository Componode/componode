# Digital Product Concepts Review — Practical DPAM Assessment

> **Purpose**: Evaluate whether Componode's digital-product concepts (the
> Composable Product Model and its supporting entities) are suitable for the
> tool's stated purpose — practical Digital Product Asset Management — and
> lay out an improvement plan biased toward the *practical* end of the
> spectrum (low-hassle cataloging), explicitly rejecting the heavyweight
> enterprise-vendor approach.
>
> **Scope**: Internal sources are primary — `CONTEXT.md`, the constitution,
> ratified ADRs, `docs/`, and the code itself (implementation status is
> verified, not assumed). External benchmarking is delegated to
> `dpam_landscape_research.md` — this document cites it rather than
> duplicating it.
>
> **Relationship to existing work**: Complements
> `component_taxonomy_research.md` (component side) and
> `dpam_landscape_research.md` (industry side). Where a recommendation would
> change a ratified decision, the affected ADR is named — nothing here
> silently overrides an ADR. This document is informative, not authoritative.

---

## Executive Summary

1. **The concepts are suitable — better than "suitable," they are already
   at the practical end of the industry spectrum.** Every structural choice
   that determines whether a catalog is usable — factual/meaning layer
   split, env-as-instance, two product→product edge semantics, acyclic
   composition, lifecycle-vs-status split — is independently orthodox
   (`dpam_landscape_research.md` §9, §10). Componode's product-side model
   is *smaller than Backstage's*, and "Digital Product" is now the
   standards-level noun (IT4IT 3.0; CSDM 5.0 is adopting it).

2. **The product field set is a near-exact match for the documented APM
   "minimum viable inventory"** — stable slug, dual ownership
   (LOB = business owner, Team/Person = technical owner), criticality,
   lifecycle + sunset date, links, tags (`dpam_landscape_research.md` §7).

3. **The hassle is in the authoring path, not the model.** The meaning
   layer starts empty, must be wired one edge at a time, and the flagship
   mechanism that makes wiring cheap — ADR-017's detect→promote→rewrite
   Platform Product workflow — is **ratified but not implemented**. ADR-110
   (group dependency edges) and ADR-112 (product health rollup) are also
   ratified-not-built. The gap list below is therefore mostly "finish what
   was already decided" plus cold-start ergonomics.

4. **The improvement plan is phased**: Phase 0 finishes ratified work;
   Phase 1 attacks the cold-start problem (bootstrap import + read-only
   edge suggestions — the v2 candidate-edge concept, pulled forward);
   Phase 2 is wiring ergonomics and coverage metrics; Phase 3 is
   stewardship-lite (completeness signals, not scorecards); Phase 4 lists
   optional field refinements. §5 records the explicit non-goals that keep
   Componode practical.

---

## 1. The model as it exists today

| Concept | Source of truth | Status |
|---|---|---|
| `DigitalProduct` (3-type enum) | ADR-018, ADR-109; `CONTEXT.md` | Implemented |
| `COMPOSES` (product→product DAG, write-time cycle check) | ADR-049/050 | Implemented (`product-edge-service.ts`) |
| `CONSUMES_FROM` (target must be `PLATFORM`) | ADR-018 | Implemented |
| `DEPENDS_ON` (product→component, logical env-agnostic) | ADR-015 | Implemented |
| `DEPENDS_ON` → `ComponentGroup` target | ADR-110 | **Ratified, not implemented** (no `product_depends_on_component_group` in `src/`) |
| `Component` + `category`/`provider`/`resourceType` taxonomy | ADR-013; constitution III | Implemented |
| `ComponentInstance` (env + operational status) | ADR-014/034; constitution IV | Implemented |
| `ComponentGroup` (human-declared equivalence) | ADR-082 | Implemented |
| Ownership: `LineOfBusiness` / `Team` / `Person` | ADR-020 | Implemented (both FKs nullable) |
| Practical metadata: links, tags, criticality, `sunsetAt` | ADR-111 | Implemented (spec `017-product-metadata`) |
| Product health rollup (derived, read-only) | ADR-112 | **Ratified, not implemented** |
| Platform Product workflow: detect → promote → rewrite edges | ADR-017 | **Ratified, not implemented** (no candidate/promote endpoint in `routes/` or `openapi.yaml`) |
| Hierarchy authoring: manual | ADR-019; constitution V | Implemented (and is the current bottleneck) |
| Importer-declared *candidate* edges (staged, human-confirmed) | constitution V; `DiscoveredAsset.relationships` reserved | Designed for v2, unscheduled |
| Product-graph canvas | `docs/ux.md` §11 | Deferred UI work |

## 2. Fit-for-purpose assessment

### 2.1 Already practical (validated externally)

- **Factual vs. meaning layer split** (constitution V) is *the* structural
  decision that keeps a catalog from rotting: importers maintain what
  exists; humans curate what it means. The CSDM lesson is that
  discovery-noise corrupts curated data; the Backstage/Port lesson is that
  automation feeding a small curated core is what gets adopted
  (`dpam_landscape_research.md` §3, §5).
- **Environment-as-instance** (ADR-014): no surveyed tool puts env on the
  logical asset; `ComponentInstance` is the orthodox shape
  (taxonomy research + landscape §10).
- **Two product→product edge semantics** (`COMPOSES` part-of vs.
  `CONSUMES_FROM` uses-a-platform) is the industry-recognized minimum —
  Team Topologies' X-as-a-Service distinction made executable. One generic
  "related-to" edge would be worse; three would be the start of a
  metamodel. Componode sits exactly at the documented minimum (§9 of the
  landscape doc, item 3).
- **3-type product enum**: no one else ships it, but it is a *compression*
  of types heavyweight tools keep separate (LeanIX Business Capability /
  Platform / Application fact sheets). It survives because it enables one
  real rule (`CONSUMES_FROM` → PLATFORM) and drives rendering.
- **Practical metadata** (ADR-111) ≈ the APM minimum viable inventory;
  `sunsetAt` maps to the TIME "Eliminate" trigger without a rationalization
  framework.
- **Retire-not-delete + display-only sunset**: reversibility instead of
  workflow gates — the opposite of CSDM's lifecycle machinery.
- **DAG + write-time cycle rejection** (ADR-049/050): universal practice;
  no surveyed source uses cyclic product graphs.
- **Naming**: "Digital Product" is the emerging standard term (IT4IT 3.0,
  CSDM 5.0) — not an idiosyncrasy.

### 2.2 Deviations to note (monitor, don't reflexively fix)

- **`CUSTOMER_FACING` mixes axes**: it is a *consumer* attribute while the
  other two types are *structural*. Mild modeling smell flagged by the
  landscape review (§10). No external source resolves it; a product can be
  both customer-facing and a capability. Keep for now — renaming churn
  costs more than the smell. If evidence accumulates that users agonize
  over the pick, the cheap fix is a consumer attribute, not a fourth type.
- **Three-tier ownership** (LOB→Team→Person) is heavier than Backstage's
  single required `spec.owner` — but both FKs are nullable and the APM
  consensus wants business + technical ownership anyway. Acceptable.
- **Health = operational rollup** vs. the industry scorecard norm. Simpler
  and complementary — operational truth beats self-reported maturity.
  Scorecards remain a non-goal (§5).

## 3. Where the hassle actually is

Ordered by impact on a new adopter:

- **H1 — Cold start.** The meaning layer starts at zero. Manual-only
  authoring (ADR-019) means every product is created, typed, owned, and
  wired by hand before the catalog answers anything. Meanwhile most orgs
  already have *some* application list (a spreadsheet, a CMDB export, a
  wiki page). There is no bootstrap path — no product import, no starter
  suggestion, no way to go from 500 imported components to a draft product
  layer. This is the single biggest "without hassle" gap.
- **H2 — Ratified-but-unbuilt practical features.** The three mechanisms
  that most directly reduce wiring labor and answer the question users
  actually ask:
  - **ADR-017 detection + promotion**: "component X is depended on by 4
    products — make it a platform" with guided edge-rewrite. Nothing of
    this exists in the API or UI today; users must notice shared
    components themselves and rewire by hand.
  - **ADR-110 group dependency**: without it, "my product uses the
    payments DB" is N edges instead of one, and silently goes stale when
    group membership changes.
  - **ADR-112 health rollup**: "is my product affected?" — the attention
    dashboard shows *instance* errors, not *product* impact.
- **H3 — One-edge-at-a-time wiring.** `POST /products/{id}/depends-on`
  takes a single `componentId`. Wiring a real product to a dozen
  components means a dozen picker round-trips; there is no bulk add, no
  "unwired components" worklist, and no "create a product from these
  components" fast path (the platform-promotion path is a special case of
  this that also isn't built).
- **H4 — Coverage blindness.** The dashboard reports component/instance
  health but nothing about *catalog* coverage: how many active components
  are wired to ≥1 product, how many products have no owner, no
  dependencies, no description. A catalog tool that can't show its own
  completeness can't guide the user to the next best action — the core
  practical-DPAM loop.
- **H5 — Weak stewardship signals.** `sunsetAt` overdue badges exist on
  entity pages but nothing aggregates "what needs attention as a
  *catalog*": overdue sunsets, ownerless products, stale products. The
  attention feed only carries operational items (failed runs, ERROR/GONE
  instances).
- **H6 — Small field gaps** (flagged by the landscape review, §10 — adopt
  only on demand): a free-text **outcome/value statement** (the one
  practitioner-agreed product property Componode lacks); an explicit
  **consumer** notion on PLATFORM products (Team Topologies defines
  platforms by having internal customers — arguably already expressed by
  `CONSUMES_FROM` in-degree, so this may need only surfacing, not a
  field); optional **cost** (in every APM minimum list, lowest priority).

## 4. Improvement plan (phased)

Phases are ordered by value-per-effort for a fresh adopter; each item is
small enough to be one spec-kit feature or bugfix.

### Phase 0 — Finish what is ratified (no new decisions needed)

| # | Item | ADR | Why first |
|---|---|---|---|
| 0.1 | Product health rollup (derived `health` on product detail/list + attention feed) | ADR-112 | Answers "is my product affected" — the top user question; pure aggregation over existing data |
| 0.2 | `DEPENDS_ON` → `ComponentGroup` edge (persisted, read-time expansion, "via {group}") | ADR-110 | Kills the N-edges-for-one-dependency tax on the most common real-world shape |
| 0.3 | Platform Product workflow, part 1 — **detection**: endpoint + dashboard card listing components depended on by ≥2 products | ADR-017 | Surfaces platform candidates for free; detection is read-only |
| 0.4 | Platform Product workflow, part 2 — **promotion**: create PLATFORM product + edge-rewrite transaction + owner prompt | ADR-017 | The flagship demo of the model; bounded transaction per the ADR |

### Phase 1 — Cold start (the real adoption gate)

| # | Item | Notes |
|---|---|---|
| 1.1 | **Bootstrap product import**: CSV/JSON file (name, type, description, owner slug, tags, criticality) → creates products in one transaction; matches the spreadsheet-first reality of APM practice (landscape §7) | New spec; importer-family but a one-shot curated action, not a scheduled importer — keeps constitution II clean |
| 1.2 | **Edge suggestions (read-only)**: heuristic candidate `DEPENDS_ON` edges — name/slug similarity, Kubernetes `app.kubernetes.io/part-of` and `app.kubernetes.io/name` labels already in imported `details`, repo naming conventions — shown as a suggestion queue the user accepts/dismisses | Constitution V already permits this shape ("v2: staged as candidates, human-confirmed"); pulling it forward is a roadmap decision, not a constitution change. Key constraint: suggestions are generated **server-side from stored import data**, not importer-declared product edges — the importer contract stays untouched |
| 1.3 | **"Create product from components"** fast path: multi-select components → new product pre-wired with `DEPENDS_ON` edges | Reuses the same wiring as 0.4's promotion path |

### Phase 2 — Wiring ergonomics + coverage

| # | Item | Notes |
|---|---|---|
| 2.1 | Bulk `DEPENDS_ON` wiring (multi-select in edge picker, or `componentIds[]` on the POST) | Small schema change; audit each edge per ADR-052 |
| 2.2 | **Unwired-components worklist**: dashboard card / component list preset = active components with zero product dependencies | Read-only aggregate, same pattern as existing dashboard service |
| 2.3 | **Coverage metrics** on dashboard: % components wired, products without owner / without deps / without description | One aggregate endpoint; no new state |
| 2.4 | Sunset-overdue items in the attention feed | Reuses ADR-111 display rules |

### Phase 3 — Stewardship-lite (keep the catalog alive without a governance program)

| # | Item | Notes |
|---|---|---|
| 3.1 | **Completeness chip** on product list/detail: owner ✓ / description ✓ / deps ✓ — informational, never a score | The "owner can't be named is a data point" practice made visible; deliberately *not* a scorecard |
| 3.2 | Consumer surfacing on PLATFORM products: "consumed by N products" derived from `CONSUMES_FROM` in-degree — answers the Team Topologies "does this platform have customers?" test | Read-only derivation; likely zero schema change |

### Phase 4 — Optional field refinements (adopt on demand, each needs an ADR)

| # | Item | Trigger to adopt |
|---|---|---|
| 4.1 | Free-text `outcome` / value statement on `DigitalProduct` | Users start writing outcomes into `description` |
| 4.2 | Optional `cost`/`costCenter` on `DigitalProduct` | APM-style rationalization demand appears |
| 4.3 | Revisit `CUSTOMER_FACING` vs. a consumer attribute | Evidence of type-picking confusion (support questions, mis-typed products) |

## 5. Explicit non-goals (guardrails against vendor-heaviness)

The landscape review's mechanism list (§"What makes vendor approaches
heavy") translates directly into things to *not* build:

- **No scorecards / maturity rubrics** — the heavy version of completeness;
  OpsLevel/Cortex's core feature is Componode's anti-goal. Item 3.1 is the
  ceiling.
- **No user-defined metamodel** (Port-style blueprints) — flexibility that
  shifts modeling burden onto the user; the opinionated small model is the
  product.
- **No workflow approvals / data-steward machinery** (quality seals,
  subscription roles, mandatory re-approval) — governance theater that
  exists to compensate for metamodel rot Componode doesn't have.
- **No new edge types** for "related to" / "depends on product" — the two
  semantics are the documented minimum and the documented maximum.
- **No fourth product type** without evidence; no open `type` string
  (Backstage-style) — the enum powers `CONSUMES_FROM` validation.
- **No cost accounting beyond an optional field**; no risk/compliance
  entity (already deferred, ADR-021); no certified taxonomy or CSDM-style
  vocabulary program.
- **No auto-derived product hierarchy** — constitution V stands; Phase 1.2
  is *suggestions*, never auto-wiring.

## 6. ADR and spec implications

| Proposal | Spec/ADR path |
|---|---|
| Phase 0 items | Already ratified — straight to `speckit-specify` feature specs; no new ADRs |
| Bootstrap import (1.1) | New feature spec; likely a small ADR (import format, conflict handling) |
| Edge suggestions (1.2) | New spec; **new ADR** — constitution V's "v2 candidate edges" is being pulled forward and implemented *server-side* rather than importer-declared; record that distinction explicitly |
| Bulk wiring / worklists / coverage (Phase 2) | Feature specs; no ADR expected (no new concepts) |
| Completeness chip (3.1) | Feature spec; no ADR (display-only derivation, ADR-112 precedent) |
| Outcome / cost fields (Phase 4) | New ADR each (schema-affecting, extends ADR-111's metadata set) |
| `CUSTOMER_FACING` axis note | Informational — record in this document only unless a change is later proposed |

## Addendum — decisions ratified (2026-10-18 grilling)

The improvement plan above was grilled and ratified across three rounds
(grill-with-docs session, Q1–Q23). Concretely:

- Phases, feature packaging, and ordering stand as written — five spec
  features: `019-group-deps-health` → `020-platform-product-workflow` →
  `021-catalog-bootstrap` → `022-edge-suggestions` →
  `023-coverage-and-hygiene`.
- Suggestions and bootstrap are now ratified architecture:
  [ADR-113](./adrs/ADR-113-staged-edge-suggestions.md) (staged,
  server-generated `DEPENDS_ON` candidates — amends
  [ADR-019](./adrs/ADR-019-hierarchy-authoring-manual-for-v1.md)) and
  [ADR-114](./adrs/ADR-114-catalog-bootstrap-import.md) (declarative
  product+deps file).
- [ADR-110](./adrs/ADR-110-product-dependency-on-component-group.md)
  carries an amendment note extending the union input with bulk
  `componentIds[]`.
- `CONTEXT.md` gained three terms: **Candidate edge**, **Bootstrap
  import**, **Catalog coverage**.
- Ratified details now fixed for specs (not re-decided): YAML schema
  shape, upsert-by-slug, two-phase validate/apply, `?dryRun=true`,
  suggestion statuses `PENDING/ACCEPTED/DISMISSED/SUPERSEDED` with
  terminal-state semantics, group-covered suppression, no un-dismiss,
  three v1 signals, coverage metric set + list filters, chip =
  owner/description/deps on products only.

## Sources

- Internal: `CONTEXT.md`; `.specify/memory/constitution.md` (III–V);
  ADR-013/014/015/017/018/019/020/049/050/082/109/110/111/112;
  `docs/digital-products.md`; `docs/ux.md` §11; `docs/roadmap.md`;
  implementation status verified in `packages/backend/src`
  (`services/product-edge-service.ts`, `services/dashboard-service.ts`,
  `routes/products.ts`, `db/migrations/`) and `docs/openapi.yaml`.
- External: `researches/dpam_landscape_research.md` (all industry claims
  and citations live there — see its §9 comparative table, §"practical
  minimum" synthesis, and §10 Componode-specific notes).
