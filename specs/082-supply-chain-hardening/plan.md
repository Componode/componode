# Implementation Plan: Supply-Chain Hardening (OpenSSF Scorecard Remediations)

**Branch**: `082-supply-chain-hardening` | **Date**: 2026-11-23 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/082-supply-chain-hardening/spec.md`

## Summary

Close the repository-level OpenSSF Scorecard findings that need no
application code: (1) pin all 19 GitHub Actions `uses:` references across
four workflows to full commit SHAs with `# vX.Y.Z` comments — at the newer
versions the open Dependabot PRs propose — and add top-level
`permissions: contents: read` to `ci.yml` and `release.yml`; (2) pin every
container image reference to its multi-arch index digest across the four
Dockerfiles and two compose files; (3) add the repo-root `LICENSE`
(Apache-2.0, ADR-002) and `SECURITY.md` files.

## Technical Context

**Language/Version**: N/A — YAML, Dockerfile, and Markdown only. No
TypeScript changes; no build required.

**Primary Dependencies**: GitHub API (`gh api`) for tag→SHA resolution;
`docker buildx imagetools inspect` for registry digests.

**Storage**: N/A.

**Testing**: Verification is grep/diff-based (no test suite surface) plus
`docs:oracle:check` and `pnpm lint`. Per constitution VI, repo-hygiene
specs with no runtime surface ship no Playwright coverage — the changed
surface is CI/packaging metadata, verified by the checks below.

**Target Platform**: GitHub Actions runners; Docker/OCI registries.

**Project Type**: pnpm monorepo — this change touches repo-root and
`.github/` metadata only.

**Constraints**: No `packages/**` source edits; no Dependabot PR merges;
job-level write permissions in `release.yml`/`scorecard.yml` are required
and stay; roadmap ordering vs the in-flight 081 branch resolved at merge
time.

**Scale/Scope**: 4 workflow files (19 `uses:` pins, 2 permissions blocks),
4 Dockerfiles (4 `FROM` pins), 2 compose files (5 `image:` pins), 2 new
root files, roadmap + spec bookkeeping.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Single-Org** — PASS: no product surface touched.
- **II. Importer-First** — PASS: not touched.
- **III. Two-Level Taxonomy** — PASS: not touched.
- **IV. Environment-as-Instance** — PASS: not touched.
- **V. Factual vs. Meaning** — PASS: not touched.
- **VI. Test-First** — PASS with noted scope: no executable surface to
  test-first; verification is mechanical (grep assertions, oracle check).
- **VII. Observability** — PASS: no runtime path added.

**Post-design re-check**: PASS — no violations.

## Resolved Pins (author-time registry/API lookups)

| Reference | Pin |
| --- | --- |
| actions/checkout | `3d3c42e5aac5ba805825da76410c181273ba90b1` # v7.0.1 |
| pnpm/action-setup | `73e46992e05b19abd31f2f3c20e0e7370d762115` # v6.1.1 |
| actions/setup-node | `949feb2413d6458794dcd2491c4babbbce0c15c1` # v7.1.0 |
| actions/dependency-review-action | `bbc44d14a204704ccc493733616cd1e93a0321ec` # v5.0.1 |
| actions/upload-artifact | `cf430e030ddbb5b0abf93d22962f4752f3646cd9` # v7.0.2 |
| actions/upload-pages-artifact | `fc324d3547104276b827a68afc52ff2a11cc49c9` # v5.0.0 |
| actions/deploy-pages | `368f82528645a54fb793d4d04e342629a3f51346` # v5.0.1 |
| github/codeql-action (upload-sarif) | `1bd86f2fdb4b86187fa4059f16f31a3202acc9ea` # v4.39.4 |
| ossf/scorecard-action | `23f22cd43608bae7a1f1fa2603d7314dee9538a5` # v2.6.0 |
| docker/setup-qemu-action | `99012661954931238ded8c8b007157a8430204e1` # v4.4.0 |
| docker/setup-buildx-action | `f87e5991a6d7451dcb8d9637bfbc97413f497069` # v4.4.1 |
| docker/login-action | `8aa5831fb8d48d8f76594c7ddde61ae58019f550` # v4.8.0 |
| docker/build-push-action | `c3c9e263c25d99ce0380d002d59b67737d91b0dc` # v7.4.0 |
| node:24.22.2-alpine | `sha256:a34ab6d7f6f4813f4d0c5469d74685604b962fbdbf5793a7bc7b4998ecb867c8` |
| mcr.microsoft.com/playwright:v1.64.1-noble | `sha256:2f05f8a734509a7b3f26a912639488ee08f58a7b292d14d62271bcff9038768f` |
| postgres:16.11-alpine | `sha256:4327b9fd295502f326f44153a1045a7170ddbfffed1c3829798328556cfd09e2` |
| caddy:2-alpine | `sha256:003a97808e781aa9f7e75cc2f43d34d461099031faf5e20faefb9f61126836f0` |
| dexidp/dex:v2.44.0 | `sha256:5d0656fce7d453c0e3b2706abf40c0d0ce5b371fb0b73b3cf714d05f35fa5f86` |

## Project Structure

### Documentation (this feature)

```text
specs/082-supply-chain-hardening/
├── spec.md              # This feature's spec
├── plan.md              # This file
└── tasks.md             # /speckit-tasks output
```

### Repository files touched

```text
.github/workflows/ci.yml        # 5 pins + top-level permissions
.github/workflows/release.yml   # 9 pins + top-level permissions
.github/workflows/scorecard.yml # 4 pins (3 bumps + upload-sarif v3→v4)
.github/workflows/docs.yml      # 5 pins (already has permissions)
Dockerfile                      # node base digest
Dockerfile.agent                # node base digest
playwright/Dockerfile.mocks     # node base digest
playwright/Dockerfile.runner    # playwright digest + corepack comment
docker-compose.yml              # postgres + caddy digests
playwright/compose.test.yml     # postgres + caddy + dex digests
LICENSE                         # NEW — Apache-2.0 verbatim
SECURITY.md                     # NEW — supported versions + reporting
docs/roadmap.md                 # 082 bullet + shipped-prose append
.specify/feature.json           # point at this spec dir
```

## Complexity Tracking

> No constitution violations — section intentionally empty.
