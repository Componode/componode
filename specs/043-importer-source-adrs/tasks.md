# Tasks: Importer Source ADR Ratification

**Input**: Design documents from `/specs/043-importer-source-adrs/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/decision-surfaces.md, quickstart.md

**Tests**: Docs-only feature — no executable test tasks. Verification is the quickstart.md textual checklist (T019).

**Organization**: Tasks grouped by user story. ADR-119 (Foundational) must exist before amendments can cite "via ADR-119".

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Different files, no dependencies on incomplete tasks
- **[Story]**: US1 = ImporterSource lifecycle contract, US2 = importer/Agent contract, US3 = navigable decision record

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Confirm the mechanics before authoring

- [x] T001 Confirm next free ADR number by listing `researches/adrs/` (expected ADR-119; adjust all downstream "ADR-119" references if different) and re-read amendment-format precedents in `researches/adrs/ADR-087-*.md` and `researches/adrs/ADR-116-remote-import-agents.md`
- [x] T002 [P] Re-read the full current text of every ADR to be touched — `researches/adrs/ADR-036-two-phase-reconciliation-scope.md`, `ADR-037-importer-run-commit-strategy.md`, `ADR-047-deletion-model.md`, `ADR-056-importer-interface-signature.md`, `ADR-065-package-dependency-graph.md`, `ADR-077-v1-entity-schema.md`, `ADR-116-remote-import-agents.md` — and note the exact section each amendment must resolve (per `contracts/decision-surfaces.md`)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The new ADR must exist before any amendment can cite it

**⚠️ CRITICAL**: No amendment/back-pointer work can begin until ADR-119 exists

- [x] T003 Create `researches/adrs/ADR-119-importer-source-identity-and-lifecycle.md` — `> **Status:** Ratified` — ratifying: `ImporterSource` durable UUID v7 record with provider-native canonical non-secret external identity (preference order: native ID → account/subscription/org ID → canonical URL → admin-supplied stable key; never display-name matching); `ACTIVE`/`UNMONITORED`/`RETIRED` lifecycle with explicit reversible retirement and reactivation on same-identity return; one active `ImporterConfig` per Source with reattachment on config replacement; durable Source→Component and Source→ComponentInstance memberships independent of `lastSeenInRunId` (source-specific details on the membership, shared facts on `Component.details`); `import_runs.sourceId` durable + `configId` nullable `ON DELETE SET NULL`; source-identity reporting before asset yield including empty inventories; generic `manifest.targetRefKey` + `context.resolveTarget` contract (provider-agnostic, Docker first adopter); `LEGACY_UNATTRIBUTED` stance (no auto-split/merge/rekey, per-importer migration waves). Close with `**Amendments to earlier ADRs**:` listing ADR-036, ADR-037, ADR-047, ADR-056, ADR-065, ADR-077, ADR-116 (precedent: ADR-116)

**Checkpoint**: ADR-119 exists and standalone-answers the spec's lifecycle/config-deletion/identity questions

---

## Phase 3: User Story 1 — Ratified ImporterSource lifecycle contract (Priority: P1) 🎯 MVP

**Goal**: Source lifecycle, membership, reconciliation-scope, and run-retention decisions ratified in the ADR corpus

**Independent Test**: The spec's US1 acceptance questions (config deletion → UNMONITORED + preserved history; shared-Component retirement rule; source-identity reporting) are answerable reading only `researches/adrs/` files

- [x] T004 [P] [US1] Append `## Amendment 1 — Source-scoped reconciliation (2026-10-31, via ADR-119)` to `researches/adrs/ADR-036-two-phase-reconciliation-scope.md`: phase-1 orphaning scopes to the reporting Source's instance memberships; phase-2 remains gated on `COMPLETED` but retires only when no active Source membership remains; incomplete runs never retire. Then append `---` + `**Amended by ADR-119**: …` back-pointer at file end
- [x] T005 [P] [US1] Append `---` + `**Amended by ADR-119**: the phase-2 reconciliation gated on COMPLETED (below) is now scoped to source memberships rather than config touch — see ADR-036 Amendment 1` back-pointer to `researches/adrs/ADR-037-importer-run-commit-strategy.md` (commit strategy itself unchanged)
- [x] T006 [P] [US1] Append `## Amendment 1 — Importer config deletion preserves Source and run history (2026-10-31, via ADR-119)` to `researches/adrs/ADR-047-deletion-model.md`: `importer_configs`/`import_runs` remain hard-deletable records, but config deletion now cascades — `import_runs.configId → NULL`, Source → `UNMONITORED`, memberships + run history preserved; explicit Source retirement is separate. Then append `**Amended by ADR-119**: …` back-pointer
- [x] T007 [P] [US1] Append `## Amendment 2 — ImporterSource tables and run attribution (2026-10-31, via ADR-119)` to `researches/adrs/ADR-077-v1-entity-schema.md`: records that the schema gains `importer_sources`, Source→Component and Source→ComponentInstance membership tables, and `import_runs.sourceId` durable + `configId` nullable `ON DELETE SET NULL` (implementation lands in the ImporterSource core spec). Then append `**Amended by ADR-119**: …` back-pointer

