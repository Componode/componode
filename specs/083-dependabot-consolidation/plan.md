# Implementation Plan: Dependabot PR Consolidation & Merge

**Branch**: `083-dependabot-consolidation` | **Date**: 2026-11-24 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/083-dependabot-consolidation/spec.md`

## Summary

Land the eight maintainer-approved Dependabot PRs as one branch. Method:
cherry-pick each dependabot tip commit in dependency order (preserves bot
commit provenance), resolving any manifest conflicts by hand and every
`pnpm-lock.yaml` conflict in favor of the branch — then regenerate the
lockfile once with `pnpm install`. Fix the fallout the assessment predicted:
lucide-react 1 export renames (if any surface at typecheck), the vitest 5.1
bootstrap-schema timeout (raise the test's timeout if it reproduces), and
the node:26.13.1-alpine digest pin in both Dockerfiles (taken verbatim from
PR #261). Verify with the full gate — lint, typecheck, test, build, prod
audit, docs checks, e2e — then close the absorbed PRs and superseded #262.

## Technical Context

**Language/Version**: TypeScript monorepo; dependency manifests
(`package.json`), `pnpm-lock.yaml`, two Dockerfiles. Application code only
where majors force it (lucide icon renames, test timeout).

**Primary Dependencies**: pnpm workspaces + Turborepo; `gh`/git for
dependabot branch refs.

**Storage**: N/A.

**Testing**: Existing suites are the regression net — `pnpm test`
(vitest unit/integration across packages), `pnpm e2e` (Playwright workload
per AGENTS.md: the vite/lucide/jsdom majors touch the served frontend). No
new test files; the only test-code edit allowed is raising the documented
bootstrap-schema timeout if vitest 5.1 reproduces the CI flake.

**Target Platform**: Node 24 dev/CI (`.nvmrc`, `engines>=24`); Node 26 in
container images after #261 — divergence documented per spec.

**Project Type**: pnpm monorepo — touches `package.json` manifests at root
and `packages/*`, `pnpm-lock.yaml`, `Dockerfile`, `Dockerfile.agent`,
possibly `packages/frontend` icon imports and one core test timeout.

**Constraints**: AGENTS.md dependency rules — `^x.y.z` ranges preserved as
dependabot wrote them, `pnpm-lock.yaml` committed with manifests, no
`latest`/`*`; "majors in their own PR" is consciously deviated from per
maintainer instruction (this PR is deps-only, and vite 8/plugin-react 6 are
inseparable anyway).

**Scale/Scope**: 8 dependabot branches, ~30 version bumps across 17
manifest files, 1 regenerated lockfile, 2 Dockerfile `FROM` lines, a small
number of possible icon-import renames, 1 possible test timeout bump.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Single-Org** — PASS: no product surface touched.
- **II. Importer-First** — PASS: importer packages only get devDep bumps;
  no contract change.
- **III. Two-Level Taxonomy** — PASS: not touched.
- **IV. Environment-as-Instance** — PASS: not touched.
- **V. Factual vs. Meaning** — PASS: not touched.
- **VI. Test-First** — PASS with noted scope: no new behavior to test-first;
  verification is the existing unit/integration/Playwright suites plus the
  mechanical checks below.
- **VII. Observability** — PASS: no runtime path added.

**Post-design re-check**: PASS — no violations.

## Resolved Bumps (from the Dependabot PRs)

| PR | Package(s) | From → To |
| --- | --- | --- |
| #281 | @fastify/cookie | 11.1.3 → 11.1.5 |
| #281 | @fastify/rate-limit | 11.2.1 → 11.2.2 |
| #281 | @fastify/static | 10.1.8 → 10.1.12 |
| #281 | @fastify/websocket | 11.3.4 → 11.3.7 |
| #281 | fastify | 5.12.7 → 5.12.8 |
| #281 | kysely | 0.29.7 → 0.29.9 |
| #281 | react-router-dom | 7.18.4 → 7.18.6 |
| #281 | tailwind-merge | 3.7.0 → 3.7.1 |
| #281 | @alicloud/openapi-core | 1.0.8 → 1.0.9 |
| #282 | @types/node | 26.6.5 → 26.6.6 |
| #282 | eslint | 10.13.0 → 10.15.0 |
| #282 | globals | 17.13.0 → 17.14.0 |
| #282 | prettier | 3.9.10 → 3.10.1 |
| #282 | turbo | 2.11.10 → 2.11.13 |
| #282 | typescript-eslint | 8.72.0 → 8.73.0 |
| #282 | vitepress-openapi | 0.2.5 → 0.2.16 |
| #282 | vitest | 5.0.5 → 5.1.1 |
| #282 | @testcontainers/postgresql, testcontainers | 12.2.1 → 12.2.2 |
| #282 | jose (devDep) | 6.2.13 → 6.2.18 |
| #282 | @tailwindcss/vite, tailwindcss | 4.3.3 → 4.3.5 |
| #283 | @vitejs/plugin-react | 5.2.0 → 6.3.0 |
| #284 | @testing-library/jest-dom | 7.0.1 → 8.0.0 |
| #285 | vite | 7.3.7 → 8.3.8 |
| #286 | jsdom | 30.1.3 → 31.0.1 |
| #221 | lucide-react | 0.468.0 → 1.64.0 |
| #261 | node base image (2 Dockerfiles) | 24.22.2-alpine → 26.13.1-alpine (digest-pinned) |
| closed | #262 dev-deps group | superseded by #282 — closed unmerged |

## Known risks → verification hooks

| Risk | Where it surfaces | Response |
| --- | --- | --- |
| plugin-react 6 on vite 7 | frontend build (`vite/internal` export) | land vite 8 first — same branch |
| lucide-react 1 removed exports | `tsc -b` on packages/frontend | rename imports to v1 names; drop the bump only if fallout exceeds mechanical renames |
| vitest 5.1 + 5 s test timeout | `packages/core` bootstrap.test.ts | raise that test's timeout |
| prettier 3.10 / eslint 10.15 drift | `pnpm lint` | run fixers; commit mechanical diffs |
| vitepress-openapi 0.2.16 render drift | `docs:api:check` | regenerate generated docs regions |
| peer gaps (tailwind-vite, testcontainers, vitest vs vite 8) | `pnpm install` | resolve in regen; exclude the offending bump if unresolvable |
| Node 26 unverified by CI | review time | documented in PR body; `.nvmrc` follow-up |

## Project Structure

### Documentation (this feature)

```text
specs/083-dependabot-consolidation/
├── spec.md              # This feature's spec
├── plan.md              # This file
└── tasks.md             # /speckit-tasks output
```

### Repository files touched

```text
package.json                          # vite, vitest, eslint, prettier, turbo, ts-eslint, globals, @types/node, vitepress-openapi, jose
pnpm-lock.yaml                        # regenerated once
packages/*/package.json               # per-PR manifest bumps (see Resolved Bumps)
Dockerfile                            # node:26.13.1-alpine digest pin
Dockerfile.agent                      # node:26.13.1-alpine digest pin
packages/frontend/src/**              # only if lucide-react 1 dropped imported exports
packages/core/test/schemas/bootstrap.test.ts  # only if the timeout reproduces
docs/api.md or generated regions      # only if vitepress-openapi render drift regenerates them
.specify/feature.json                 # already pointed at this spec dir
```

## Complexity Tracking

> No constitution violations — section intentionally empty.
