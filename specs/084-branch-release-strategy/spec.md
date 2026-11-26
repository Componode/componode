# Feature Specification: Two-Branch Release Management Strategy

**Feature Branch**: `084-branch-release-strategy`

**Created**: 2026-11-26

**Status**: Shipped

**Input**: User description: "Implement the two-branch release management strategy: develop as default integration branch, main as release-only branch, changesets-derived versioning at promotion time, path-split docs publishing (/ and /dev/), full CI+e2e+scan parity on both branches, hotfix flow with back-merge, per the consolidated design agreed in the grilling session."

## Overview

This feature restructures the repository's branching, CI/CD, release, and
documentation publishing model. It is repository infrastructure work — the
"users" are the maintainers, contributors, and AI coding agents who work on
Componode. The design was fully validated in a structured grilling session;
every decision below is settled and recorded in the Requirements section.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Integration branch with full quality gates (Priority: P1)

A contributor (human or AI agent) merges feature work into `develop`, the
repository's default branch. Every pull request and push to `develop` runs
the complete quality gate suite: lint, typecheck, unit/integration tests,
build, dependency audit, end-to-end browser tests, dependency review, and
security scans. Merges are blocked until all gates pass, so `develop` is
always in a tested, scanned, compliant state.

**Why this priority**: This is the foundation of the entire strategy —
requirement #2. Without a gated integration branch, promotion to release
has no meaning.

**Independent Test**: Open a pull request targeting `develop` with a
deliberate lint error and verify the merge is blocked; fix it and verify
the merge proceeds. Value delivered: a permanently compliant integration
branch.

**Acceptance Scenarios**:

1. **Given** a pull request targeting `develop`, **When** any required
   quality gate fails, **Then** the merge is blocked by branch protection.
2. **Given** a pull request targeting `develop`, **When** all gates pass,
   **Then** the PR can merge (squash) without mandatory human approval.
3. **Given** code merged to `develop`, **When** a push occurs, **Then**
   the full quality gate suite and all security scans run on `develop`.
4. **Given** the repository, **When** a contributor opens a PR without
   specifying a base, **Then** the base defaults to `develop` because it
   is the repository's default branch.

---

### User Story 2 - Promotion-based release with derived versioning (Priority: P1)

A maintainer decides the current state of `develop` is worth releasing.
They trigger the release process manually. The system validates that
`develop`'s quality gates are green, derives the version bump from the
accumulated change records (no human version-choice error), prepares the
version through the protected-branch process, and opens a promotion
proposal from `develop` to `main`. The maintainer's act of merging that
proposal is the release approval. The release then publishes automatically:
a version tag is created, the container image is published, and the release
notes are published.

**Why this priority**: This is the core release flow — requirements #1
and #3. Versions are only ever bumped at promotion time, on a green
`develop`, and `main` only ever receives release-approved content.

**Independent Test**: Trigger the release process on a green `develop`
with accumulated change records and verify the promotion proposal appears
with a correctly derived version; merge it and verify the tag, image, and
release are published. Value delivered: a one-decision release process
with zero manual version bookkeeping.

**Acceptance Scenarios**:

1. **Given** `develop` with failing quality gates, **When** the maintainer
   triggers the release process, **Then** the process refuses to start and
   reports the failure.
2. **Given** accumulated change records on `develop`, **When** the release
   process runs, **Then** the version bump is derived from the change
   records without human input.
3. **Given** no accumulated change records, **When** the release process
   runs, **Then** the maintainer's manually chosen bump level is used as
   fallback.
4. **Given** the version preparation, **When** it enters `develop`,
   **Then** it passes through the same protected-branch gates as all other
   changes (no bypass actors).
5. **Given** an open promotion proposal to `main`, **When** its quality
   gates pass, **Then** a human must merge it manually — automatic merge
   is never used because the merge act is the release approval.
