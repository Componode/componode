# Feature Specification: Edge Suggestions

**Feature Branch**: `feature/022-edge-suggestions`

**Created**: 2026-10-19

**Status**: Draft

**Input**: `022-edge-suggestions` — implement the ratified Phase-1
edge-suggestions item of the practical-DPAM improvement plan
(`researches/digital_product_concepts_review_research.md` §4 item 1.2,
packaged as this feature by the 2026-10-18 grilling addendum): staged,
server-generated `DEPENDS_ON` candidate edges per
[ADR-113](../../researches/adrs/ADR-113-staged-edge-suggestions.md), which
amends [ADR-019](../../researches/adrs/ADR-019-hierarchy-authoring-manual-for-v1.md)
— "manual" now means *human-decided*, assisted by staged candidates. No new
architecture decisions are needed; the persisted record shape, the four
statuses and their terminal semantics, the three v1 signals, merge and
suppression rules, the queue UX, and the permission model are all ratified.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Review and decide suggested dependencies (Priority: P1)

As a catalog maintainer, I want a dedicated Suggestions queue listing
candidate `DEPENDS_ON` edges — ranked by match strength and labeled with the
reason — so I can wire real dependencies with one click and dismiss wrong
guesses, instead of hunting through the component catalog and wiring one
edge at a time.

**Why this priority**: One-edge-at-a-time wiring is the top "without hassle"
gap (research H1/H3) — the meaning layer stays empty even when the factual
layer is rich. The review queue *is* the feature: everything else exists to
feed it trustworthy candidates.

**Independent Test**: With products and imported components in the catalog,
stage candidates (via the rescan action), then accept one suggestion and
dismiss another from the queue — the accepted pair becomes a real
`DEPENDS_ON` edge visible on the product's dependency list with a normal
audit entry; the dismissed pair never resurfaces. Delivers full value with
no automation beyond the initial staging.

**Acceptance Scenarios**:

1. **Given** pending candidates exist, **When** I open the Suggestions page,
   **Then** they are listed sorted by score descending, each row showing the
   product, the candidate component, and the reason it was suggested.
2. **Given** a pending candidate, **When** I accept it, **Then** a real
   `DEPENDS_ON` edge is created through the normal edge path — one audit
   entry attributed to me — and the candidate leaves the pending queue.
3. **Given** a pending candidate, **When** I dismiss it, **Then** it is
   permanently removed from the pending queue and can never resurface —
   there is no un-dismiss.
4. **Given** an accepted suggestion, **When** I view the product's
   dependencies, **Then** the new edge is indistinguishable from a manually
   wired one and behaves identically everywhere edges are read.
5. **Given** I hold a role without the edge-write permission, **When** I
   open the queue, **Then** I can read the candidates but cannot accept or
   dismiss them.
6. **Given** a pending candidate whose component no longer exists (or fails
   the normal edge rules), **When** I accept it, **Then** I see the normal
   error, no partial write occurs, and the candidate stays pending.

---

### User Story 2 - Candidates stage themselves as the catalog evolves (Priority: P2)

As a catalog maintainer, I want new candidates to materialize automatically
when importers land data or products change — without running anything
myself — so the queue always reflects the current catalog rather than a
stale snapshot, and so pairs I already wired or decided never come back.

**Why this priority**: Generation is what makes the queue trustworthy — a
queue that needs manual babysitting or that resurrects rejected pairs would
be worse than none. It ranks below the queue itself only because a one-shot
staging pass plus the review UI already delivers standalone value.

**Independent Test**: Import a component whose name matches an existing
product — after the run completes, a pending candidate appears with no user
action; wire a different pair manually — it never shows in the queue.

**Acceptance Scenarios**:

1. **Given** a successful importer run that creates or changes components,
   **When** the run completes, **Then** new `(product, component)` pairs
   that pass the match floor are staged as `PENDING` — no user action
   required.
2. **Given** a product is created or renamed, **When** the write completes,
   **Then** candidates for that product are (re)generated against existing
   components.
3. **Given** a component is created or renamed outside an importer run
   (e.g. a manually maintained SaaS component), **When** the write
   completes, **Then** it enters the candidate pool the same way.
4. **Given** a pair I previously decided (`ACCEPTED`, `DISMISSED`, or
   `SUPERSEDED`), **When** generation runs again, **Then** it never returns
   to `PENDING`.
5. **Given** a pair I wired manually (picker, bootstrap import, or bulk
   create), **When** the system observes the real edge, **Then** any pending
   candidate for it becomes `SUPERSEDED` and disappears from the queue.
6. **Given** a product that reaches a component through a `ComponentGroup`
   dependency (ADR-110), **When** candidates are generated, **Then** that
   pair is suppressed as covered — it never appears `PENDING`.
7. **Given** a real edge that is later removed, **When** generation runs,
   **Then** no candidate is regenerated for that pair — a deliberately
   unwired pair is a decision, not a regression.
8. **Given** a catalog populated before this feature existed (or between
   scheduled import runs), **When** I trigger the on-demand rescan,
   **Then** the queue populates from current stored data.

