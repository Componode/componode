# Implementation Plan: Importer Source ADR Ratification

**Branch**: `043-importer-source-adrs` | **Date**: 2026-10-31 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/043-importer-source-adrs/spec.md`

## Summary

Ratify the architecture decisions required before any ImporterSource or
Docker importer implementation. Deliverable is decision-record text only:
one new ADR (ADR-119, ImporterSource identity + lifecycle), Amendment
sections on ADR-035/036/037/047/056/065/077/116, back-pointers on every
touched ADR, an updated decision index, and vocabulary sync in
`CONTEXT.md`/`AGENTS.md`. No runtime code ships — contract text only.

## Technical Context

**Language/Version**: Markdown (ADR documents); no code.

**Primary Dependencies**: Existing ADR corpus under `researches/adrs/`
(118 ADRs), index `researches/architecture-decisions.md`, canonical
vocabulary `CONTEXT.md`, agent rules `AGENTS.md`. Design inputs:
`researches/docker-importer-{research,plan,scenarios,spec-waves}.md`.

**Storage**: N/A — documentation files in git.

**Testing**: No executable tests (docs-only). Verification is textual:
every Phase-0 contract surface maps to a ratified ADR section; amendment
format matches the ADR-087/ADR-116 precedents; Prettier passes on touched
files; a reviewer checklist walks the spec's acceptance scenarios.

**Target Platform**: Repository documentation consumed by spec authors
and coding agents.

**Project Type**: Decision-record (ADR) feature.

**Performance Goals**: N/A.

**Constraints**: No runtime code changes (spec FR-011); ADR numbers are
append-only (next free: 119); amendment format must follow ratified
precedents; provider-agnostic target contract (Docker is first adopter).

**Scale/Scope**: ~8 ADR files touched/created, 1 index, 2 vocabulary
surfaces.

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Principle                   | Verdict       | Note                                                                                                                                             |
| --------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| I. Single-Organization      | PASS          | No tenant concepts; ImporterSource is org-global provenance.                                                                                     |
| II. Importer-First          | PASS          | Amendments preserve pull-only `AsyncGenerator`; source identity is _reported_, not written; importers still never touch the DB.                  |
| III. Two-Level Taxonomy     | PASS          | No category/provider changes.                                                                                                                    |
| IV. Environment-as-Instance | PASS          | Source lifecycle is a new axis, not an environment field; lifecycle/status not conflated.                                                        |
| V. Factual vs. Meaning      | PASS          | Source provenance is factual layer; no product-edge changes.                                                                                     |
| VI. Test-First              | PASS (scoped) | No code ships; verification is the acceptance-scenario checklist (quickstart.md). Implementation specs that follow will carry normal test tasks. |
| VII. Observability          | PASS          | No runtime paths added.                                                                                                                          |

No violations; Complexity Tracking not required.

## Project Structure

### Documentation (this feature)

```text
specs/043-importer-source-adrs/
├── plan.md              # This file
├── research.md          # Ownership mapping + amendment decisions
├── data-model.md        # Conceptual entities being ratified
├── contracts/           # Decision-surface → owning-ADR map
│   └── decision-surfaces.md
├── quickstart.md        # Validation walkthrough
└── tasks.md             # /speckit-tasks output
```

### Source Code (repository root)

```text
researches/
├── adrs/
│   ├── ADR-119-importer-source-identity-and-lifecycle.md   # NEW
│   ├── ADR-036-two-phase-reconciliation-scope.md           # +Amendment
│   ├── ADR-035-instance-reconciliation-orphan-missing-instances.md  # +Amendment
│   ├── ADR-037-importer-run-commit-strategy.md             # +Amendment
│   ├── ADR-047-deletion-model.md                           # +Amendment
│   ├── ADR-056-importer-interface-signature.md             # +Amendment
│   ├── ADR-065-package-dependency-graph.md                 # +Amendment
│   ├── ADR-077-v1-entity-schema.md                         # +Amendment
│   └── ADR-116-remote-import-agents.md                     # +Amendment 5
├── architecture-decisions.md                               # index update
CONTEXT.md                                                  # +ImporterSource/Source membership/target profile terms
AGENTS.md                                                   # importer-contract + deletion bullets sync
```

**Structure Decision**: Documentation-only change under `researches/` +
vocabulary surfaces; no `packages/` changes.

## Complexity Tracking

> None — Constitution Check passed with no violations.
