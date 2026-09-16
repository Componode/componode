# Research: GitHub Importer Expansion

**Date**: 2026-09-13 | **Spec**: [spec.md](spec.md)

All decisions below were resolved through a design review against the installed
SDK (`octokit@4.1.4`, `@octokit/plugin-rest-endpoint-methods@14`,
`@octokit/openapi-types@25`) and the GitHub REST docs at apiVersion 2026-03-10.
No open NEEDS CLARIFICATION items remain.

## R1 — SDK interface: Octokit (typed) + `octokit.request()` fallback

- **Decision**: Keep `octokit`. Use typed `octokit.rest.*` methods where the
  endpoint catalog covers them; use `octokit.request("METHOD /path")` with
  hand-typed response interfaces for preview endpoints.
- **Rationale**: Verified coverage — `orgs.get`, `teams.list`,
  `orgs.listMembers`, `repos.listForOrg`/`get`, `repos.getAllEnvironments`,
  `repos.listDeployments`, `repos.listDeploymentStatuses`, `repos.getBranch`,
  `repos.listReleases`/`getLatestRelease`, `actions.listRepoWorkflows`,
  `actions.listSelfHostedRunnersForOrg`, `packages.listPackagesForOrganization`,
  `billing.getGithubActionsBillingOrg`/`getGithubPackagesBillingOrg`/
  `getSharedStorageBillingOrg`/`getGithubBillingUsageReportOrg`,
  `copilot.getCopilotOrganizationDetails`/`listCopilotSeats`,
  `rateLimit.get`. Not covered by typed methods: `billing/usage/summary`,
  `billing/ai_credit/usage`, `billing/premium_request/usage`, budgets, cost
  centers — reachable via `octokit.request()`.
- **Alternatives**: GraphQL (`plugin-paginate-graphql` is bundled) — rejected to
  keep parity with REST docs and one auth model; raw `fetch` — rejected (loses
  pagination, throttling, retry).

## R2 — API version pin and GHES

- **Decision**: `new Octokit({ auth, baseUrl, request: { headers: {
  "X-GitHub-Api-Version": "2026-03-10" } } })`. `baseUrl` defaults to
  `https://api.github.com`; config override goes through `urlSafetyError`.
- **Rationale**: Octokit defaults to the 2022-11-28 header; pinning the docs
  version keeps response shapes aligned with what we verified. GHES support is
  one constructor option.
- **Constraint**: `urlSafetyError` rejects literal private IPs — GHES works by
  hostname only (documented posture, ADR-106).

## R3 — Auth: PAT only

- **Decision**: Single `token` secret. Documented scopes: `read:org` minimum;
  org-admin (classic `admin:org`) for billing endpoints.
- **Rationale**: GitHub App auth is nearly free on the SDK side
  (`@octokit/auth-app` is in the tree) but changes the secrets shape and adds
  installation-token caching — deferred to a follow-up spec.
- **Alternatives**: GitHub App (15k req/hr, granular perms) — follow-up.

## R4 — Organization modeling: `ACCOUNT` component

- **Decision**: Emit `github:organization` as `category: ACCOUNT` (new enum),
  `externalId: String(org.id)`, name = org display name ?? login, slug = login.
  All org-level facts live in `details` (see data-model.md).
- **Rationale**: `ACCOUNT` is the provider-neutral term for "the billing/
  administrative container that owns assets" — GitHub org now, AWS account /
  Azure subscription later. The constitution's three-way taxonomy update
  applies: research note + `core` constant + CHECK migration.
- **Alternatives**: `IDENTITY`/`OTHER` reuse (cheaper, wrong semantics);
  extending `DiscoveredAsset` with new entity kinds (amends ADR-057, large
  blast radius); teams as components or curated `Team` links (rejected — pollutes
  catalog, collides with meaning layer).

## R5 — `externalId` stability: numeric IDs (breaking)

- **Decision**: All asset types use stable numeric identifiers —
  repo `id`, org `id`, `{repoId}:{workflowId}`, runner `id`, package `id`.
  Repo `externalId` changes from `full_name` to `String(repo.id)`.
- **Rationale**: `full_name` breaks dedup on rename/transfer (old component
  retires, new one created, curation lost). Numeric ids are rename-stable.
- **Cost (accepted)**: existing installs re-catalog repos once — old
  `full_name`-keyed components retire and re-create; `teamOwnerId`/
  `componentGroupId` assignments must be redone. Documented in spec Assumptions.
- **Migration nuance**: matching old→new to preserve curation was considered
  (e.g. match on `details.htmlUrl`) — rejected as over-engineering; spec
  documents the loss explicitly.

## R6 — Branch + environment instance model