---

### User Story 3 - Inspect and explain past decisions (Priority: P3)

As a catalog maintainer (or a teammate reviewing my work), I want to see
what the system suggested, why, and who decided what and when — so the
queue is explainable and wiring decisions stay accountable.

**Why this priority**: `reason`, `score`, `decidedAt`, and `decidedBy` are
already recorded for machinery reasons; exposing them is cheap and builds
trust in the signals. Lower priority because the queue functions without a
history view.

**Independent Test**: Accept one candidate and dismiss another, then switch
the queue filter to dismissed — the dismissed row shows its reason, score,
decision timestamp, and decider; the accepted pair's edge carries a normal
audit entry naming me.

**Acceptance Scenarios**:

1. **Given** dismissed candidates exist, **When** I filter the queue to
   dismissed, **Then** each row shows the product, component, reason, score,
   who dismissed it, and when.
2. **Given** an accepted candidate, **When** I inspect the product's audit
   history, **Then** the dependency edge has a normal audit entry attributed
   to the accepting user — indistinguishable from manual wiring.
3. **Given** any candidate row, **When** I read its reason, **Then** it
   names the signal that produced it (name match, topic/tag match, or
   namespace match) — I never have to guess why it was suggested.

### Edge Cases

- **Pair wired while pending.** A pending pair wired by any other means —
  the dependency picker, bootstrap import (ADR-114), or the
  create-from-components fast path — transitions to `SUPERSEDED` at latest
  on the next generation pass; an accept racing that transition is
  idempotent and never creates a duplicate edge.
- **Deliberately unwired stays unwired.** Removing a real edge never
  regenerates a candidate — the pair remains terminal; the only way back is
  wiring it again.
- **Retired endpoints.** `RETIRED` products and `RETIRED` components are
  excluded from the candidate pool, and pending records whose product or
  component retires are suppressed from the default queue view; if the
  entity is reactivated the still-undecided record may resurface as
  `PENDING`.
- **Stale pending on a vanished endpoint.** Accepting a candidate whose
  product or component no longer satisfies the edge rules surfaces the
  normal edge-path error; the record stays `PENDING` — nothing half-writes.
- **Group coverage is transitive suppression.** A pending pair newly covered
  by a group edge — the component joined a depended-on group, or the group
  edge was added — is superseded on the next merge; the queue never suggests
  what the product already depends on.
- **Multiple signals, one row.** A pair matching several signals is still a
  single record; the displayed `reason` is the strongest contributing
  signal. Later passes may rescore or change the reason of a `PENDING`
  record but never its status.
