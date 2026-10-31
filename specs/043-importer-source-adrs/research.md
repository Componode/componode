# Phase 0 Research — Ownership Mapping and Amendment Decisions

**Feature**: 043-importer-source-adrs | **Date**: 2026-10-31

Resolves the "which ADR owns which contract surface" question for every
item in the Phase-0 checklist, plus the mechanical decisions (numbering,
amendment format, review outcomes for the maybe-amend ADRs).

## Decision 1 — New ADR owns ImporterSource

**Decision**: Create `ADR-119-importer-source-identity-and-lifecycle.md`.

**Rationale**: No existing ADR owns a "source" concept. ADR-040 covers
`importer_configs` storage; ADR-047 covers deletion semantics; neither
owns a durable provenance entity between config and catalog. A new ADR
follows the ADR-116 precedent (new ratified decision listing its
"Amendments to earlier ADRs").

**Alternatives considered**: Folding the Source model entirely into
ADR-036/047 amendments — rejected: the entity + lifecycle + membership
model is a first-class decision, not a refinement of reconciliation or
deletion alone.

**ADR-119 owns**:

- `ImporterSource` entity: durable internal UUID v7 record; provider-native
  canonical external identity; non-secret identity rule; internal
  provenance, not a catalog Component.
- Lifecycle: `ACTIVE` / `UNMONITORED` / `RETIRED`; explicit reversible
  retirement; reactivation when the same provider identity returns.
- Binding: one active `ImporterConfig` per Source; config replacement may
  reattach the same Source; deleting the config → `UNMONITORED`, Source +
  history preserved.
- Source memberships: durable Source→Component and
  Source→ComponentInstance records, independent of `lastSeenInRunId`;
  source-specific details live on the membership, shared facts on
  `Component.details`.
- Run attribution: `import_runs.sourceId` durable; `configId` nullable,
  `ON DELETE SET NULL` — history survives config deletion.
- Source-scoped retirement semantics (shared Component stays ACTIVE while
  any Source reports it; retirement only when no active membership).
- Source-identity reporting contract: reported before asset yield,
  including empty inventories; provider-native key preference order
  (`/info.ID`-style native ID → account/subscription/org ID → canonical
  URL → admin-supplied stable key; never display-name matching).
- Generic target resolution: `manifest.targetRefKey` names the config
  scope key carrying `targetId`; typed resolver on importer context;
  provider-agnostic (Docker is first adopter).
- `LEGACY_UNATTRIBUTED` boundary: ratify the conservative stance —
  existing rows stay unattributed until each importer's named migration
  wave; never auto-split/merge/rekey.

## Decision 2 — Amend ADR-036 (reconciliation scope)

**Decision**: `## Amendment 1 — Source-scoped reconciliation (2026-10-31,
via ADR-119)`.

**Rationale**: ADR-036's phase-2 is "components previously touched by this
importer config." The new model retires by _source membership_, not by
config touch — a shared Component reported by two Sources survives the
loss of one. The config→source scope change amends the closed surface.

**Amendment owns**: phase-1 orphaning scoped to the Source's instance
memberships; phase-2 retirement gated on `COMPLETED` AND scoped to the
reporting Source's memberships; the "no active membership ⇒ retire" rule.

## Decision 3 — ADR-037/038: review outcome is a back-pointer only on 037

**Decision**: ADR-037 gets `**Amended by ADR-119**` noting that the
phase-2 it gates is now source-membership-scoped (no behavioral change to
the commit strategy itself). ADR-038 (run-level restart) needs no change —
resume semantics are untouched.

**Rationale**: FR-008 requires each reviewed ADR to get an amendment or a
recorded "no change needed." ADR-037 references "phase-2 reconciliation
(ADR-036)" — the pointer stays accurate, but the gating invariant deserves
the one-line back-pointer for traceability. ADR-038 genuinely unchanged.

## Decision 4 — Amend ADR-047 (deletion model)

**Decision**: `## Amendment 1 — Importer config deletion preserves Source
and run history (2026-10-31, via ADR-119)`.

**Rationale**: ADR-047 lists `importer_configs` and `import_runs` as
hard-deletable. That stays true _as records_, but config deletion now
carries a cascade contract: `import_runs.configId → NULL`, Source →
`UNMONITORED`, memberships and run history preserved. This refines (does
not reverse) hard-delete.

## Decision 5 — Amend ADR-056 (importer interface)

**Decision**: `## Amendment 1 — Source identity reporting and target
resolution (2026-10-31, via ADR-119)`.

**Rationale**: ADR-056 owns `run(config, secrets, context)`. The context
gains `reportSourceIdentity(identity)` and `resolveTarget(targetId)`;
`ImporterManifest` gains `targetRefKey`. Enumerated contract surface →
amendment per ADR fidelity rule.

## Decision 6 — Amend ADR-065 (package graph)

**Decision**: `## Amendment 1 — Docker importer joins the lockstep set
(2026-10-31, via ADR-119)`.

**Rationale**: The importer set is an enumerated closed surface
("all 7 importer packages" — now 8 with alibaba-cloud; 9th incoming). The
amendment ratifies that `@componode/importer-docker` will join the
hub+agent aggregator set and states explicitly the package ships in a
later spec — contract ratified now, code later.

## Decision 7 — Amend ADR-077 (v1 entity schema)

**Decision**: `## Amendment 2 — ImporterSource tables and run attribution
(2026-10-31, via ADR-119)`.

**Rationale**: ADR-077 is the consolidated schema ADR; the future
migration adds `importer_sources`, source-membership tables, and the
`import_runs` column/FK changes. Recording it here keeps the schema ADR
the complete inventory. (Amendment 1 already exists — teams.lobId.)

## Decision 8 — Amend ADR-116 (remote agents)

**Decision**: `## Amendment 5 — Agent-local target registry and preflight
(2026-10-31, via ADR-119)`.

**Rationale**: ADR-116 owns the Agent execution boundary and already uses
numbered amendments (currently through Amendment 4). The target registry
(`{SECRETS_DIR}/<name>-targets.json` convention, versioned, read-only,
immutable `targetId`), resolver-mediated access, and fail-before-network
preflight extend that boundary generically — Docker named as first
adopter only.

## Decision 9 — ADR-106/117 review outcome

**Decision**: No amendments. ADR-117's `AGENT_MANAGED` credential
mechanism is reused unchanged — target profiles _reference_ credential
bundles; they do not redefine them. ADR-106 is a dated hardening
assessment, not an enumerated contract surface; target-registry egress
guidance lives in the ADR-116 amendment.

**Recorded per FR-008**: both reviews concluded "no change needed" with
this note as the record.

## Decision 10 — Amendment mechanics

- Amended ADRs get `## Amendment N — <title> (2026-10-31, via ADR-119)`
  plus a `---` + `**Amended by ADR-119**:` back-pointer at file end
  (precedents: ADR-087 amendments; ADR-065's ADR-116 back-pointer).
- ADR-119 gets `**Amendments to earlier ADRs**:` list matching actual
  edits (precedent: ADR-116).
- Index rows: ADR-119 added under "Session 2 — Architecture" table
  (importer-framework adjacent) or a new row noting "(amends ADR-036,
  037, 047, 056, 065, 077, 116)" following the ADR-116 index style;
  existing rows gain amendment annotations where the index already tracks
  them (e.g., ADR-047, ADR-054 style).