6. **Given** a merged promotion proposal, **When** `main` updates,
   **Then** a version tag is created automatically and the publish pipeline
   produces the container image and release notes.
7. **Given** a merge to `main` whose version was already tagged, **When**
   the tagging step runs, **Then** it fails loudly, surfacing the violation
   of the every-merge-is-a-release invariant.
8. **Given** a failed publish after tagging, **When** the maintainer
   re-runs the publish pipeline, **Then** it completes without errors
   caused by partial prior artifacts (idempotent).

---

### User Story 3 - Dual-track documentation publishing (Priority: P2)

A contributor merges documentation changes to `develop`. The development
documentation publishes to a clearly separated non-production location
under `/dev/`, so maintainers and AI tools can validate documentation
rendering before release. When a promotion merges to `main`, the
production documentation publishes at the root of the documentation site.
Neither track clobbers the other.

**Why this priority**: Requirement #4. Documentation errors should be
caught on `develop` before they reach the production documentation surface.

**Independent Test**: Merge a docs change to `develop` and verify it
appears only under the development documentation path; promote to `main`
and verify it appears at the production root. Value delivered: docs are
tested before they are production.

**Acceptance Scenarios**:

1. **Given** a push to `develop`, **When** the documentation pipeline
   runs, **Then** the development documentation is published under `/dev/`
   and the production documentation at `/` is unchanged in content.
2. **Given** a push to `main`, **When** the documentation pipeline runs,
   **Then** the production documentation at `/` reflects `main` and the
   development documentation under `/dev/` still reflects `develop`.
3. **Given** the development documentation, **When** a reader views it,
   **Then** it is clearly identifiable as non-production documentation.

---

### User Story 4 - Scan parity across both branches (Priority: P2)

Every scan that protects `main` — dependency auditing, dependency review,
static application security testing, supply-chain scoring — also runs on
`develop`. Findings surface in the repository's standard security and
scanning dashboards, queryable by both developers and AI tools, so issues
are acted on before promotion rather than discovered after release.

**Why this priority**: Requirement #5. Scans that only run on `main`
detect problems after they are already released; the entire point of the
integration branch is early detection.

**Independent Test**: Introduce a scannable issue on a branch targeting
`develop` and verify the finding appears in the scanning dashboards with
`develop` context before any promotion occurs. Value delivered: security
feedback shifted left by one full release cycle.

**Acceptance Scenarios**:

1. **Given** a push or PR to `develop`, **When** scans run, **Then**
   results are uploaded to the repository's code-scanning dashboard.
2. **Given** the scan configuration, **When** comparing branches, **Then**
   every scan type that runs on `main` also runs on `develop`.
3. **Given** a scan finding on `develop`, **When** a developer or AI tool
   queries the repository's security surfaces, **Then** the finding is
   visible and attributable to `develop`.

---

### User Story 5 - Emergency hotfix flow (Priority: P3)

A critical defect is found in the released version while `develop` contains
unreleased feature work. A maintainer branches a hotfix off `main`, includes
the fix and its version bookkeeping in the hotfix proposal itself, and
merges it to `main` — releasing the fix without shipping the unreleased
features. The fix and its bookkeeping then flow back into `develop` through
an automatically opened back-merge proposal.

**Why this priority**: Lower frequency but high criticality when needed;
the design explicitly permits this exception to "main only receives
develop".

**Independent Test**: Create a hotfix branch off `main` with a fix and
version bookkeeping, merge it, and verify the release publishes and the
back-merge proposal to `develop` opens. Value delivered: emergency releases
without being hostage to in-flight work.

**Acceptance Scenarios**:

1. **Given** a hotfix branch off `main`, **When** the proposal is opened,
   **Then** it contains the fix, its change record, and the version bump —
   auditable in a single proposal.
2. **Given** a merged hotfix, **When** `main` updates, **Then** the
   version tag and publish pipeline run exactly as for a promotion.
3. **Given** a merged hotfix, **When** the back-merge automation runs,
   **Then** a proposal from `main` to `develop` opens automatically.
