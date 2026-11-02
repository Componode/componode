# Feature Specification: Deployment, CI/CD, and Generated Docs

**Feature Branch**: `007-deployment-cicd-docs`

**Created**: 2026-09-08

**Status**: Shipped

**Input**: User description: "the next step" (inferred from constitution v1.0.2: Docker Compose packaging, CI/CD changesets, and generated docs)

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Self-Host with Docker Compose (Priority: P1)

As a deployer, I want to install and run Componode on my own infrastructure with a single configuration file and one command so that I can start using the product without building it from source.

**Why this priority**: Componode is self-hosted by design (Constitution I). A reliable, documented deployment path is the last blocker to a usable v1 release. Without it, all prior features cannot be delivered to users.

**Independent Test**: A new user with a standard server and Docker installed can clone the repository, edit a small config file, and have a running Componode instance reachable in a browser.

**Acceptance Scenarios**:

1. **Given** the deployer has Docker and Docker Compose available on a single host, **When** they run the provided deployment command, **Then** the application starts, applies any pending schema migrations, serves the frontend, and responds on the configured port.
2. **Given** the application is already running, **When** the deployer runs the same command again, **Then** the deployment preserves existing data and does not overwrite the database.
3. **Given** a deployment failure (e.g., missing environment variable or port conflict), **When** the command fails, **Then** the deployer sees a clear, actionable error message and the system does not start in a partially configured state.

---

### User Story 2 - Release with Changesets (Priority: P2)

As a maintainer, I want to prepare and publish a new Componode version through a structured release process so that releases are versioned, changelogged, and reproducible.

**Why this priority**: A release process gives users confidence in upgrades and lets them know what changed. It also prevents manual version bumps and forgotten changelog entries.

**Independent Test**: A maintainer can open a changeset file for a code change, and the release workflow can consume all changesets to produce a version bump and changelog without manual editing.

**Acceptance Scenarios**:

1. **Given** a contributor has made a user-facing change, **When** they add a changeset describing the change, **Then** the changeset is stored in the repository and can be reviewed before release.
2. **Given** one or more unreleased changesets exist, **When** a maintainer triggers the release workflow, **Then** the workflow updates the version, generates a changelog, and creates a versioned release artifact.
3. **Given** a release is published, **Then** the release notes accurately reflect every unreleased changeset and the version follows semantic versioning.

---

### User Story 3 - Generated Documentation Site (Priority: P3)

As a user or contributor, I want to browse an up-to-date documentation site generated from the existing Markdown and OpenAPI sources so that I can learn how to deploy, use, and extend Componode without reading raw repository files.

**Why this priority**: Generated docs turn the existing `docs/` directory and `openapi.yaml` into a consumable site. This is the final polish that makes the project self-documenting and contributor-friendly.

**Independent Test**: A visitor can navigate to the published docs site and find deployment instructions, API reference, and importer development guidance that match the current state of the repository.

**Acceptance Scenarios**:

1. **Given** the repository contains `docs/*.md` and `docs/openapi.yaml`, **When** the docs site is generated, **Then** it produces a navigable site with those pages and the API reference.
2. **Given** a pull request changes `docs/openapi.yaml`, **When** the docs site is regenerated, **Then** the published API reference reflects those changes.
3. **Given** a user visits the docs site, **Then** they can find the deployment guide, architecture principles, and contributor guides within three clicks from the landing page.

### Edge Cases

- What happens if the deployer's host does not have Docker Compose available?
- How does the system handle a failed migration during a deployment upgrade?
- What happens if a changeset is missing for a user-facing change? (The release workflow can fall back to the maintainer-supplied `bump` input to create a release-bump changeset; if no `bump` is supplied, it fails.)
- What happens if the release workflow runs while a feature branch is still open?
- How are secrets (database credentials, OIDC client secrets) supplied without appearing in the repository?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The project MUST provide a deployment package that runs the backend, frontend, and database together on a single self-hosted machine.
- **FR-002**: The deployment package MUST support a small, editable configuration file for host-level settings (e.g., port, external domain, admin credentials, OIDC settings, database password references).
- **FR-003**: The deployment package MUST persist application data across restarts and upgrades.
- **FR-004**: The project MUST use a changeset-driven release process so that every release has a version bump and a human-readable changelog.
- **FR-005**: The release process MUST be triggerable by a maintainer through a standard repository action.
- **FR-006**: The release process MUST produce versioned release artifacts: a Git-tagged source archive and a tagged container image.
- **FR-007**: The project MUST generate a documentation site from the existing Markdown guides and OpenAPI reference.
- **FR-008**: The generated documentation site MUST update automatically when the source documentation changes.
- **FR-009**: The deployment guide in the generated docs MUST match the actual deployment package.

### Key Entities

- **Release**: A published Componode version with a version number, changelog, and associated artifacts.
- **Changeset**: A small, reviewable description of a user-facing change collected before a release.
- **Docs Site**: The generated, navigable publication of the repository's documentation.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A new deployer can install and start Componode in under 15 minutes from a fresh server. The smoke test enforces a 15-minute startup timeout.
- **SC-002**: A maintainer can cut a release by triggering one workflow and reviewing one pull request.
- **SC-003**: Every release includes a changelog that accounts for all user-facing changes since the previous release.
- **SC-004**: The generated docs site is reachable at a stable URL and is regenerated on every push to `main` (one generation cycle = one push-to-main build).
- **SC-005**: The deployment package passes a smoke test (application starts, user can log in, database is reachable) before a release is published.

## Assumptions

- The project remains self-hosted and single-organization (Constitution I), so multi-tenant deployment patterns are out of scope.
- The deployment target is a single-machine Docker environment, consistent with the v1 architecture.
- CI/CD uses the repository's chosen platform (GitHub Actions) and the chosen release tooling (changesets), which are binding decisions from the technology stack.
- The generated docs site does not introduce new documentation content; it publishes existing `docs/` and API reference artifacts.
- Generated docs and release automation are not required to run inside the product itself; they are repository-level developer/user affordances.
