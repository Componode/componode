# Research & Design Decisions: Edge Suggestions

**Feature**: `022-edge-suggestions` | **Date**: 2026-10-19

Phase 0 output. All decisions here implement ratified ADR-113; nothing below
re-decides what the ADR fixed (record shape, statuses, signals, merge
semantics, suppression, permissions, queue UX). These entries resolve the
*how* the spec deliberately left open.

## Decision 1 — Tombstone rows make "never regenerate" implementable

**Decision**: Every successful `DEPENDS_ON` write — single, bulk, or group
form — upserts an `edge_suggestions` row for the affected pair(s) with
`status='SUPERSEDED'`, even when no candidate row previously existed. For
group targets, one tombstone per current member pair. Rows created this way
have `reason = NULL`, `score = NULL`, `decidedAt = now()`,
`decidedBy = actor.id`.

**Rationale**: ADR-113 requires "deleted real edges never regenerate a
suggestion." Without a persistent record that the pair *was* wired, a later
generation pass cannot distinguish "never suggested" from "deliberately
unwired" — audit history is the wrong store to query for this. A tombstone
on the wire path is cheap (edges are human-frequency writes), atomic with
the edge insert, and makes the terminal-state guarantee airtight regardless
of when generation runs relative to wiring.

**Alternatives considered**: marking only existing `PENDING` rows
SUPERSEDED — rejected: pairs wired before first generation (or between
passes) would regenerate after edge removal, violating the ADR. Checking
`edge_changes` audit at generation time — rejected: audit is append-only
history, not a queryable pair state; ordering ambiguity (add→remove→add)
makes it fragile. A separate `wired_pairs` tombstone table — rejected: two
stores for one pair-lifecycle; the single table already has the unique
constraint the invariant needs.

## Decision 2 — Generation is a batched in-memory signal pass, scoped by trigger

**Decision**: `generateSuggestions(scope)` accepts
`{productId}` | `{componentIds[]}` | `{all}`. It loads the in-scope active
entities in a handful of queries (products once; components in scope; the
two dependency junctions; existing suggestion rows for affected pairs),
computes signals in TypeScript, and applies the merge in one batch upsert
plus one batch tombstone upsert. Triggers:

| Trigger | Scope |
|---|---|
| Importer run `COMPLETED` | `componentIds` = `yieldedComponentIds` |
| Product create / rename | `productId` |
| Component rename (`updateComponent`) | `componentIds` = `[id]` |
| Component group move (`componentGroupId` change) | coverage re-eval only |
| `POST /suggestions/rescan` | `all` |

All trigger calls are **awaited but failure-isolated** (try/catch →
structured log + metric, never rethrow): a suggestion bug must never flip
an import run or reject a product write. Awaiting (rather than
fire-and-forget) keeps tests deterministic and the SC-002 latency bound
measurable.

**Rationale**: Signals are string/token logic — far easier to test in TS
than in SQL. Scoped triggers keep steady-state passes small; only rescan
walks the full matrix, bounded by the <1 min SC-002 target.

**Alternatives considered**: SQL-side scoring with `ILIKE`/array overlap —
rejected: tokenization and multi-signal weighting get unreadable in SQL and
untestable in isolation. A persistent job queue — rejected: no such
infrastructure exists (the run worker uses an in-process `p-queue`), and
generation is idempotent so a retry story adds nothing.

## Decision 3 — Signals, scoring, and floor

**Decision**:

- `tokenize(value)`: lowercase, split on `[^a-z0-9]+`, drop tokens `< 2`
  chars and stop-words (`api`, `svc`, `service`, `app`, `the`, `and`,
  `for`, `com`, `org`, `net`, `io`, `dev`). Product tokens come from
  `name` only (the product slug is not a signal source — FR-004 names
  the product *name* and *tags*); component tokens from `name` + `slug`.
- `NAME_MATCH`: product token set vs component token set — `1.0` if either
  set fully contains the other; `0.5` if they share ≥1 token.
- `TOPIC_TAG_MATCH`: union of product `tags` + product name tokens vs union
  of component `tags` + `details.topics` (when array of strings) — `0.5`
  for the first overlap, `+0.1` per additional, cap `0.8`.
- `NAMESPACE_MATCH`: product tokens vs `details.namespace` tokens (k8s
  components) — `0.6` on ≥1 shared token.
- Multi-signal pairs keep the strongest signal's `reason` and score
  `best + 0.05` per extra signal (cap `+0.1`).
- **Floor: `score >= 0.5`** — stages full name containment, any name-token
  overlap, namespace matches, and ≥1 tag/topic hits; excludes nothing among
  the ratified signals but blocks single-char/degenerate token noise.

**Rationale**: Weights rank "the product IS this component's name" above
"shares a namespace" above "shares a tag" — matching how a maintainer
judges candidates. The 0.5 floor means the weakest staged row still carries
a concrete name/token or namespace overlap; topic-only hits below floor
don't exist (first hit already = 0.5).

**Alternatives considered**: Jaccard/TF-IDF scoring — rejected: no corpus
statistics worth the complexity at catalog scale. Configurable
weights/floor — rejected: ratified as constants in `core`; tuning is a
code change, not user config (spec Assumptions).

