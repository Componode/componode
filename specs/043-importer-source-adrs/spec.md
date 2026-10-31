# Feature Specification: Importer Source ADR Ratification

**Feature Branch**: `043-importer-source-adrs`

**Created**: 2026-10-31

**Status**: Draft

**Input**: User description: "Phase 0" of `researches/docker-importer-implementation-tracking.md` — ratify the architecture decisions required before any ImporterSource or Docker importer implementation. Design inputs: `researches/docker-importer-research.md`, `researches/docker-importer-plan.md`, `researches/docker-importer-scenarios.md`, `researches/docker-importer-spec-waves.md` (all merged via PR #201).

This is a **decision-record feature**: the deliverable is ratified ADR text (a new ADR plus amendments to existing ratified ADRs), the updated decision index, and back-pointers — not runtime code. The ratified decisions become the contract authority for the ImporterSource core spec and all Docker importer waves that follow.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Ratified ImporterSource lifecycle contract (Priority: P1)

A spec author writing the next numbered spec (the generic ImporterSource core) needs a single ratified decision record that owns: what an `ImporterSource` is, how its identity differs from `ImporterConfig` and from catalog Components, its lifecycle states, how configs bind to it, and how source-scoped reconciliation behaves. Today these decisions exist only in unnumbered research notes; implementing from them directly would violate the ADR fidelity rule (no contract surface may live only in a spec artifact).

**Why this priority**: Every subsequent wave (migration, Docker, Swarm) depends on this contract. It is the sole reason Phase 0 exists and the only thing blocking Wave A.

**Independent Test**: The new/updated ADR text can be read standalone and answers: Source states and transitions, config-to-Source binding rules, config deletion behavior, Source retirement/reactivation, and the Source-membership model — without consulting the research notes.

**Acceptance Scenarios**:

1. **Given** the ratified decision set, **When** a reader asks "what happens to a Source and its run history when its config is deleted?", **Then** a ratified ADR states the answer (Source goes `UNMONITORED`, history preserved) — not a research doc.
2. **Given** the ratified decision set, **When** a reader asks "when is a shared Component retired?", **Then** a ratified ADR states the source-membership rule (retired only when no active Source membership remains).
3. **Given** the ratified decision set, **When** a reader asks "how does the importer report which source produced assets?", **Then** a ratified ADR defines the source-identity reporting contract including the empty-inventory case.

---

### User Story 2 - Ratified importer contract and Agent target boundary (Priority: P2)

A spec author needs ratified decisions for the importer-facing contract changes: source identity reporting before asset yield, the manifest `targetRefKey` mechanism, the typed target resolver, and the Agent-local target registry with allowlist preflight — so the Docker importer spec can declare `targetId` resolution without inventing the contract in a spec artifact.

**Why this priority**: Required before the Docker wave (Phase 3) but not strictly before the ImporterSource core spec (Phase 1). Bundled into the same ratification change per the approved strategy.

**Independent Test**: The amended ADRs define the generic target-resolution contract (provider-agnostic), the Agent-local registry location/format constraints, and preflight failure semantics — Docker appears only as the first adopter, not a baked-in assumption.

**Acceptance Scenarios**:

1. **Given** the amended importer contract ADR, **When** a reader asks how a config scope references a remote target, **Then** the `targetRefKey` + `targetId` + resolver contract is stated generically.
2. **Given** the amended Agent ADR, **When** a reader asks where target profiles live and what happens on an unknown/malformed profile, **Then** the registry path convention, immutability rule, and fail-before-network-access behavior are stated.

---

### User Story 3 - Consistent, navigable decision record (Priority: P3)

A future maintainer tracing why `import_runs.configId` became nullable, or why a ninth importer package joins the lockstep set, can follow the decision index and bidirectional "Amended by" links to the deciding ADRs without reading spec artifacts.

**Why this priority**: Housekeeping required by AGENTS.md § ADR fidelity — lower standalone value but mandatory for the change to be considered done.

**Independent Test**: `researches/architecture-decisions.md` lists every new/amended ADR; each amended ADR carries a `**Amended by ADR-XXX**` back-pointer; each new ADR lists the ADRs it amends.

**Acceptance Scenarios**:

1. **Given** an amended ADR, **When** a reader opens it, **Then** an Amendment section states the refinement and a back-pointer names the amending ADR.
2. **Given** the new ADR, **When** a reader opens it, **Then** its "Amendments to earlier ADRs" list matches the actual amendments made.
3. **Given** the decision index, **When** compared to the ADR directory, **Then** all new ADRs are indexed and no ratified decision relevant to this change is missing.

---

### Edge Cases

- **No new ADR needed?** If review concludes an existing ADR can own the `ImporterSource` concept, the outcome is amendments only — the spec is satisfied if every enumerated contract surface is ratified somewhere durable.
- **A reviewed ADR needs no change**: ADR-037/038 (run history) and ADR-106/117 (credential/egress boundaries) are _review-then-maybe-amend_. If review finds the current text already covers the decision or the decision lives in the new ADR, recording that conclusion in the spec's plan/research is an acceptable outcome — no gratuitous amendments.
- **Conflict between research notes and a ratified ADR**: the ratified ADR wins until amended; the amendment must explicitly resolve the conflict (e.g., ADR-036's config-scoped phase-2 vs. source-scoped reconciliation; ADR-047's hard-delete of `import_runs` vs. preserved run history).
- **Lockstep timing**: adding `@componode/importer-docker` to the ADR-065 importer set is a contract change ratified now; the package itself ships in a later wave — the amendment must not imply the package already exists.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: A ratified decision record MUST own the `ImporterSource` entity: durable internal record with provider-native external identity, `ACTIVE`/`UNMONITORED`/`RETIRED` lifecycle, and the rule that Source identity is reported before assets (including empty inventories).
- **FR-002**: A ratified decision record MUST own the config-to-Source binding: one active config per Source, reattachment to the same Source on config replacement, and explicit reversible Source retirement distinct from config deletion.
- **FR-003**: The reconciliation ADR (ADR-036) MUST be amended (or the decision ratified elsewhere with a back-pointer) so reconciliation scope is source-membership-based: a completed run reconciles only its own Source's memberships; shared Components/Instances stay active while any Source reports them; incomplete runs never trigger retirement.
- **FR-004**: The importer interface ADR (ADR-056) MUST be amended (or the decision ratified elsewhere with a back-pointer) for the source-identification callback, `manifest.targetRefKey`, and the typed target resolver on the importer context.
- **FR-005**: A ratified decision record MUST own run-history retention across config deletion: durable `ImportRun.sourceId`, nullable `configId` with `ON DELETE SET NULL` semantics, resolving the conflict with ADR-047's hard-delete treatment of `import_runs`/`importer_configs`.
- **FR-006**: The remote-agent ADR (ADR-116) MUST be amended (or the decision ratified elsewhere with a back-pointer) for the Agent-local versioned read-only target registry, target-profile immutability, and allowlist preflight that fails before network access.
- **FR-007**: The package-dependency ADR (ADR-065) MUST be amended for the importer-package lockstep set change admitting `@componode/importer-docker` (hub and agent), stated as a contract change whose implementation ships later.
- **FR-008**: ADR-037/038 and ADR-106/117 MUST be reviewed against the new boundaries; each review produces either an amendment or a documented "no change needed" conclusion in the spec's plan/research.
- **FR-009**: `researches/architecture-decisions.md` MUST be updated to index every new ADR and reflect every amendment's "Amends"/"Amended by" relationships.
- **FR-010**: Every amended ADR MUST gain an Amendment section (precedent: ADR-087 Amendment 1) plus a `---` + `**Amended by ADR-XXX**` back-pointer; every new ADR MUST list the earlier ADRs it amends (precedent: ADR-116).
- **FR-011**: The deliverable MUST NOT include runtime code changes — no schema migrations, no contract type changes, no importer packages. Contract text only. (Implementation lands in Phase 1+ specs.)
- **FR-012**: Docker-specific transport/credential mechanics (mTLS fields, SSH pin, Context rules) MAY be referenced as first-adopter examples but the ratified target contract MUST be provider-agnostic.

### Key Entities

- **ImporterSource**: Durable provenance/ownership boundary for imported data; internal UUID v7 record keyed by provider-native canonical identity; lifecycle `ACTIVE`/`UNMONITORED`/`RETIRED`; distinct from `ImporterConfig` (editable execution state), from Agent target profiles (access routes), and from catalog Components.
- **Source membership**: Durable association between a Source and a Component/ComponentInstance it reported; survives run/config deletion; drives source-scoped reconciliation.
- **Target profile**: Agent-local, versioned, read-only access-route descriptor with an immutable `targetId`; referenced from config scope via `manifest.targetRefKey`; resolved by the Agent before importer execution.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: 100% of the contract surfaces listed in the tracking file's Phase 0 checklist are owned by a ratified ADR (new or amended) — zero remain defined only in research/spec artifacts.
- **SC-002**: Every amended ADR contains an Amendment section and a back-pointer; every new ADR names the ADRs it amends — verifiable by inspection of each touched file.
- **SC-003**: `researches/architecture-decisions.md` accounts for 100% of new and amended ADRs from this change.
- **SC-004**: A reviewer can answer each acceptance scenario question by reading only `researches/adrs/` files — no reference to `researches/docker-importer-*.md` required.
- **SC-005**: The next numbered spec (ImporterSource core) can be written citing only ratified ADRs for its architectural constraints.

## Assumptions

- The four `researches/docker-importer-*.md` documents are the approved design input; where they conflict with ratified ADRs, the ADR text is amended to resolve the conflict explicitly.
- The next available ADR number is used for the new ADR (119 at time of writing — confirm at authoring time; do not renumber existing ADRs).
- ADR-047's "hard-delete `import_runs`/`importer_configs`" language is refined (not reversed) to preserve run history and Source provenance across config deletion.
- `LEGACY_UNATTRIBUTED` handling and per-importer source-identity keys are Wave B decisions; Phase 0 ratifies only the generic mechanism and notes migration waves follow.
- Importer lockstep (ADR-065) is amended now for the _set membership_ contract; the actual package registration tasks land in the Docker wave spec.
- Canonical-vocabulary surfaces stay in sync: where `CONTEXT.md` or AGENTS.md restate amended rules (importer contract, deletion model, agent boundary), they are updated in the same change — reasonable default per the ADR fidelity rule, not a separate spec.
