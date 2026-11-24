# Feature Specification: Supply-Chain Hardening (OpenSSF Scorecard Remediations)

**Feature Branch**: `082-supply-chain-hardening`

**Created**: 2026-11-23

**Status**: Draft

**Input**: User description: "Remediate the OpenSSF Scorecard repository-level
findings that require no application-code changes: pin every GitHub Actions
`uses:` reference to a full commit SHA with version comments, declare
least-privilege top-level `permissions` in workflows missing them, pin every
container base image to a registry digest in the four Dockerfiles (plus compose
image references), and add the repo-root `LICENSE` (Apache-2.0 per ADR-002) and
`SECURITY.md` files that the Scorecard License and Security-Policy checks
require."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - CI/CD and release automation can no longer be silently retargeted (Priority: P1)

Every third-party GitHub Action the repository runs — checkout, pnpm setup,
Node setup, dependency review, artifact upload, SARIF upload, Scorecard,
Docker build/publish, Pages deploy — is referenced by a mutable tag today. A
compromised or retagged action release would silently change what CI executes
with `GITHUB_TOKEN` and registry credentials in scope. The maintainer needs
every `uses:` pinned to an immutable commit SHA (with the human-readable
version preserved as a comment), and workflows that lacked a default
permission grant to run with `contents: read` so a stolen `GITHUB_TOKEN`
cannot write by default.

**Why this priority**: Tag-mutable action references and absent default
permissions are the two highest-impact Scorecard findings
(Pinned-Dependencies, Token-Permissions); both are pure YAML edits with zero
product risk.

**Independent Test**: `grep -rn 'uses:.*@v[0-9]' .github/workflows` returns
zero matches; every `uses:` carries a 40-hex SHA plus a `# vX.Y.Z` comment;
`ci.yml` and `release.yml` declare top-level `permissions: contents: read`
while required job-level write grants are unchanged.

**Acceptance Scenarios**:

1. **Given** any workflow file under `.github/workflows/`, **When** its
   `uses:` entries are inspected, **Then** each is a full-length commit SHA
   with a version comment, and the SHA resolves to the tagged release it
   names.
2. **Given** `ci.yml`, **When** a job runs without a job-level `permissions`
   block, **Then** its `GITHUB_TOKEN` is read-only.
3. **Given** `release.yml`, **When** the version/publish jobs run, **Then**
   their job-level `contents: write` / `packages: write` /
   `pull-requests: write` grants still apply (behavior unchanged).
