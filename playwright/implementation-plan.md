# Implementation Plan

## Goal

Deliver a repeatable, local-only browser-testing workload that checks Componode user journeys, business rules, importer behavior, pagination, monitoring, and role boundaries. Its setup and output must be isolated from the ordinary project Docker environment.

The authoritative requirements are in [`../specs/055-playwright-workload/spec.md`](../specs/055-playwright-workload/spec.md); executable status is tracked only in [`../specs/055-playwright-workload/tasks.md`](../specs/055-playwright-workload/tasks.md).

## Architecture

### Standalone workspace

- Put the test package, pinned dependency manifest, lockfile, config, scripts, and tests under `playwright/`.
- Add a nested `playwright/pnpm-workspace.yaml` so pnpm uses this folder as an independent workspace. Do not modify the root workspace or lockfile.
- Use the Playwright Test package and a version-matched official Playwright Docker image. At implementation time, select a pinned, compatible release that meets the repository's minimum release-age policy.
- Start with one worker because seeded database state and mock scenarios are shared and mutable.

### Isolated local Compose environment

The Compose file belongs in `playwright/` and uses the root application Dockerfile with the repository root as a read-only build context. Use the dedicated Compose project name `componode-pw`, distinct from the normal root project `componode`. A normal run removes only that project's volumes before creating a fresh database; if a prior debug stack remains, preflight fails with a scoped cleanup instruction rather than silently reusing its data. The project has its own:

- Non-default, overrideable host ports, with preflight checks that fail on collision.
- PostgreSQL 16.11 service, fresh project-scoped volume, migrations, and synthetic fixtures.
- App service pointed only at the test PostgreSQL service and per-run credentials.
- Caddy service for test HTTPS and internal host routing.
- Playwright runner/browser service.
- Dex OIDC service.
- GitHub, Alibaba, Docker Engine, web/API, and URL Check target mocks.
- Real Import Agent service for Agent-vantage probes.

All runtime services use an internal-only Compose network. Image pulls and builds occur before the runtime network is brought up; the test network has no external gateway. Do not attach an application or mock service to a second public network.

Use the existing root Dockerfile and `.dockerignore` unchanged. The current `**/.env*` pattern excludes `.env.test` and the planned `.env-private/` runtime-secret directory from the root build context. Keep all generated secrets and certificates under `.env-private/`; verify the effective Docker build context during implementation.

Use default port suggestions such as app `3300`, HTTP `8080`, and HTTPS `8443`, but allow overrides through `playwright/.env.test`. These are defaults, not assumptions that the ports are free.

### TLS and local DNS

- Use a test Caddy configuration under `playwright/` with the internal CA for the application and local HTTPS mock hostnames.
- Trust the Caddy root CA in the Chromium, Firefox, and WebKit test image. The app and Import Agent trust the Caddy/mock CA through explicit CA bundles. Do not globally disable certificate validation.
- Use Compose network aliases with `.test` hostnames for URL Check targets so the application URL-safety validator accepts a hostname while Docker resolves it to a local mock.
- Route GitHub's configurable HTTPS `baseUrl` to the local GitHub mock.
- Route Alibaba's configurable Resource Center endpoint to its mock. Add Docker network aliases for the fixed `sts.aliyuncs.com` and `business.aliyuncs.com` hosts and serve certificates with those SANs from the trusted local CA.
- Configure Dex's issuer URL through a local Caddy hostname so browser and app see the same issuer and the app can verify discovery and ID-token signatures.

### Orchestration and credentials

A single cross-platform Node orchestration command should:

1. Validate Docker availability, branch/worktree identity, safe test environment values, and host-port availability.
2. Generate unique per-run admin and application secrets, CA material, and mock credentials under ignored `playwright/.env-private/`.
3. Start the test Compose project and wait on explicit health checks.
4. Allow the app to run migrations and bootstrap a local admin.
5. Create the baseline Dex/agent/credential state through supported application flows where secrets or lifecycle behavior are involved.
6. Start the Import Agent after its one-time enrollment token has been created, mounting that token from the ignored private directory.
7. Seed bulk deterministic catalog records, run tests, produce reports, and remove the disposable stack on normal completion or failure.

A separate debug command may leave the stack running. Cleanup must always name the test Compose project explicitly and must never use broad Docker prune operations.

## Data and pagination strategy

The matrix in [`data/fixture-matrix.md`](data/fixture-matrix.md) is authoritative for the 35 application-owned persistent tables. The two Kysely migration bookkeeping tables are excluded.