4. **Given** pending change records on `develop`, **When** the back-merge
   lands, **Then** those records remain unconsumed so the next promotion
   still derives its version correctly.

---

### Edge Cases

- What happens when a promotion proposal is open and new work merges to
  `develop`? The proposal updates naturally because its head is `develop`
  itself; the maintainer judges whether the additions were intended for
  this release — the merge act remains the human approval.
- What happens when the tag creation step finds the version already
  tagged? It fails loudly, detecting violation of the invariant that every
  merge to `main` carries a version bump — including trivially small
  hotfixes, which still force a patch release.
- What happens when a publish pipeline fails partway (e.g. registry
  outage)? The pipeline is idempotent and re-runnable; a documented manual
  recovery procedure covers the remaining cases. No automatic rollback of
  `main` exists — recovery is human judgment.
- What happens when the back-merge of a hotfix conflicts with `develop`?
  The proposal opens anyway and a human resolves the conflict.
- What happens to the ~35 accumulated unreleased change records present at
  cutover time? Nothing — they consume normally at the first promotion.

## Requirements *(mandatory)*

### Functional Requirements

**Branch structure and protection**

- **FR-001**: The repository MUST have two long-lived branches: `develop`
  (default, integration) and `main` (release-only).
- **FR-002**: `develop` MUST be the repository's default branch so that
  pull requests, dependency automation, and contributor tooling target it
  naturally.
- **FR-003**: Both branches MUST be protected against direct pushes; all
  changes arrive via pull request with all required quality gates green.
- **FR-004**: `main` MUST reject pull requests whose head is any branch
  other than `develop` or a `hotfix/*` branch.
- **FR-005**: Pull requests to `develop` MUST NOT require mandatory human
  approvals (quality gates are the enforcement mechanism); automatic merge
  MAY be used.
- **FR-006**: Promotion and hotfix merges to `main` MUST be performed
  manually by a human — automatic merge MUST NOT be used — because the
  merge act constitutes the release approval.
- **FR-007**: Promotion and back-merge pull requests MUST use merge
  commits (not squash) so that `develop` and `main` remain genealogically
  linked and future promotion diffs show only new work; feature pull
  requests to `develop` MAY use squash merges.

**Quality gates**

- **FR-008**: The continuous integration suite (lint, typecheck, test,
  build, dependency audit, documentation consistency checks) MUST run on
  pushes and pull requests to both `main` and `develop`.
- **FR-009**: End-to-end browser tests MUST run as a required gate in
  continuous integration on both branches — closing the gap where project
  policy mandates them but the pipeline never enforced them.
- **FR-010**: Dependency review MUST run on pull requests to both branches.
- **FR-011**: Every security scan that runs on `main` MUST also run on
  `develop`, including static application security testing for all
  supported languages on pushes and pull requests to both branches, and
  supply-chain scoring.
- **FR-012**: Scan results MUST be uploaded to the repository's standard
  code-scanning and security dashboards, queryable by developers and AI
  tools; no automated issue-filing bots are created.

**Versioning and release**

- **FR-013**: Version bumps MUST occur only as part of the promotion
  process (or inside a hotfix proposal) — never at any other time.
- **FR-014**: The promotion process MUST be triggered manually by a
  maintainer; the release decision is human while the mechanics are
  automated.
- **FR-015**: The promotion process MUST refuse to start when `develop`'s
  latest quality gates are not green.
- **FR-016**: The version bump MUST be derived from accumulated change
  records; a manual bump-level input serves strictly as fallback when no
  change records exist.
- **FR-017**: The version preparation MUST enter `develop` through the
  standard protected-branch process (a version proposal with automatic
  merge once green); no protection bypass actors are granted to any
  automation.
- **FR-018**: After the version preparation merges, the promotion proposal
  from `develop` to `main` MUST be opened automatically.
