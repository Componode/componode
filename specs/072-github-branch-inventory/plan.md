# Implementation Plan: GitHub importer branch, release & metadata inventory

**Branch**: `072-github-branch-inventory` | **Date**: 2026-11-12 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/072-github-branch-inventory/spec.md` (research basis: `researches/github-importer-branches-research.md`; inventory home ratified in clarify: canonical `details`)

## Summary

The GitHub importer already enumerates every branch (`listBranches`, fully paginated) but emits a `ComponentInstance` only for names matching the environment mapping — `main`, `master`, `feature/*`, `dependabot/*` are silently dropped (verified: 0 branch instances on `Componode/componode` and `Componode/v0-componode-dpam`). **Amended during review**: every branch now emits a `branch:{name}` instance (environment = classification or `OTHER` — spec-011 selector semantics amended, mapping becomes classifier-only), while the **inventory layer** added here carries the richer provider facts in each repo component's `details` payload — branches, releases/tags, and repository/environment metadata — visible on the component page via a new provider-details section, plus the importer correctness fixes found in the audit (capability markers, pagination, rate-limit retries, manifest drift, docs).

No `DiscoveredAsset`/core/backend contract change is required: `details` is free-form JSONB already returned by `GET /components/{id}` (`component-catalog-service.ts:270`), and instance `rawConfig` already reaches the frontend. The work is concentrated in `packages/importer-github` (new inventory module + config toggles + capability/pagination/retry fixes), one new frontend details component, the Playwright GitHub mock, docs, and tests.

## Technical Context

**Language/Version**: TypeScript 6 (importer/core/backend/frontend), Zod 4 config schemas

**Primary Dependencies**: `octokit@^4.1.4` (bundles `plugin-retry` + `plugin-throttling` — rate-limit backoff is configuration, not new code), existing `withCapability()`/`CapabilityMap` degradation pattern, React/Tailwind/shadcn UI primitives

**Storage**: none new — `components.details` (jsonb, wholesale-replaced per run at `import-run-service.ts:403,440`) and `component_instances.rawConfig` carry everything; no migration

**Testing**: Vitest unit tests in `packages/importer-github/test/` (fetch-mock harness), frontend unit tests in `packages/frontend/src/test/unit/`, Playwright journey via extended `playwright/mocks/github/server.ts`

**Target Platform**: `packages/importer-github` + `packages/frontend` only; backend/core/agent/other importers untouched

**Project Type**: web-service (pnpm monorepo)

**Performance Goals**: default config adds ≤3 API calls/repo (releases list, tags list — branches list already fetched); per-branch activity and language breakdown opt-in; fully paginated everywhere

**Constraints**: pull-only importer (constitution II); inventory in `details` + every branch as a `branch:{name}` instance with `OTHER` fallback (amended spec clarification); mapped-branch instance payloads unchanged; every optional capability degrades via markers, never fails the run; no security-scanning endpoints (spec-011 FR-019)

**Scale/Scope**: ~1 new importer module, edits to `config.ts`/`importer.ts`/`github-repos.ts`/`github-extras.ts`/`client.ts`/`manifest.ts`, 1 new frontend component + wiring, mock server extension, importer guide + generated docs, unit + Playwright tests. No openapi.yaml change (no endpoint surface change).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Verdict | Notes |
|---|---|---|
| I. Single-org | PASS | No tenancy surface. |
| II. Importer-first | PASS | Pull-only `AsyncGenerator<DiscoveredAsset>`; all new fetches are reads; `details`/`rawConfig` are contract-sanctioned free-form payloads. |
| III. Two-level taxonomy | PASS | No new categories/providers; reuses `REPOSITORY`/`GITHUB`/`github:repository`. |
| IV. Environment-as-instance | PASS | Amended: branches now emit instances per the DPAM pattern (component variations = instances); `environment` carries the classified value or `OTHER` — the same fallback deployment environments already use. `details.branches[]` remains the factual inventory layer; no environment state is fabricated (status/deployedAt follow the established branch-instance conventions). |
| V. Factual vs. meaning | PASS | Inventory is pure factual layer (what the source reports); no product edges, no human-curation replacement. |
| VI. Test-first | PASS | tasks.md sequences failing tests first: importer unit (inventory shape, toggles, pagination, degradation), frontend unit (details section), Playwright journey (mock-backed inventory on component page). |
| VII. Observability | PASS | New capabilities record markers + `warnIfDegraded` logs; existing rate-limit logging retained; octokit retry/throttle emits its own warnings. |

No violations → Complexity Tracking not required.

## Project Structure

### Documentation (this feature)

```text
specs/072-github-branch-inventory/
├── plan.md              # This file
├── research.md          # Phase 0 output — decision record
├── data-model.md        # Phase 1 output — details/rawConfig payload shapes
├── quickstart.md        # Phase 1 output — validation scenarios
├── contracts/           # Phase 1 output — github-inventory.md payload contract
├── checklists/
│   └── requirements.md  # Spec quality checklist
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
packages/
├── importer-github/src/
│   ├── config.ts               # +includeBranchInventory/includeBranchActivity/
│   │                           #   includeBranchInstances/includeReleaseInventory/
│   │                           #   includeLanguageBreakdown
│   ├── client.ts               # octokit retry/throttle bounds (FR-015)
│   ├── importer.ts             # repo-loop inventory wiring; org yield after
│   │                           #   repo loop for capability aggregation; version bump
│   ├── github-repos.ts         # buildRepoInstances: gate branch block under
│   │                           #   includeBranchInstances; paginate environments;
│   │                           #   env governance into rawConfig.githubEnvironment;
│   │                           #   repo metadata into details
│   ├── github-inventory.ts     # NEW — branches/releases/tags/languages fetchers
│   ├── github-extras.ts        # paginate packages listing
│   ├── mapping.ts              # unchanged (environment mapping semantics preserved)
│   ├── manifest.ts             # version sync (FR-016)
│   └── capabilities.ts         # unchanged (reused)
├── frontend/src/
│   ├── ux/components/catalog/github-details.tsx   # NEW — allowlisted shapers +
│   │                                             #   GithubDetailsSection
│   ├── ux/components/catalog/docker-details.tsx   # +githubEnvironment instance shaper
│   ├── ux/components/catalog/component-detail.tsx# render GithubDetailsSection for
│   │                                             #   github:repository
│   └── test/unit/                                 # github-details tests
└── core/backend/agent/other-importers             # UNTOUCHED

playwright/mocks/github/server.ts                  # +/releases, /tags, /languages,
                                                   #   multi-branch, env protection data
playwright/tests/importers/ or journeys/           # inventory journey spec
docs/importers/github.md                           # inventory fields, toggles,
                                                   #   selector semantics, scopes
researches/github-importer-branches-research.md    # already on branch (input doc)
```

**Structure Decision**: standard monorepo layout — all changes inside `packages/importer-github` + `packages/frontend` + `playwright/` mocks/tests + `docs/`. No new packages, no backend/core changes, no migrations, no openapi.yaml change.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

None — all gates pass.