- Use direct database fixtures only for bulk, non-sensitive baseline records after migrations, preserving constraints, UUID v7 IDs, unique slugs, and foreign-key order.
- Create passwords, Credentials, OIDC configuration, Import Agents, sessions, ImporterRuns, Source memberships, audit/history rows, and URL Check observations through supported application flows or the real local execution paths.
- Use lifecycle operations rather than artificial CRUD for append-only history, session, Source, observation, and status tables.
- Create at least 201 Components. This supplies two full 100-row UI auto-fetch pages plus a tail, and also supports explicit API checks with the default 50-row page size.
- Create at least 101 activity and Suggestions records for their default 50-row offset/limit APIs. The UI has no visible pagination controls, so test these API boundaries through Playwright's request context.
- Keep the mock state deterministic and serialized. A private control endpoint can select fixture scenarios, but it must be reachable only on the internal test network and must not imitate a provider-facing endpoint.

## Importer mock design

The current implemented scope is `alibaba-cloud`, `github`, `docker`, `web-url`, and `api-url`. AWS, Azure, Kubernetes, and MCP Server are scaffolds and remain deferred until implementation exists.

- Every implemented importer receives mapping/contract coverage with success, changed, error, and applicable empty/omitted-inventory fixtures. Single-endpoint URL importers use empty body/payload and response-error cases rather than fictitious inventory omission.
- GitHub is the representative full cross-run reconciliation scenario because it returns multi-asset inventories and supports pagination. Verify add, update, omission/retirement, and shared-Source preservation there.
- Web URL and API URL use local HTTP responses.
- GitHub uses its local HTTPS base URL, REST response envelopes, `Link` pagination headers, organization fallback/error semantics, and capability-specific failures.
- Alibaba returns signed RPC response shapes. The mock validates Action, Version, request shape, and presence of auth fields without validating cryptographic signatures. STS and BSS are resolved by internal host aliases; Resource Center uses its endpoint override.
- Docker uses an mTLS fake Docker Engine API, not the host Docker socket or a privileged Docker-in-Docker service. Implement only the API v1.41+ GET endpoints the importer calls and use synthetic engine/container/Swarm/image data.

Exact endpoint lists and primary sources are in [`contracts/mock-api-contracts.md`](contracts/mock-api-contracts.md) and [`research/official-references.md`](research/official-references.md).

## User journeys and verification

Cover every documented navigation area with the appropriate journey depth and role. The [coverage matrix](coverage-matrix.md) tracks route groups, roles, table lifecycles, importers, probes, and future change obligations.

High-priority paths:

- Local login/logout, sessions, registration disabled/enabled, admin-generated password reset, OIDC configuration and Dex login/error cases.
- Catalog, product relationships, Component Groups, organization, Suggestions, settings, activity, Sources, importer configs/runs, Credentials, Docker targets, and Agents.
- Role-based positive/negative actions for Viewer, Editor, and Admin.
- The current 054 URL Check onboarding feature: active zero-instance recovery, first-instance 201, invalid input, unauthenticated 401, missing Component 404, retired/inactive denial, duplicate instance 409, subsequent check creation, composite auth fields, and no duplicate Component.
- Credential and Agent preserve-versus-reconfigure rules, including an Editor being allowed to switch an Agent setup back to Hub.
- Hub probes for NONE, BASIC, BEARER, and CUSTOM_HEADERS; the local target reports only expected match booleans/header names, never raw values.
- Real connected Import Agent probe success and a separate registered-but-disconnected Agent missed-probe path.

The 054 implementation changes are a blocking dependency. The new worktree does not contain their uncommitted files. Do not start these dependent journeys until the 054 commit is available on the 055 branch.

## Results and accessibility

- Write HTML and JUnit reports under ignored paths in `playwright/`.
- Retain traces, screenshots, and video only for failed tests; never write credential values into the report, trace annotations, mock control output, or application logs.
- Tests that directly handle passwords, password-reset tokens, enrollment tokens, or Credential values should create them outside the traced browser interaction where possible. Where a value must be entered or read in a browser/API response, disable request-body tracing for that test or use a redacted fixture path; never print the value in test output.
- Run focused accessibility scans on key routes and high-risk interaction states, with keyboard assertions for dialogs/forms. Automated scans supplement human review.
- Use Chromium for full journeys at 1280px and 768px; run smoke journeys in Firefox and WebKit. Do not create screenshot-diff baselines in the initial delivery.

## Delivery phases and gates

1. **Dependency and workspace gate**: verify 054 integration, create standalone package and task status convention.
2. **Isolation foundation**: prove unique ports/env/database/volume and no runtime egress before seeding application data.
3. **Synthetic data and pagination**: create the table lifecycle matrix, high-volume boundary fixtures, and request-context pagination tests.
4. **Importer contracts**: implement mock endpoints independently, then contract/mapping journeys for all five implemented importers.
5. **Application journeys**: add local password/OIDC, route groups, CRUD/relationships, role boundaries, and accessibility scans.
6. **Monitoring journeys**: complete first-instance recovery, Hub auth probes, real Agent enrollment/WSS, and offline missed state.
7. **Evidence and maintenance**: add reporters, cross-browser smoke, future coverage checks, handoff/runbook, then validate from a clean disposable run.

Every phase and its acceptance criteria is broken into executable checklist tasks in `../specs/055-playwright-workload/tasks.md`.