**Checkpoint**: US1 independently verifiable — lifecycle/deletion/reconciliation answers live in ratified ADR text

---

## Phase 4: User Story 2 — Ratified importer contract and Agent target boundary (Priority: P2)

**Goal**: Source-identity reporting, targetRefKey/resolver, Agent target registry, and lockstep-set changes ratified

**Independent Test**: The spec's US2 acceptance questions (how scope references a remote target; where profiles live; malformed-profile behavior) are answerable reading only `researches/adrs/` files

- [x] T008 [P] [US2] Append `## Amendment 1 — Source identity reporting and target resolution (2026-10-31, via ADR-119)` to `researches/adrs/ADR-056-importer-interface-signature.md`: `context` gains `reportSourceIdentity(identity)` (called before first asset yield; required even for empty inventories) and `resolveTarget(targetId)` returning the typed target profile; `ImporterManifest` gains optional `targetRefKey` naming the scope key that carries `targetId`. Then append `**Amended by ADR-119**: …` back-pointer
- [x] T009 [P] [US2] Append `## Amendment 5 — Agent-local target registry and preflight (2026-10-31, via ADR-119)` to `researches/adrs/ADR-116-remote-import-agents.md`: versioned read-only `{SECRETS_DIR}/<name>-targets.json` registry; immutable `targetId` (endpoint/transport change = new profile ID); Agent validates and resolves the profile before importer execution; unknown/malformed profiles fail before network access while the Agent stays ready for other importers; provider-agnostic with Docker as first adopter; target profiles may reference `AGENT_MANAGED` credential bundles (ADR-117 mechanism unchanged). Then append `**Amended by ADR-119**: …` back-pointer
- [x] T010 [P] [US2] Append `## Amendment 1 — Docker importer joins the lockstep set (2026-10-31, via ADR-119)` to `researches/adrs/ADR-065-package-dependency-graph.md`: `@componode/importer-docker` is admitted to the hub+agent manifest-import aggregator set (the "all importer packages" lockstep under ADR-116), explicitly stated as contract-ratified-now/package-ships-later; also corrects the stale "7 importer packages" count to reflect the current 8. Then append `**Amended by ADR-119**: …` back-pointer

**Checkpoint**: US2 independently verifiable — contract/registry/lockstep answers live in ratified ADR text

---

## Phase 5: User Story 3 — Consistent, navigable decision record (Priority: P3)

**Goal**: Index updated, back-pointers complete, vocabulary surfaces synced, review outcomes recorded

**Independent Test**: `researches/architecture-decisions.md` accounts for every new/amended ADR; each amended ADR has a back-pointer; ADR-119's amends-list matches reality

