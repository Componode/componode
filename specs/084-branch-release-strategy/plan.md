# Implementation Plan: Two-Branch Release Management Strategy

**Branch**: `084-branch-release-strategy` | **Date**: 2026-11-26 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/084-branch-release-strategy/spec.md`

## Summary

Restructure the repository from a single-branch (`main`) model to a
two-branch model: `develop` as the protected default integration branch
with full CI/e2e/scan parity, and `main` as the release-only branch that
publishes versioned releases. Versioning is changesets-derived and happens
only at promotion time; documentation publishes dual-track (production `/`
from main, development `/dev/` from develop) onto the single GitHub Pages
site; a hotfix escape hatch with automatic back-merge covers emergencies.
All design decisions are pre-settled — see [research.md](research.md).

## Technical Context

**Language/Version**: YAML (GitHub Actions workflows), TypeScript config
surfaces (VitePress config), Markdown documentation. No application code
changes — `packages/**` source is untouched except incidental config.

**Primary Dependencies**: GitHub Actions (checkout, setup-node,
pnpm/action-setup, docker/build-push-action, github/codeql-action,
ossf/scorecard-action, actions/deploy-pages), changesets, VitePress,
Playwright Docker Compose workload.

**Storage**: N/A (repository configuration only)

**Testing**: This feature IS test/CI infrastructure. Validation is by:
workflow YAML linting, dry-run smoke tests post-cutover, the quickstart.md
validation scenarios, and the existing CI suite itself executing on the
feature PR. The constitution's Playwright mandate applies to product
surface changes; this change touches no product surface — instead it ADDS
the e2e gate to CI.

**Target Platform**: GitHub Actions hosted runners (ubuntu-latest),
GitHub Pages, GHCR.

**Project Type**: Repository infrastructure / CI-CD pipelines.

**Performance Goals**: CI gate latency on develop PRs stays under ~20
minutes including the new e2e job; docs deploy is additive minutes.

**Constraints**: GitHub Pages allows exactly one site per repository
(deployed via immutable whole-site artifacts); CodeQL dual-branch scanning
requires in-repo advanced configuration; no ruleset bypass actors may be
granted to automation.

**Scale/Scope**: 5 workflow files (ci, release, docs, scorecard + new
codeql, promote/tag/hotfix-backmerge workflows), 2 config files
(changesets, dependabot), VitePress config, contributor/agent
documentation, one settings runbook.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Application | Verdict |
|-----------|-------------|---------|
| I. No multi-tenancy/SaaS | N/A — no product surface | PASS |
| II. Composable Product Model | N/A — no domain model change | PASS |
| III. Importer contract | N/A — no importer change | PASS |
| IV. Lifecycle separation | N/A | PASS |
| V. Security (ADR-084–102) | No application code; workflows use pinned SHA actions consistent with existing practice; no secrets in logs/commits; SARIF uploads use least-privilege permissions blocks | PASS |
| VI. Test-first | Adapted: this change is CI infrastructure. "Tests" are the quickstart validation scenarios and post-cutover smoke tests; the feature PR itself must pass the existing CI suite. No product surface means no new Playwright specs — instead the change INSTALLS the Playwright gate. Documented in Technical Context. | PASS (adapted, justified) |
| VII. Spec-driven workflow | This artifact is the evidence of compliance | PASS |
| Documentation rules | CONTRIBUTING.md, AGENTS.md, and a new docs page ship in the same change; sidebar coverage enforced by docs:sidebar:check | PASS |
| Dependency rules | No new runtime dependencies; workflow actions pinned by SHA per existing convention | PASS |

No violations requiring justification.

## Project Structure

### Documentation (this feature)

```text
specs/084-branch-release-strategy/
├── plan.md              # This file
├── research.md          # Decision log (grilling-settled)
├── data-model.md        # Branch/pipeline entity states
├── quickstart.md        # Cutover + validation runbook
├── contracts/           # Workflow interface contracts
│   └── pipelines.md
└── tasks.md             # (/speckit-tasks output)
```

### Source Code (repository root)

```text
.github/workflows/
├── ci.yml               # MODIFIED — triggers on [main, develop], + e2e job, + main-guard job
├── codeql.yml           # NEW — advanced setup, both branches + PRs + weekly
├── docs.yml             # MODIFIED — dual-track combined build/deploy
├── release.yml          # MODIFIED — reshape: validate+version dispatch; idempotent publish
├── promote.yml          # NEW — open/update promotion PR on push to develop
├── tag.yml              # NEW — auto-tag on push to main, fail loudly on conflict
├── backmerge.yml        # NEW — open back-merge PR main→develop after hotfix merges
└── scorecard.yml        # MODIFIED — add develop push trigger

.changeset/config.json   # MODIFIED — baseBranch: develop
.github/dependabot.yml   # MODIFIED — target-branch: develop on all entries
docs-site/.vitepress/config.ts  # MODIFIED — env-driven base + dev banner
docs/                    # MODIFIED — new branching-and-releasing page + sidebar entry
CONTRIBUTING.md          # MODIFIED — two-branch flow
AGENTS.md                # MODIFIED — branch targeting, hotfix, release process
scripts/                 # NEW — rulesets/cutover helper script(s)
```

**Structure Decision**: All changes are repository-root infrastructure;
no `packages/**` application code is modified (consistent with the
test-branch rule — this is CI plumbing, not product behavior).

## Phase 1 design artifacts

- [data-model.md](data-model.md) — branch/tag/PR entity states and invariants
- [contracts/pipelines.md](contracts/pipelines.md) — workflow trigger/input/output contracts
- [quickstart.md](quickstart.md) — cutover runbook + validation scenarios

## Complexity Tracking

No constitution violations — table omitted.