4. **Given** Dependabot already proposes newer versions (#277–#280), **When**
   the pins are chosen, **Then** they point at the newer version's SHA so the
   open Dependabot PRs are superseded, not duplicated.

---

### User Story 2 - Container builds resolve the same base image every time (Priority: P1)

The four Dockerfiles and the compose files reference base/service images by
mutable tag (`node:24.22.2-alpine`, `mcr.microsoft.com/playwright:v1.64.1-noble`,
`postgres`, `caddy`, `dex`). A republished tag — or a poisoned registry mirror —
changes what ships and what e2e tests run against. The maintainer needs every
image reference pinned to its multi-arch manifest-list digest so builds are
byte-reproducible.

**Why this priority**: Base-image pinning is the container half of the same
Pinned-Dependencies finding; the Playwright stack is the project's e2e
gate, so its image integrity matters as much as the runtime image's.

**Independent Test**: `grep -rn '^FROM ' Dockerfile* playwright/Dockerfile*`
shows an `@sha256:` digest on every line; the same for `image:` entries in
`docker-compose.yml` and `playwright/compose.test.yml`; digests resolve via
`docker buildx imagetools inspect`.

**Acceptance Scenarios**:

1. **Given** each of the four Dockerfiles, **When** `FROM` is inspected,
   **Then** it reads `image:tag@sha256:<digest>` where the digest is the
   registry's current multi-arch index digest for that tag.
2. **Given** `playwright/Dockerfile.runner`, **When** pnpm is provisioned,
   **Then** corepack is used if the base image provides it, otherwise the
   `npm install -g pnpm@9.15.2` line carries a comment explaining why.
3. **Given** the compose files, **When** service images are inspected,
   **Then** `postgres`, `caddy`, and `dex` references are digest-pinned.

---

### User Story 3 - The repository declares its license and vulnerability-reporting channel (Priority: P1)

Scorecard's License and Security-Policy checks score zero today: there is no
`LICENSE` file despite ADR-002 selecting Apache-2.0, and no `SECURITY.md`
telling researchers how to report. The maintainer needs both files at the
repo root with canonical content.

**Why this priority**: Legal clarity (license) and a private disclosure
channel (security policy) are prerequisites for an open-source project that
handles credentials; they also close two Scorecard checks outright.

**Independent Test**: `LICENSE` contains the complete Apache License 2.0 text
ending with "END OF TERMS AND CONDITIONS" plus the APPENDIX; `SECURITY.md`
documents supported versions, a private reporting channel, and response
expectations.

**Acceptance Scenarios**:

1. **Given** the repo root, **When** `LICENSE` is read, **Then** it is the
   verbatim Apache-2.0 text.
2. **Given** `SECURITY.md`, **When** a researcher reads it, **Then** they can
   identify the supported versions and reach the GitHub private advisory
   channel without guessing.

---

### Edge Cases

- **Annotated vs lightweight tags**: action SHAs must resolve to the tag's
  target commit (`repo/commits/<tag>`), not the tag object.
- **Already-pinned actions** in `scorecard.yml` are bumped to the
  Dependabot-proposed newer versions rather than re-pinning stale SHAs.
- **Playwright base image lacks corepack** (apt-packaged Node): keep the
  npm install with an explanatory comment rather than installing corepack.
- **Roadmap ordering**: spec 081 is still in flight on its own branch — the
  082 roadmap entry is appended after the last shipped entry on `main`
  (080) and may need merge-time ordering when 081 lands.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Every `uses:` in `.github/workflows/{ci,release,scorecard,docs}.yml`
  MUST be a 40-hex commit SHA followed by a `# vX.Y.Z` comment; zero
  `@vN`/branch/tag references remain.
- **FR-002**: Where a Dependabot PR proposes a newer action version, the pin
  MUST use the newer version's SHA (checkout v7.0.1, scorecard-action
  v2.6.0, codeql-action v4, upload-artifact v7.0.2).
- **FR-003**: `ci.yml` and `release.yml` MUST declare top-level
  `permissions: contents: read`; existing job-level write grants MUST NOT
  change.
- **FR-004**: Every `FROM` in `Dockerfile`, `Dockerfile.agent`,
  `playwright/Dockerfile.mocks`, and `playwright/Dockerfile.runner` MUST
  carry the registry's current multi-arch `@sha256:` digest.
- **FR-005**: `image:` references in `docker-compose.yml` and
  `playwright/compose.test.yml` MUST be digest-pinned likewise.
- **FR-006**: `LICENSE` at the repo root MUST contain the complete,
  unmodified Apache License 2.0 text.
- **FR-007**: `SECURITY.md` at the repo root MUST state supported versions,
  GitHub private vulnerability reporting as the channel, response
  expectations, and scope notes covering OIDC/importer credential handling.
- **FR-008**: The change MUST NOT touch `packages/**` source, MUST NOT merge
  or modify Dependabot PRs, and MUST NOT alter any endpoint (no
  `docs/openapi.yaml` regeneration needed — no API change).
- **FR-009**: `docs/roadmap.md` MUST gain an `082-supply-chain-hardening`
  bullet plus the shipped-prose append so `docs:oracle:check` stays green.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: `grep -rn 'uses:.*@v[0-9]' .github/workflows` → 0 matches;
  100% of `uses:` entries are SHA-pinned with version comments.
- **SC-002**: `grep -rn '^FROM ' Dockerfile* playwright/Dockerfile*` → every
  line contains `@sha256:`; same for compose `image:` lines.
- **SC-003**: Re-running Scorecard shows Pinned-Dependencies,
  Token-Permissions, License, and Security-Policy findings closed or
  materially improved.
- **SC-004**: `pnpm --filter @componode/backend docs:oracle:check` passes;
  `pnpm lint` passes; no application code changed.

## Assumptions

- Tag-to-SHA resolution uses the GitHub API; SHAs were resolved at author
  time and recorded in `tasks.md`.
- The existing `scorecard.yml` `permissions: read-all` and job-level
  `security-events: write` / `id-token: write` grants are already correct
  and stay.
- Branch-protection and other console-side Scorecard findings are
  maintainer actions outside code scope (same boundary as spec 081).
