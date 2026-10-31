### ADR-113 — Staged edge suggestions: server-generated DEPENDS_ON candidates

> **Status:** Ratified

**Context**: The DPAM concepts review
(`researches/digital_product_concepts_review_research.md`) identified manual
wiring labor — one `DEPENDS_ON` edge at a time — as the top "without hassle"
gap: the meaning layer starts empty even when the factual layer is rich.
[ADR-019](./ADR-019-hierarchy-authoring-manual-for-v1.md) ratified
manual-only authoring, and constitution V reserves importer-declared
candidate product edges for v2. This ADR pulls the *staged-candidate*
concept forward — with a different source: candidates are **generated
server-side from stored import data**, not yielded by importers. The
importer contract (ADR-056/057) is untouched.

**Decision**:

1. **`edge_suggestions` table (persisted staged candidates)** — one row per
   `(productId, componentId)` pair: `id` (uuid v7), `reason`
   (`NAME_MATCH` | `TOPIC_TAG_MATCH` | `NAMESPACE_MATCH`), `score`,
   `status` (`PENDING` | `ACCEPTED` | `DISMISSED` | `SUPERSEDED`),
   `createdAt`, `decidedAt`, `decidedBy`. Unique on the pair.

2. **Generation is server-side, trigger-based**: after each successful
   import run (new/changed components enter the candidate pool) and on
   product create/rename (a new name may match existing components). Merge
   semantics: new pairs → `PENDING`; decided pairs are never resurrected;
   pairs that became real edges by any means → `SUPERSEDED`.

3. **Terminal-state semantics**: `PENDING` is the only live state; the other
   three are terminal. A deliberately unwired pair is a decision, not a
   regression — deleted real edges never regenerate a suggestion.

4. **Signals v1** (stored data only, no importer changes): name/token
   containment between product and component name/slug; GitHub
   `details.topics` and component `tags` matching product tags/name tokens;
   k8s `details.namespace` token match. Weighted score with a floor;
   `reason` recorded per row for display. Importer `details` enrichment
   (e.g. k8s labels) is an independent follow-up, not a prerequisite.

5. **Queue UX**: a dedicated Suggestions review page lists `PENDING` rows
   sorted by score with reason chips; a filter exposes `DISMISSED` rows for
   inspection. Accept → calls the existing `addDependsOnEdge` service
   (real edge + audit, no parallel write path) and marks `ACCEPTED`.
   Dismiss → `DISMISSED`, permanent; recovery is manual wiring — no
   un-dismiss transition.

6. **Scope**: `DEPENDS_ON` candidates to concrete Components only — no
   `ComponentGroup`, `COMPOSES`, or `CONSUMES_FROM` suggestions. Pairs the
   product already reaches through a group edge
   ([ADR-110](./ADR-110-product-dependency-on-component-group.md)) are
   suppressed as covered.

7. **Access**: the queue is readable by any authenticated role;
   accept/dismiss requires the edge-write permission (EDITOR+).

8. **Amends [ADR-019](./ADR-019-hierarchy-authoring-manual-for-v1.md)** —
   "manual" now means *human-decided*, assisted by staged candidates.
   Importer-declared candidates remain a distinct v2 mechanism per
   constitution V.

**Consequences**: one migration + `edge_suggestions` contract/constants; a
generation hook on the run-complete path and product write path; queue
routes + page; `docs/openapi.yaml` per ADR-104. Lands in spec
`022-edge-suggestions`, after `019-group-deps-health` (the group-suppression
rule needs ADR-110's expansion implemented).

**Alternatives considered**: importer-declared candidates (constitution V's
original v2 shape) — postponed; richer signal but couples the importer
contract and blocks the feature on importers emitting relationships.
Computed-on-read + dismissal table — rejected (unstable queue, no decision
audit, regenerates dismissed candidates). Auto-wiring accepted pairs —
rejected outright (violates constitution V).

> **AMENDMENT (spec `022-edge-suggestions`, shipped)**: generation triggers
> were broadened during implementation — in addition to import-run
> completion, generation also runs on signal-affecting product writes
> (create, name/tag updates) and component writes (tag/group changes),
> after a catalog bootstrap apply and a platform promotion, and on demand via
> `POST /api/v1/suggestions/rescan` (EDITOR+) — the backfill path for
> catalogs that predate the feature. Also shipped: `SUPERSEDED` tombstones
> are written at edge-write time (real *or* group-covered), and decided
> pairs never resurface. The manual rescan supersedes the original
> no-manual-regen intent — justified because PENDING rows that stop
> matching are left untouched, so rescan can never un-decide a human.

> **AMENDMENT (spec `042-catalog-authoring`, shipped)**: the `status` filter on
> `GET /api/v1/suggestions` gains `DECIDED` — a rolled-up view over every
> terminal status (`ACCEPTED`/`DISMISSED`/`SUPERSEDED`), ordered by
> `decidedAt` descending, powering the Suggestions page's History tab (gap
> G32). Per-status reads stay limited to `PENDING`/`DISMISSED`; terminal
> states remain final — the new value is read-only and changes no transition
> semantics.