- **FR-019**: On any merge to `main`, a version tag MUST be created
  automatically from the repository's declared version; if the tag already
  exists, the step MUST fail loudly.
- **FR-020**: Every merge to `main` MUST constitute a release (invariant:
  the declared version on `main` is always ahead of the last tag); even
  trivially small hotfixes produce a patch release.
- **FR-021**: Tag creation MUST trigger the publish pipeline, which
  produces the versioned container image and published release notes.
- **FR-022**: The publish pipeline MUST be idempotent — re-running it for
  the same tag after a partial failure completes successfully.
- **FR-023**: A documented manual recovery procedure for publish failures
  MUST exist; no automatic rollback of `main` is implemented.

**Documentation publishing**

- **FR-024**: The documentation pipeline MUST run on pushes to `develop`
  and publish development documentation under a `/dev/` path, clearly
  identifiable as non-production.
- **FR-025**: The documentation pipeline MUST run on promotion to `main`
  and publish production documentation at the site root.
- **FR-026**: Neither documentation track MUST clobber the other; both are
  rebuilt and deployed together so each always reflects its own branch.

**Hotfix flow**

- **FR-027**: Hotfix branches MUST branch off `main` and merge back to
  `main` carrying the fix, its change record, and the version bookkeeping
  in a single auditable proposal.
- **FR-028**: After a hotfix merges to `main`, a back-merge proposal from
  `main` to `develop` MUST be opened automatically.

**Cutover**

- **FR-029**: The change MUST land as a single pull request to `main`
  containing all pipeline, configuration, and documentation updates while
  `main` is still the only long-lived branch, followed by branch creation
  and repository settings changes, then a smoke test.
- **FR-030**: Contributor-facing documentation MUST be updated to describe
  the two-branch model, including agent-facing instructions.
- **FR-031**: Dependency automation MUST be retargeted to `develop`.
- **FR-032**: The change-record tooling configuration MUST be updated so
  its base branch is `develop`.

### Key Entities

- **`develop` branch**: The integration line. Always green, always ahead
  of `main` in content except immediately after promotion.
- **`main` branch**: The release line. Every merge is a release; receives
  content only from `develop` promotions and `hotfix/*` branches.
- **Promotion proposal**: The pull request from `develop` to `main`; its
  manual merge is the release approval.
- **Change record**: A per-feature declaration of change magnitude,
  accumulated on `develop` and consumed at promotion to derive the version
  bump.
- **Version tag**: The immutable release marker; its creation triggers
  publishing.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of merges to both long-lived branches pass through pull
  requests with all quality gates green — zero direct pushes.
- **SC-002**: A maintainer can execute a complete release with exactly two
  human actions (triggering the process, merging the promotion proposal)
  and zero manual version bookkeeping.
- **SC-003**: 100% of scan types that run on `main` also run on `develop`,
  verified by comparing pipeline configurations.
- **SC-004**: Documentation changes merged to `develop` are publicly
  visible in the development documentation within minutes of merging,
  without any change to production documentation content.
- **SC-005**: A critical hotfix can be released without shipping any
  unreleased feature work present on `develop`.
- **SC-006**: A re-run of a failed publish pipeline for the same version
  completes successfully without manual artifact cleanup.

## Assumptions

- The repository hosting platform supports one documentation site per
  repository; development and production documentation share the site
  separated by path.
- The project is effectively maintained by a small number of maintainers
  plus AI agents, so mandatory human approval requirements on `develop`
  would be theater; quality gates are the real enforcement.
- The ~35 accumulated unreleased change records at cutover consume
  normally at the first promotion — no migration of them is needed.
- Feature branches and the specification-driven workflow are unchanged;
  they simply target `develop` instead of `main`.
- Security scanning coverage gaps discovered during implementation (e.g.
  scan types currently enabled only through platform-level configuration
  rather than in-repository configuration) are migrated to in-repository
  configuration as part of this work, since platform-level configuration
  cannot express per-branch parity.
