# Implementation Plan: GitHub Importer Expansion

**Branch**: `011-github-importer-expansion` | **Date**: 2026-09-13 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/011-github-importer-expansion/spec.md`

## Summary

Expand `packages/importer-github` from "repositories only" to a full GitHub
estate import: the organization becomes an `ACCOUNT` component (new category,
constitutional three-way taxonomy update) carrying profile/plan/seats/policies,
a teams summary, an aggregated billing snapshot, and per-capability status
markers; repositories gain real deployment topology (branch instances driven by
the operator's environment mapping + GitHub deployment-environment instances)
and per-repo billing attribution; optional toggles emit Actions workflows,
org-level self-hosted runners, and org packages. Auth stays PAT-only; Octokit
remains the API interface (typed methods + `octokit.request()` fallback for
preview billing endpoints), pinned to `X-GitHub-Api-Version: 2026-03-10`, with
a GHES `baseUrl` guarded by `urlSafetyError`. Repo `externalId` switches from
`full_name` to the stable numeric repo id (accepted breaking change).

## Technical Context

**Language/Version**: TypeScript 5, ESM, Node 24 backend runtime

**Primary Dependencies**: `octokit@^4` (bundles plugin-rest-endpoint-methods@14,
plugin-throttling, plugin-retry, plugin-paginate-rest — all already in the
dependency tree; no new packages), `zod`, `@componode/core`

**Storage**: PostgreSQL — one migration replacing the
`components_category_check` CHECK constraint with the extended category list;
no column changes (`details`/`rawConfig` are already JSONB)

**Testing**: vitest — unit tests mock `globalThis.fetch` keyed on URL pathname
(existing convention in `test/importer.test.ts`); every emitted asset passes
`validateDiscoveredAsset`; backend integration coverage via the import-run
service path per ADR-029/ADR-064

**Target Platform**: Docker container backend (Fastify on Node 24)

**Project Type**: pnpm monorepo — importer package + core constants + backend
migration + frontend config form

**Performance Goals**: a 1,000-repo org completes a run within one rate-limit
window (~1 hour); per-repo enrichment adds ≤4 calls/repo plus ~2 per GitHub
environment

**Constraints**: pull-only `AsyncGenerator<DiscoveredAsset>`; PAT secret only;
no DB access; no security-scanning endpoints; `baseUrl` must pass
`urlSafetyError` (hostname-only GHES — literal private IPs rejected); API
version pinned to `2026-03-10` via request headers

**Scale/Scope**: orgs up to ~1k repositories; billing line items aggregated
before persistence (never raw items); teams summary via single paginated call
(`teams.list` returns `members_count`/`repos_count`/`parent`)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|---|---|---|
| I. Single-Organization | PASS | The GitHub org is a *source asset* (an `ACCOUNT` component), not a tenant layer; multi-org = multiple importer configs, which the principle permits |
| II. Importer-First | PASS | Pull-only generator, yields `DiscoveredAsset`, depends only on `core`, secrets via `secretRefs` |
| III. Two-Level Taxonomy | PASS (with action) | New `ACCOUNT` category follows the documented process: research note + `COMPONENT_CATEGORIES`/meta + CHECK migration — explicitly permitted |
| IV. Environment-as-Instance | PASS | GH environments and mapped branches become `ComponentInstance`s; no env field on `Component` |
| V. Factual vs. Meaning | PASS | No relationships emitted; teams live in `details`, not entities or edges |
| VI. Test-First | PASS | Failing tests first; `validateDiscoveredAsset` exercised in every importer unit test |
| VII. Observability | PASS | `context.logger`/`reportPhase` for phases, warnings, rate-limit budget; no direct pino/OTel imports |

**Gate result**: PASS — no unjustified violations; no Complexity Tracking rows
required. The `externalId` change is a data-quality break documented in the
spec's Assumptions, not a constitutional issue.

## Project Structure

### Documentation (this feature)

```text
specs/011-github-importer-expansion/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output (importer scope + emitted assets)
└── checklists/
    └── requirements.md  # From /speckit-specify (16/16 passing)
```

### Source Code (repository root)

```text
packages/core/src/
├── constants/component-categories.ts      # + ACCOUNT value + meta
└── validation/discovered-asset.ts         # unchanged — new category flows through

packages/backend/src/
├── db/migrations/010_account_category.ts  # drop + recreate components_category_check
├── db/types.ts                            # ComponentRow.category type already string-typed via core
└── services/import-run-service.ts         # unchanged — dedup/upsert/reconciliation generic

packages/importer-github/src/
├── config.ts            # extended Zod schema (toggles, baseUrl, environmentMapping, billingPeriod)
├── manifest.ts          # description bump; version 1.1.0 via changeset
├── importer.ts          # orchestrator: phases + capability-guarded sections
├── github-org.ts        # org profile/plan/teams → github:organization asset
├── github-billing.ts    # typed + preview billing calls → aggregated snapshot
├── github-repos.ts      # repo listing + enrichment (envs, branches, releases, deployments)
├── github-extras.ts     # workflows / runners / packages emitters
└── mapping.ts           # name→Environment mapping (defaults + overrides)

packages/importer-github/test/
└── importer.test.ts     # expanded: fetch mock router per endpoint + capability scenarios

packages/frontend/src/components/
└── importer-config-form.tsx  # GitHub section: new toggles, baseUrl, billingPeriod, environmentMapping

docs/
├── importer-development.md   # optional note on capability-marker pattern
└── (openapi.yaml unchanged — no API endpoints added/removed; ADR-104 N/A)

researches/
└── adrs/                # taxonomy update note for ACCOUNT per constitution III
```

**Structure Decision**: All discovery logic stays inside
`packages/importer-github` (constitution II). Backend touch is exactly one
migration; core touch is exactly the category constant + meta. Frontend touch
is the hand-written GitHub section of `importer-config-form.tsx` — there is no
generic schema-driven form, so new fields are added explicitly.

## Complexity Tracking

> No constitutional violations requiring justification.