- **Renames retrigger, not recreate.** Product or component renames rerun
  generation for that side's pairs; the pair identity `(productId,
  componentId)` is unchanged — no duplicate rows, decided pairs stay
  decided.
- **Failed or partial importer runs** do not stage candidates; only
  successful runs do.
- **Hard deletes clean up.** Deleting a product or component removes its
  candidate records — orphaned rows are never returned by the queue.

## Requirements *(mandatory)*

### Functional Requirements

**Staged candidate edges (ADR-113 §1–§4)**

- **FR-001**: The system MUST persist candidate edges — at most one record
  per `(product, component)` pair — each carrying a `reason`
  (`NAME_MATCH` | `TOPIC_TAG_MATCH` | `NAMESPACE_MATCH`), a `score`, a
  `status` (`PENDING` | `ACCEPTED` | `DISMISSED` | `SUPERSEDED`),
  `createdAt`, and — once decided — `decidedAt` and `decidedBy`.
- **FR-002**: Candidate generation MUST run server-side on triggers: after
  each successful importer run, on product create or rename, on component
  create or rename outside importer runs, and on demand via a rescan
  action. Generation is computed from stored catalog data only — importers
  are never invoked and the importer contract is untouched.
- **FR-003**: Generation MUST be merge-based: previously unseen qualifying
  pairs become `PENDING`; records in a terminal status (`ACCEPTED`,
  `DISMISSED`, `SUPERSEDED`) MUST never return to `PENDING`; still-pending
  records MAY be rescored or re-reasoned but never duplicated.
- **FR-004**: The v1 signals MUST be computed from stored data only:
  (a) name/token containment between the product's name and the component's
  name or slug; (b) matches between the product's tags or name tokens and
  the component's tags or imported `details.topics`; (c) token match on a
  Kubernetes component's imported `details.namespace`. Each candidate
  records the reason of its strongest contributing signal; pairs below the
  score floor are never staged.
- **FR-005**: Candidates MUST be `DEPENDS_ON` candidates from a product to
  a concrete component only — no `ComponentGroup` targets, no `COMPOSES` or
  `CONSUMES_FROM` candidates, no component→component suggestions.
- **FR-006**: Covered pairs MUST be suppressed: a pair with an existing
  real `DEPENDS_ON` edge is `SUPERSEDED`, and a pair the product already
  reaches through a `ComponentGroup` dependency (ADR-110 expansion) is
  treated as covered and never appears `PENDING`. Once a pair has been a
  real edge — wired by any means — it MUST never regenerate as a pending
  candidate, including after that edge is removed.
- **FR-007**: The candidate pool MUST exclude `RETIRED` products and
  `RETIRED` components, and pending records MUST be suppressed from the
  default queue view while either endpoint is retired.

**Suggestions queue**

- **FR-008**: The system MUST provide a reviewable queue listing `PENDING`
  candidates sorted by score descending, each row identifying the product,
  the candidate component, the `reason`, and the `score`; a filter MUST
  expose `DISMISSED` records for inspection with their `decidedAt` /
  `decidedBy`.
- **FR-009**: Reading the queue MUST be available to any authenticated
  role; accept and dismiss MUST require the edge-write permission
  (EDITOR+) — the queue surface respects the role's capabilities
  (read-only for VIEWER).
- **FR-010**: Accepting a candidate MUST create the real `DEPENDS_ON` edge
  through the existing edge-add path — same validation, same audit entry,
  attributed to the deciding user — and MUST NOT use a parallel write path.
  A successful accept marks the record `ACCEPTED`; if the pair already
  became a real edge the operation is idempotent (no duplicate edge) and
  the record is `SUPERSEDED`.
- **FR-011**: If edge creation fails, the normal error MUST surface to the
  user, nothing partial MUST be written, and the record MUST remain
  `PENDING`.
- **FR-012**: Dismissing a candidate MUST mark it `DISMISSED` permanently —
  there is no un-dismiss transition; recovering the pairing is manual
  wiring only. The record keeps `decidedAt`/`decidedBy` for inspection.
- **FR-013**: A dedicated Suggestions page MUST be reachable from the
  primary navigation, follow the standard list-page anatomy (filter bar,
  state matrix, empty state) and badge/color conventions, and offer
  per-row accept/dismiss actions to permitted users.

**Cross-cutting**

- **FR-014**: An on-demand rescan action MUST exist so catalogs populated
  before this feature (or between import runs) can populate the queue
  without waiting for a scheduled run; it MUST require the edge-write
  permission (EDITOR+).
- **FR-015**: `docs/openapi.yaml` MUST be updated in the same change for
  every added/modified endpoint (ADR-104), and `docs/digital-products.md`
  MUST describe the suggestion lifecycle and review flow.
- **FR-016**: The feature MUST NOT change importer behavior or the importer
  contract and MUST NOT auto-create edges — every real edge requires an
  explicit human accept (constitution V, ADR-056/057, ADR-113 §8).

### Key Entities

- **Candidate edge** (`edge_suggestions` record): the persisted staged pair
  `(productId, componentId)` — unique per pair — carrying `reason`,
  `score`, `status`, `createdAt`, `decidedAt`, `decidedBy`. `PENDING` is
  the only live state; the other three are terminal.
- **Reason**: the signal label on a candidate — `NAME_MATCH`,
  `TOPIC_TAG_MATCH`, or `NAMESPACE_MATCH` — explaining why the pair was
  suggested; display-only.
- **DEPENDS_ON edge**: the real product→component edge an accept creates —
  identical to a manually wired edge in every respect.
- **Generation trigger**: the events that (re)compute candidates —
  successful importer run, product create/rename, component create/rename,
  and the on-demand rescan.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Wiring a suggested dependency takes one click from the queue
  — a maintainer can review and decide 50 pending candidates in under 10
  minutes, versus ~50 picker round-trips today.
- **SC-002**: Within one minute of a successful importer run completing,
  its newly staged candidates are visible in the queue with zero user
  action; a fresh rescan over a 10k-component catalog completes in under 1
  minute.
- **SC-003**: Across repeated generation passes, 0 previously-decided
  pairs return to pending — decided means decided.
- **SC-004**: 100% of accepted candidates produce real edges through the
  standard edge path with standard audit entries, and 0 edges are ever
  created without an explicit human accept.
- **SC-005**: 0 pending candidates are shown for pairs already wired
  directly or already covered through a group dependency.
- **SC-006**: Every queued candidate answers "why was this suggested?" —
  100% carry a named reason the user can see without leaving the page.
- **SC-007**: The queue is safe under stale data — accepts on vanished or
  ineligible endpoints surface a normal error with 0 partial writes and
  the candidate preserved.

## Assumptions

- Score weighting and the match floor are tuning decisions settled in
  planning; `reason` is a display label, not a user-configurable taxonomy.
- Candidate records have no TTL in v1 — rows persist until the pair is
  decided or an endpoint is hard-deleted.
- UI scope is the dedicated queue page: no per-product suggestion section,
  no dashboard card, and no bulk accept/dismiss in this feature — review is
  deliberately one decision at a time; bulk affordances can be reconsidered
  once signal precision is observed in the field.
- The rescan action is whole-catalog; per-product or per-importer rescans
  are out of scope.
- Signals are read-only over stored import data — no live calls to external
  sources. Importer `details` enrichment (e.g. richer Kubernetes labels) is
  an independent follow-up, not a prerequisite (ADR-113 §4).
- Importer-declared candidate edges remain a distinct v2 mechanism
  (constitution V); this feature generates candidates server-side only.
