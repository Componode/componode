# Implementation Plan: Componode Playwright User Testing

**Branch**: `055-playwright-workload` | **Date**: 2026-11-02 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/055-playwright-workload/spec.md`

## Summary

Build a self-contained local Playwright Test workload that runs against the actual Componode application in an isolated Docker Compose project. Synthetic data and internal-only provider mocks exercise documented UI journeys, role and business rules, source-scoped importer reconciliation, pagination, authentication, URL Checks, and Agent execution. The workload emits sanitized reports and provides a maintainable coverage matrix for future product changes.

The implementation is handed to later Devin SWE-model sessions. This session produces the spec-kit artifacts and Playwright-specific research/handoff documentation only.

## Technical Context

**Language/Version**: TypeScript on Node.js 24, matching the repository runtime.

**Primary Dependencies**: Standalone pnpm 9 workspace under `playwright/`; pinned Playwright Test and a Playwright browser image at matching versions; pinned axe integration for accessibility checks. Select versions during implementation and comply with the repository's release-age and lockfile policies.

**Storage**: Disposable PostgreSQL 16.11 test database and project-scoped Compose volume. No ordinary development database or persistent application data is reused.

**Testing**: Full user journeys in Chromium at desktop and 768px viewports; smoke journeys in Firefox and WebKit; Playwright API request context for pagination, setup, and postconditions; automated accessibility checks on selected route/state combinations.

**Target Platform**: Local Docker Engine and Docker Compose on developer machines. The browser runner, app, database, mocks, Dex, and Import Agent are containerized.

**Project Type**: Standalone test-support workspace nested inside the Componode repository, not included in the root pnpm/Turbo workspace.

**Performance Goals**: No product performance/load-test target. Bound setup, health, probe, and teardown waits; begin with one worker for determinism.

**Constraints**:

- Runtime services are on an internal-only test network with no external gateway.
- The workload has independent host ports, env files, project name, PostgreSQL state, and volumes.
- Per-run credentials and keys stay under ignored `playwright/` paths matched by the existing root `**/.env*` Docker ignore rule.
- No production credentials, live provider requests, CI edits, root workspace edits, root Dockerfile edits, or PR to `main`.
- The current 054 URL Check onboarding implementation is not in the 055 worktree base. Integrate its committed changes before implementing or running dependent journeys.
- All Playwright-specific source, mocks, templates, references, fixture plans, and operator docs are under `playwright/`; the required spec-kit workflow artifacts stay under `specs/055-playwright-workload/`.

**Scale/Scope**: All 35 application-owned persistent tables are mapped; two migration bookkeeping tables are excluded. Five implemented importers receive local mock coverage; four scaffold importers remain deferred. All documented user-facing areas and Viewer/Editor/Admin boundaries are inventoried.

## Constitution Check

| Principle | Gate |
| --- | --- |
| I. Single-organization, self-hosted | Pass. Test actors model the existing global roles; no tenant or organization layer is added. |
| II. Importer-first | Pass. Mocks exercise existing pull-only importer behavior; no importer writes to the DB or depends on another importer. Core reconciliation remains responsible for durable Source membership. |
| III. Two-level taxonomy | Pass. Synthetic Component category/provider/resourceType values use existing controlled values; this workload adds no taxonomy. |
| IV. Environment-as-instance | Pass. Fixtures preserve the distinction between Component lifecycle and Component Instance operational status; first-instance recovery remains a focused flow, not general instance CRUD. |
| V. Factual vs. meaning layer | Pass. Importers create factual Components/Instances; product hierarchy and ownership are created through human UI/API flows. |
| VI. Test-first | Pass. The workload is itself test infrastructure. Each scenario is written and verified before supporting fixture or harness behavior is implemented; importer contract test rules remain in force. |
| VII. Observability | Pass. No production code path or runtime instrumentation is added. Test diagnostics use sanitized reports and existing app logs/metrics. |
| Security / API constraints | Pass. No product API is added or modified. No live secrets, host Docker socket, SQL raw fragments, global TLS bypass, or external runtime egress is introduced. |
| Dependency / CI constraints | Pass. Dependencies are isolated to the nested workspace with its own lockfile. CI stays unchanged. |

**Gate result**: Pass, subject to the 054 integration prerequisite and the implementation-time verification that test-generated secrets/certificates are excluded from the app image build context.

## Research Inputs

The decision summary is in [research.md](research.md). Detailed repository facts and first-party references live in:

- [`playwright/research/repository-facts.md`](../../playwright/research/repository-facts.md)
- [`playwright/research/official-references.md`](../../playwright/research/official-references.md)
- [`playwright/contracts/mock-api-contracts.md`](../../playwright/contracts/mock-api-contracts.md)
- [`playwright/data/fixture-matrix.md`](../../playwright/data/fixture-matrix.md)

## Architecture

### Workspace and file boundaries

Use a nested `playwright/pnpm-workspace.yaml` and local `package.json`/lockfile. Do not add `playwright/` to the root workspace or Turbo configuration. Keep Compose files, runner scripts, test code, mock servers, fixtures, templates, and reports under `playwright/`. Use a nested `.gitignore` for local env files, generated keys, auth storage, test results, and reports.

The root application Dockerfile remains unchanged and is referenced from the workload Compose file with repository root as build context. The root `.dockerignore` already excludes nested `**/.env*`; place runtime private material in `playwright/.env-private/` and test configuration in `playwright/.env.test`. During implementation, inspect the resulting build context to verify that neither private directory is sent to the app image builder.

### Compose topology

The workload Compose project contains:

- PostgreSQL 16.11 with a new project-scoped volume for every normal run.
- The app built from the existing root Dockerfile with test-only env and DB connection.
- Caddy with a Playwright-owned Caddyfile, local internal CA, app/Dex/provider routing, and distinct host port defaults.
- Playwright runner using a version-matched official browser image.
- Dex with a local static test user.
- Local GitHub, Alibaba RPC, Docker Engine mTLS, web/API, and URL Check target mocks.
- A real Import Agent service that connects to the local app over WSS.

All runtime services use the same internal-only Compose network. Do not attach an internet-enabled second network. Build/pull images before runtime startup. Use service aliases for mock DNS and `.test` target names; keep host port bindings configurable and preflighted.

Suggested default host bindings are app `3300`, HTTP `8080`, and HTTPS `8443`; verify they are free and permit overrides. The browser runner should reach the app using its internal HTTPS hostname, not the host-published port.

### TLS and identity

Use Caddy's internal CA for the app and local HTTPS routes. Install its root into the Playwright browser trust stores for Chromium, Firefox, and WebKit, and provide the root as an explicit Node CA bundle to the app and Agent. Do not use a global TLS verification bypass.

Configure Dex with an issuer hostname that is identical in the admin UI, browser redirects, and backend discovery. Use a static non-production test user, authorization code with PKCE, and the provider's real discovery/JWKS verification.

The Docker fake Engine endpoint has its own mTLS server/client certificate roles. Create and store those test-only credentials through Componode's supported Credential flow; do not mount the host Docker socket.

### Orchestration

A cross-platform Node orchestrator in `playwright/scripts/` owns the single-command lifecycle:

1. Preflight branch/worktree, Docker, Compose, port availability, environment values, and the 054 integration gate.
2. Generate random per-run test credentials and mock certs in ignored `.env-private/`.
3. Start base services and wait for health.
4. Allow app migrations and bootstrap the test Admin.
5. Seed baseline catalog data, create other test actors through app flows, and configure Dex/mocks.
6. Create a baseline Import Agent via the supported admin API/UI, save its one-use token only in `.env-private/`, then start the real agent container.
7. Run the serialized Playwright suite and write HTML/JUnit results plus failure-only evidence.
8. Clean up only the named Compose project and ephemeral DB on success or failure. Debug mode may retain the stack until an explicit workload-scoped down command.

The browser runner must not receive the Docker socket. The disconnected-Agent scenario uses a separate registered but unconnected Agent record.

### Data and fixtures

The planned tables and lifecycle sources are in [`playwright/data/fixture-matrix.md`](../../playwright/data/fixture-matrix.md); the spec-kit summary is [data-model.md](data-model.md).

- Migrations are the schema source of truth.
- Direct DB writes are limited to high-volume, non-sensitive baseline fixtures where constraints and FK order are respected.
- Credentials, users, sessions, OIDC, importer runs, Sources/memberships, AgentSessions, audit/history, and URL Check observations are generated through supported flows.
- Generate 201 Components for the component UI's pageSize-100 auto-fetch and 101 audit/Suggestions rows for default limit-50 offset pagination.
- Use stable slugs and deterministic fixture names, but unique per-run IDs or namespace prefixes to avoid cross-test leakage.
- Test add/change/remove where UI supports those operations; use retire, revoke, decide, or append-only lifecycle semantics where that is the product contract.

### User journey coverage

See [`playwright/coverage-matrix.md`](../../playwright/coverage-matrix.md). Test every documented route group with its appropriate role depth. Use semantic roles/labels and the codebase's accessible names before adding selectors. Required high-value flows include:

- Password login/logout, session list/revoke, registration off/on, Admin reset, Dex OIDC success/error, and role-aware navigation.
- Products, Components, Component Groups, organization, suggestions, importer configs/runs, Sources, Credentials, Docker targets, Agents, activity, and settings.
- Supported CRUD, retire/delete semantics, relationship writes, cycles/conflicts, validation, empty/error states, and API pagination.
- 054 first-instance recovery and composite URL Check creation; integrate the committed 054 changes before these tests are implemented or run.
- Credential and Agent preserve-versus-reconfigure permissions, including Editor switching Agent setup back to Hub.

### Importer mock coverage

Only implemented importers are in scope: Alibaba Cloud, GitHub, Docker, web URL, and API URL. AWS, Azure, Kubernetes, and MCP Server are scaffolds and are explicitly deferred until their implementations make provider calls.

- Each implemented importer gets provider mapping and deterministic success, empty, changed, omitted, and relevant error cases.
- GitHub is the one full reconciliation journey (add/update/omit/source-retire/shared-Source preservation).
- Alibaba fixed STS/BSS hostnames resolve to the local mock through network aliases and trusted TLS; Resource Center uses its endpoint override. The fake validates Action/Version/request/auth field presence but not cryptographic signatures.
- Docker uses a fake mTLS Engine API with only the read-only endpoint subset used by the importer.
- A private mock controller resets/selects profiles. It is not published and never forwards to external services.
- A coverage guard compares importer manifests/registry entries with the coverage matrix so a new implemented importer requires a mock/test mapping.

### Reporting, accessibility, browser matrix

- Playwright Test emits built-in HTML and JUnit outputs under ignored paths.
- Trace, screenshot, and video are retained only for failed tests.
- Tests that handle passwords, reset/enrollment tokens, or Credential values create them outside traced browser interaction where possible; disable request-body tracing or use redacted setup for cases where a value must be entered or read.
- All tests begin serially to protect shared fixture and mock state.
- Chromium runs the full desktop (1280px) and narrow-desktop (768px) suite; Firefox and WebKit run a high-value smoke subset.
- Focused automated accessibility checks cover the login, catalog, forms/dialogs, URL Check flows, and administration routes; keyboard assertions cover dialogs/forms. Automated scans do not replace manual review.
- No screenshot-diff baselines or visual approval workflow is required initially.

## Project Structure

### Spec-kit artifacts (workflow-required)

```text
specs/055-playwright-workload/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── checklists/requirements.md
└── tasks.md
```

### Playwright workload materials

```text
playwright/
├── README.md
├── HANDOFF.md
├── implementation-plan.md
├── coverage-matrix.md
├── quickstart.md
├── .gitignore
├── pnpm-workspace.yaml             # planned implementation file
├── package.json                    # planned implementation file
├── pnpm-lock.yaml                  # planned implementation file
├── playwright.config.ts            # planned implementation file
├── compose.test.yml                # planned implementation file
├── Dockerfile.runner               # planned implementation file
├── Caddyfile                       # planned implementation file
├── scripts/                        # orchestration and deterministic seed helpers
├── tests/                          # Playwright user journeys and accessibility checks
│   └── README.md                   # conventions and story organization
├── mocks/                          # provider, Docker Engine, URL target, and control APIs
├── fixtures/                       # synthetic non-secret provider response profiles
├── contracts/mock-api-contracts.md
├── data/fixture-matrix.md
├── research/repository-facts.md
├── research/official-references.md
├── templates/session-handoff.md
└── .env-private/                   # generated, ignored runtime credentials/certs
```

No app source, root package config, root Dockerfile, root `.dockerignore`, or CI workflow changes are planned.

## Delivery Phases

1. **Dependency gate and standalone workspace**: integrate 054; verify clean 055 base; add standalone pnpm package, lockfile, ignore rules, test skeleton.
2. **Isolation foundation**: preflight, internal Compose network, app/Postgres/Caddy health, fresh DB, ports and volume isolation, no-egress proof.
3. **Synthetic fixture and pagination**: table coverage matrix, supported-flow fixture setup, bulk Component boundary dataset, request-context pagination checks.
4. **Importer mocks**: contracts and control plane, then independent HTTP, GitHub, Alibaba, and Docker mTLS mocks; provider mapping tests; GitHub reconciliation journey.
5. **Authentication and user journeys**: local login/RBAC/OIDC, route groups, catalog/organization/admin state and CRUD; tests organized per story.
6. **URL Check monitoring**: first-instance/composite setup, four Hub auth modes, local observations, real Agent WSS, disconnected Agent missed state.
7. **Quality and maintenance**: accessibility, Chromium full runs, Firefox/WebKit smoke, reports, future importer guard, docs/handoff verification.

## Verification Gates

- **G0 - Base**: correct sequential worktree; 054 integrated before dependent tests.
- **G1 - Isolation**: prove regular app, database, ports, volumes, and env remain unchanged; runtime network has no external route.
- **G2 - Credentials**: inspect tracked files, test image build context, logs, reports, screenshots, and traces for private material.
- **G3 - Data**: all 35 app tables mapped; migration tables excluded; constraints and lifecycle respected; page boundaries verified.
- **G4 - Importers**: each of five implemented importers passes contract/mapping scenarios; all four scaffolds are explicitly skipped; GitHub reconciles source-scoped changes.
- **G5 - Journeys**: all route groups and three roles mapped, including auth, permissions, lifecycle, monitoring, and importer flows.
- **G6 - Evidence**: HTML/JUnit reports exist; failures retain trace/screenshot/video; passing cases do not.
- **G7 - Cross-browser/accessibility**: Chromium desktop/narrow suites and Firefox/WebKit smoke pass; accessibility findings are reviewed.
- **G8 - Repeatability**: two clean runs from a fresh database produce deterministic assertions and clean only the test project.

## Complexity Tracking

No constitution violations require a waiver. The test workload adds a standalone workspace and isolated Docker services without changing Componode production behavior.