## Decision 4 — Merge, suppression, and coverage rules

**Decision**: A generation pass produces three sets and applies them in
order:

1. **Covered pairs** — pairs with a row in `product_depends_on_component`,
   plus pairs where the component's `componentGroupId` is targeted by a
   `product_depends_on_component_group` edge from the same product → upsert
   `SUPERSEDED` tombstone (idempotent).
2. **New/refresh pairs** — signal hits above floor → `INSERT ... ON
   CONFLICT (productId, componentId) DO UPDATE SET score, reason WHERE
   status='PENDING'`. Terminal rows are never touched.
3. Terminal rows are read for exclusion only — never mutated.

Pending rows for pairs that *stop* matching are left alone (scores may fall
below floor on rename — the row stays `PENDING` until decided or covered;
the queue still shows it at its recorded score). This is deliberate: a
generated candidate is a human's decision to make, not the system's to
un-make.

**Rationale**: Coverage-as-tombstone means the suppression invariant holds
even when group membership changes between passes (member joins a
depended-on group → next pass tombstones the pair; the group-move trigger
re-evaluates immediately). Read-side lifecycle filtering (join-exclude
`RETIRED` endpoints) handles retire/restore without mutating rows.

## Decision 5 — Accept / dismiss mechanics

**Decision**:

- **Accept**: load row → `404 NOT_FOUND` if absent, `409 CONFLICT` if not
  `PENDING` → call existing `addDependsOnEdge(productId, {componentId},
  actor)` unchanged → `UPDATE ... SET status='ACCEPTED', decidedAt,
  decidedBy WHERE id AND status='PENDING'`. Edge-path errors (e.g. component
  gone → `404 NOT_FOUND`) propagate; the row stays `PENDING`. The
  `WHERE status='PENDING'` guard means a concurrent tombstone (pair wired
  another way mid-accept) wins — final state `SUPERSEDED`, no duplicate
  edge.
- **Dismiss**: `UPDATE ... SET status='DISMISSED', decidedAt, decidedBy
  WHERE id AND status='PENDING'` → `404`/`409` as above. No un-dismiss.
- `decidedBy` stores `actor.id` (`persons` FK, `SET NULL`) — same
  convention as `createdBy`/`updatedBy` columns elsewhere.

**Rationale**: Reusing `addDependsOnEdge` keeps one write path — validation,
audit entry (`writeEdgeChange`), and the new tombstone upsert all come for
free; no parallel edge-write path exists to drift.

## Decision 6 — API shape and permissions

**Decision**: New route module `routes/suggestions.ts` under `/api/v1`:

- `GET /suggestions?status=&limit=&offset=` — `verifySession` only (any
  authenticated role); `status` defaults `PENDING`, accepts `DISMISSED`;
  offset pagination (low-cardinality per ADR-080 — the floor keeps the
  queue bounded); sort `score DESC, createdAt ASC, id` for pending,
  `decidedAt DESC` for dismissed. Pending rows join-exclude `RETIRED`
  endpoints; row payload embeds `{id,name,slug}` refs of both sides.
- `POST /suggestions/{id}/accept` — `requireRole("product:edge:add")`.
- `POST /suggestions/{id}/dismiss` — `requireRole("product:edge:add")`.
- `POST /suggestions/rescan` — `requireRole("product:edge:add")`; runs the
  `{all}` pass synchronously and returns
  `{productsScanned, componentsScanned, staged, superseded}`.

**Rationale**: ADR-113 §7 names "the edge-write permission" — reusing
`product:edge:add` for all three writes avoids a new permission for what is
literally an edge decision, and keeps the ADR-104 contract test simple.

**Alternatives considered**: a dedicated `suggestion:decide` permission —
rejected: the ADR explicitly ties the queue to the edge-write permission;
splitting would let someone dismiss without being able to accept, a
capability no one asked for. Async rescan with a job id — rejected: SC-002
bounds the pass at <1 min; synchronous keeps the UX and tests trivial.

## Decision 7 — Queue page UX

**Decision**: `/suggestions` page + "Suggestions" item in the sidebar
Catalog section (below Component Groups). Standard list-page anatomy:
header with count + "Rescan" action (EDITOR+ only), status filter
(Pending default / Dismissed), rows showing product link, "depends on",
component link + category badge, reason chip (`Name match` /
`Topic/tag match` / `Namespace match` — natural-language, never the enum),
and score. Accept/Dismiss icon buttons per row for EDITOR+; dismiss opens a
confirm dialog (permanent action — ux.md §7). Empty state per the state
matrix ("No pending suggestions — rescan or wait for the next import").
TanStack Query keys `["suggestions", status]`; accept also invalidates the
product's dependency queries.

**Rationale**: Follows the platform-candidates worklist precedent
(`platform-candidates.tsx`) — read for all roles, action gated by role —
and the ux.md state matrix and badge conventions.

## Non-goals confirmed

- Importer-declared candidates (v2 per constitution V) — untouched.
- `ComponentGroup`/`COMPOSES`/`CONSUMES_FROM` candidates — out of scope.
- Per-product suggestion section, dashboard card, bulk accept/dismiss —
  deferred by spec Assumptions.
- Signal config UI, per-entity rescans — out of scope.