- [x] T011 [P] [US3] Update `researches/architecture-decisions.md`: add the ADR-119 index row (Session 2 — Architecture table, annotating "amends ADR-036, 037, 047, 056, 065, 077, 116" per the ADR-116 index style); annotate the ADR-036/047/056/065/077/116 rows with their new amendment references consistent with existing annotation style; update the header session line to record the 2026-10-31 ImporterSource ratification
- [x] T012 [P] [US3] Update `CONTEXT.md`: add **ImporterSource** term (durable provenance entity, distinct from ImporterConfig and from catalog Components; `Avoid:` guidance e.g. "source" alone, "connection"), **Source membership** term, and **Target profile**/`targetId` term near the existing Importer/Import Agent definitions
- [x] T013 [P] [US3] Update `AGENTS.md`: sync the "Importer contract" bullet (importers report source identity before yield via the context callback; reconciliation is source-scoped) and the deletion-related guidance to match amended ADR-036/047, keeping the normative rule style of surrounding bullets
- [x] T014 [P] [US3] Record the FR-008 review outcomes in ADR-119's Context or a closing note: ADR-038 unchanged (resume semantics untouched), ADR-106 unchanged (dated assessment, not an enumerated surface), ADR-117 unchanged (`AGENT_MANAGED` reused, not redefined) — and verify ADR-119's "Amendments to earlier ADRs" list matches the edits actually made
- [x] T015 [US3] Cross-check `contracts/decision-surfaces.md` row-by-row against the final ADR corpus: every surface resolves to existing ratified text; fix any drift in either direction

**Checkpoint**: SC-002/SC-003 verifiable — bidirectional links complete, index covers 100% of touched ADRs

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Validation + housekeeping

- [x] T016 Update `researches/docker-importer-implementation-tracking.md`: tick the Phase-0 checklist items now ratified (with the ADR numbers they landed in) so the tracker reflects the shipped state
- [x] T017 [P] Run `pnpm prettier --check` on every touched Markdown file and fix formatting
- [x] T018 Walk `quickstart.md` steps 1–6: surface coverage, back-pointer completeness, index sync, vocabulary sync, acceptance walk-through, formatting — record pass/fail per step
- [x] T019 Final spec-compliance sweep: re-read `spec.md` FR-001..FR-012 and SC-001..SC-005; confirm FR-011 held (zero files under `packages/` modified — `git diff --name-only` shows only `researches/`, `specs/`, `CONTEXT.md`, `AGENTS.md`)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies
- **Foundational (Phase 2)**: Depends on Setup — BLOCKS all story phases (amendments cite "via ADR-119")
- **US1 (Phase 3) / US2 (Phase 4)**: Both depend on T003; independent of each other — all tasks within each are [P]
- **US3 (Phase 5)**: Depends on US1+US2 (index/vocabulary describe the finished amendments)
- **Polish (Phase 6)**: Depends on all stories

### User Story Dependencies

- **US1 (P1)**: Reconciliation + deletion + schema amendments — needs ADR-119 only
- **US2 (P2)**: Contract + Agent + lockstep amendments — needs ADR-119 only
- **US3 (P3)**: Index/vocabulary/verification — needs US1+US2 complete

### Parallel Opportunities

- T002's per-ADR reads are parallelizable
- T004–T007 (US1) touch different files — all parallel
- T008–T010 (US2) touch different files — all parallel
- T011–T014 (US3) touch different files — all parallel

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phases 1–2 (ADR-119 authored)
2. Phase 3 (US1 amendments) → validate US1's acceptance scenarios alone
3. Continue to US2/US3

### Incremental Delivery

ADR-119 → US1 (lifecycle core) → US2 (contract/Agent) → US3 (navigation/vocab) → polish. Each phase leaves the corpus internally consistent.

---

## Phase 7: Review