- **Decision**: One `ComponentInstance` per repository **branch whose name
  matches the environment mapping** (mapping = classifier + selector — no
  `main`/`master` default), plus one per **GitHub deployment environment**
  (mapping = classifier only, unmatched → `OTHER`).
- **Rationale**: user decision — no branch is implicitly production; operators
  declare topology via `environmentMapping`.
- **Default mapping**: `prod/production/live→PRODUCTION`,
  `staging/stage→STAGING`, `dev/develop→DEV`, `test/qa→TEST`, `demo→DEMO`.
  Config `environmentMapping: Record<string, Environment>` merges over
  defaults. Matching is case-insensitive, exact-name.
- **Branch instance fields**: `externalId: branch:{name}`,
  `version: {name}`, `deployedAt` = last commit date on that branch via
  `repos.getBranch` (1 call per mapped branch; `pushed_at` is repo-level only).
- **Environment instance fields**: `externalId: env:{name}`; `status` from
  latest deployment — `success→RUNNING`, `failure→ERROR`,
  `in_progress`/`queued→RUNNING`, never deployed→`STOPPED`; `version` = latest
  deployment ref → latest release tag → null; `deployedAt` = deployment
  `created_at` → release `published_at`.
- **Call cost (accepted)**: `getAllEnvironments` (1/repo) + per env
  `listDeployments(environment=name, per_page=1)` + `listDeploymentStatuses`
  (≈2/env). Environments per repo are typically 0–5.

## R7 — Billing: aggregated snapshot, not raw items

- **Decision**: Org `details.billing` = `{status, period, totals:{gross,
  discount, net}, byProduct[], topRepos[≤25]}`; repo `details.billing` =
  `{net, byProduct}` where `repositoryName` attribution exists.
- **Endpoints**: typed — actions minutes, packages storage, shared storage,
  usage report (`getGithubBillingUsageReportOrg`); via `octokit.request()` —
  `usage/summary`, `ai_credit/usage`, `premium_request/usage`. Period =
  `billingPeriod` config (`current`/`previous` month).
- **Rationale**: raw `usageItems` can be thousands of rows — unusable in JSONB
  and the `<pre>` details view. Snapshot overwrites per run; cost history is a
  future cross-importer spec (AWS/Azure parity).
- **Constraints**: org-admin + enhanced billing platform required; 403/404 →
  capability marker, never run failure. GHES: endpoints absent → `UNAVAILABLE`.

## R8 — Capability status markers

- **Decision**: Every optional/unreliable capability writes a status marker:
  `{status: "OK" | "FORBIDDEN" | "ERROR" | "UNAVAILABLE", message?}` inside its
  `details` section; a top-level `details.capabilities` summary mirrors them.
- **Rationale**: `details` is overwritten wholesale each run — silent omission
  makes data flicker. A marker explains absence in the catalog UI itself.

## R9 — Optional emitters (toggles, default off)

- **Workflows** → `JOB`, `github:workflow`, `externalId: {repoId}:{workflowId}`,
  details `{path, state, badgeUrl}` — `actions.listRepoWorkflows` (paginated,
  per-repo).
- **Runners** → `COMPUTE`, `github:runner`, `externalId: String(runner.id)`,
  details `{os, labels, status, busy}` — `actions.listSelfHostedRunnersForOrg`
  (org-level only; repo runners excluded — per-repo calls not worth it).
- **Packages** → `PACKAGE_REGISTRY`, `github:package`,
  `externalId: String(pkg.id)`, details `{packageType, visibility, url}` —
  `packages.listPackagesForOrganization` **requires `package_type`**; iterate
  all six types (`container`, `npm`, `maven`, `nuget`, `rubygems`, `docker`)
  paginated.

## R10 — Teams summary

- **Decision**: `teams.list` alone — response includes `members_count`,
  `repos_count`, `privacy`, and `parent` (nesting) — verified in
  `@octokit/openapi-types@25` schema. One paginated call, no per-team fanout.
  Members/outside-collaborator *lists* are not imported (names only in counts).

## R11 — Reconciliation interplay

- **Decision**: No contract changes needed. Toggle-off → that capability's
  components retire on next run (documented edge case). Failed runs skip
  reconciliation entirely (existing behavior in `import-run-service`), so a
  mid-run billing failure can't mass-retire components.

## R12 — Testing approach

- **Decision**: extend `test/importer.test.ts` — mock `globalThis.fetch` as a
  small router keyed on `url.pathname` (+ query where needed); assert emitted
  assets against `validateDiscoveredAsset`; cover: org asset shape, billing
  aggregation, marker on 403, env/branch instance mapping, toggle-off behavior,
  abort mid-run. Backend integration coverage stays on the existing
  import-run-service path (no new service code).