- [x] T020 Add the missing ADR-035 back-pointer (`code-review: standards`, HIGH): append `---` + `**Amended by ADR-119**:` to `researches/adrs/ADR-035-instance-reconciliation-orphan-missing-instances.md` noting its orphan→GONE rule is now source-membership-scoped per ADR-036 Amendment 1; add ADR-035 to ADR-119's `**Amendments to earlier ADRs**:` list; annotate the ADR-035 row in `researches/architecture-decisions.md`
- [x] T021 Define the allowlist mechanism in ADR-116 Amendment 5 (`code-review: spec`, HIGH — FR-006 partial): edit `researches/adrs/ADR-116-remote-import-agents.md` Amendment 5 so the target registry file itself is stated as the allowlist (a `targetId` absent from the versioned read-only registry is rejected), with named-Context mode additionally requiring an explicit allowed-context list on the Agent
- [x] T022 Fix ADR-065 back-pointer format (`code-review: standards`, MEDIUM — FR-010): restructure the file end so `## Amendment 1` precedes a single `---` followed by both back-pointers (`**Amended by ADR-116**` then `**Amended by ADR-119**`), matching the trailing back-pointer convention in `researches/adrs/ADR-065-package-dependency-graph.md`
- [x] T023 Give ADR-037 a real Amendment section (`code-review: spec`, MEDIUM — FR-010): replace the bare `**Amended by ADR-119**` block in `researches/adrs/ADR-037-importer-run-commit-strategy.md` with `## Amendment 1 — Phase-2 scope becomes membership-scoped (2026-10-31, via ADR-119)` (Context: ADR-036 Amendment 1 changed what phase-2 reconciles; Refinement: commit strategy and COMPLETED gate unchanged, scope pointer updated) followed by the back-pointer
- [x] T024 Fix the stale count claim in ADR-065 Amendment 1 (`code-review: spec`, MEDIUM): reword the amendment so it no longer claims to correct the decision text in place — instead state plainly that "all 7 importer packages" in the original decision is stale (8 in-tree today with alibaba-cloud/ADR-115) and the ratified set becomes 9 when `@componode/importer-docker` ships
- [x] T025 Update stale numbering note in `researches/docker-importer-implementation-tracking.md` (`code-review: standards`, LOW): the tracking file says "highest used is `042` … expected to be `043`" — Phase 0 shipped as 043, so the next free number is now 044

---

## Phase 8: Review

- [x] T026 Fix stale "(back-pointer)" label for ADR-037 (`code-review: standards`, HIGH): ADR-037 now has a real `## Amendment 1` — update its entry in ADR-119's `**Amendments to earlier ADRs**:` list in `researches/adrs/ADR-119-importer-source-identity-and-lifecycle.md` and the tracking file line in `researches/docker-importer-implementation-tracking.md` that still says ADR-037 "carries a back-pointer"
- [x] T027 Sync `docs/roadmap.md` (`code-review: standards`, HIGH — AGENTS.md roadmap-sync rule): add `043-importer-source-adrs` under **Shipped** and revise the **Next** entry so it names the ImporterSource core / staged importer migration / Docker waves as the queued program
- [x] T028 Add the missing blank line before `## Amendment` headings (`code-review: standards`, MEDIUM): `researches/adrs/ADR-035-instance-reconciliation-orphan-missing-instances.md`, `ADR-047-deletion-model.md`, `ADR-077-v1-entity-schema.md`
- [x] T029 Ratify where the allowed named-Context list lives (`code-review: spec`, LOW — FR-006 residue): add one clause to `researches/adrs/ADR-116-remote-import-agents.md` Amendment 5 stating the permitted named-Context set is enumerated in the registry file (consistent with "the registry is the allowlist")
- [x] T030 Fix stale pointer note in `researches/docker-importer-implementation-tracking.md` (`code-review: standards`, LOW): `.specify/feature.json` now points at `specs/043-importer-source-adrs`, not 042
- [x] T031 Sync spec artifacts with the ADR-037 Amendment (`code-review: standards`, LOW): `specs/043-importer-source-adrs/research.md` Decision 3, `contracts/decision-surfaces.md` rows 6/14, and `quickstart.md` still describe ADR-037 as back-pointer-only — update to Amendment 1
- [x] T032 Record the config→Source binding column in `researches/adrs/ADR-077-v1-entity-schema.md` Amendment 2 (`code-review: standards`, LOW judgement): ADR-119 item 3 ratifies one-active-config binding — the schema inventory should note the binding column alongside the other additions
- [x] T033 Annotate contract-first status in `AGENTS.md` (`code-review: standards`, LOW judgement): the importer-contract bullets present `reportSourceIdentity`/`resolveTarget` as binding rules but nothing implements them yet — add a brief "(ratified in ADR-119; implementation lands with the ImporterSource core spec)" marker
