# Feature Specification: GitHub Importer Expansion

**Feature Branch**: `011-github-importer-expansion`

**Created**: 2026-09-13

**Status**: Implemented

**Input**: User description: "Expand the GitHub importer to collect more information from a GitHub Organisation, Repositories, and other important information (e.g. costs, limits) using the GitHub REST API."

## Clarifications

### Session 2026-09-13

- Q: Should the `main`/`master` branch instance be automatically classified as `PRODUCTION`? → A: No — branch names are classified by the user through the same name→environment mapping as GitHub deployment environments (e.g. `main→PRODUCTION`, `develop→DEV`); no branch is automatically production.
- Q: Does a repository emit one branch instance per mapped branch, or only for its primary branch? → A: One instance per branch whose name appears in the environment mapping — the mapping is both classifier and selector for branches (e.g. `main→PRODUCTION` + `develop→DEV` yields up to two branch instances per repo).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Organization as a Catalog Asset (Priority: P1)

An operator configures the GitHub importer for their organization and sees the
organization itself appear in the component catalog as an **account-level**
asset carrying its profile, plan name, seat usage (filled vs. total), two-factor
enforcement state, member-privilege policies, and a summary of the org's teams
(names, member counts, privacy) — so the catalog answers "what does our GitHub
estate look like at the top level" without leaving Componode.

**Why this priority**: The organization is the root of everything else the
importer touches. It is the anchor for billing data, teams, and policy posture,
and it is the highest-value single addition for the least API surface.

**Independent Test**: Configure an importer against a GitHub org, run it, and
verify a single account-level component appears with plan, seat counts, policy
flags, and team summaries populated. Delivers value with zero other changes.

**Acceptance Scenarios**:

1. **Given** a configured GitHub importer pointing at an org, **When** a run
   completes, **Then** the catalog contains exactly one account-level component
   for that org showing plan name, filled/total seats, and 2FA enforcement.
2. **Given** an org with teams, **When** a run completes, **Then** the org
   component's details list each team's name, member count, and privacy setting
   — and no team components are created in the catalog.
3. **Given** the importer token is not an org owner, **When** a run completes,
   **Then** the org component still appears with public fields populated and
   admin-only fields reported as unavailable rather than absent.

---

### User Story 2 - Repositories with Real Deployment Topology (Priority: P1)

An operator browsing an imported repository sees its real deployment topology:
branch instances whose environment classification the operator controls through
the same name→environment mapping used for deployment environments (e.g.
`main→PRODUCTION`, `develop→DEV`, `release-x→STAGING`), plus one instance per
GitHub deployment environment (`staging`, `prod`, `qa`, …) — each showing what
was last deployed and when. No branch is automatically treated as production.

**Why this priority**: It upgrades the data the importer already emits into
something that reflects operational reality, and it exercises the
Environment-as-Instance model for its intended purpose.

**Independent Test**: Run the importer against a repo that has GitHub
environments and deployments plus a branch covered by the environment mapping;
verify the component shows the mapped branch instance with its configured
environment classification and one instance per deployment environment with
deployment-derived version and timestamp.

**Acceptance Scenarios**:

1. **Given** a mapping classifying `main` as production and a repo with a
   `main` branch, **When** imported, **Then** the repo has a production branch
   instance keyed on `main` with last-push timestamp.
2. **Given** a repo with GitHub environments `staging` and `prod`, **When**
   imported, **Then** it additionally shows a staging instance and a production
   instance derived from those environments, each carrying the latest deployed
   version and deployment time.
3. **Given** a repo whose branch names match no mapping entry, **When**
   imported, **Then** no branch instance is emitted — the mapping alone decides
   which branches become instances.
4. **Given** a repo is renamed on GitHub between runs, **When** the next run
   completes, **Then** the existing catalog component is updated in place (name
   changes, no duplicate, curated ownership/grouping preserved).

---

### User Story 3 - Cost & Usage Visibility (Priority: P2)

An operator opens the organization component and sees an aggregated billing
snapshot for the current (or previous) month: total gross/discount/net spend,
spend broken down by product/SKU, and the top repositories by attributed spend —
and can drill into a repository component to see its own attributed usage.

**Why this priority**: "What does GitHub cost us" is a headline question the
user explicitly asked for, but it depends on the organization asset (US1) and is
only available to admin tokens on the enhanced billing platform.

**Independent Test**: With an org-admin token on an enhanced-billing org, run
the importer and verify the org component carries a billing snapshot with
totals, per-product breakdown, and top-repo attribution; with a non-admin
token, verify the billing section reports its status explicitly instead of
silently missing.

**Acceptance Scenarios**:

1. **Given** an org-admin token on the enhanced billing platform, **When** a run
   completes, **Then** the org component's details contain the billing period,
   gross/discount/net totals, per-product breakdown, and up to 25 top repos by
   net spend.
2. **Given** billing usage attributed to repositories, **When** a run
   completes, **Then** each attributed repository component carries its net
   amount and per-product breakdown.
3. **Given** a token lacking billing permission or an org without enhanced
   billing, **When** a run completes, **Then** the org component's billing
   section reports `FORBIDDEN`/`UNAVAILABLE` status and the run still succeeds.
4. **Given** billing was visible last run and permissions are revoked, **When**
   a run completes, **Then** the marker replaces stale data — no phantom numbers
   persist.

---

### User Story 4 - Extended Inventory & Enterprise Reach (Priority: P3)

An operator can optionally widen the import to Actions workflows (as job
components), organization self-hosted runners (as compute components), and
organization packages (as registry components); and can point the importer at a
GitHub Enterprise Server host instead of github.com.

**Why this priority**: Each is independently valuable but not universally
wanted — they're opt-in toggles, and GHES support is a config field rather than
a behavior change.

**Independent Test**: Enable each toggle individually, run, and verify the
corresponding component type appears; point `baseUrl` at a GHES host and verify
the run proceeds identically (with billing reported unavailable).

**Acceptance Scenarios**:

1. **Given** `includeWorkflows` enabled, **When** a run completes, **Then** each
   repository's Actions workflows appear as job components.
2. **Given** `includeRunners` enabled and org-level self-hosted runners exist,
   **When** a run completes, **Then** runners appear as compute components with
   OS, labels, and online/busy state.
3. **Given** `includePackages` enabled, **When** a run completes, **Then**
   organization packages appear as package-registry components.
4. **Given** a `baseUrl` pointing to a GHES hostname, **When** a run completes,
   **Then** all enabled capabilities work identically, with unavailable
   endpoints (e.g. billing) reported via status markers.
5. **Given** a `baseUrl` that fails the URL safety policy (non-HTTPS, localhost,
   literal private IP), **When** the configuration is validated, **Then** it is
   rejected.

---

### Edge Cases

- **Reconciliation on toggle-off**: disabling a capability retires components
  that capability previously emitted (standard reconciliation) — operators must
  be able to see which toggle controls which component types.
- **Repos allowlist scoping**: when `repos` is set, org-level collection
  (organization, billing, runners, packages) still runs — the allowlist scopes
  repository-level assets only.
- **Environments with no deployments**: instance exists with `STOPPED` status.
- **Branch names with no mapping entry**: emit no instance — for branches the
  mapping is both classifier and selector; `main`/`master` are never implicitly
  `PRODUCTION`.
- **Repo with no mapped branches and no deployment environments**: the
  component is still cataloged with zero instances.
- **Rate limits**: large orgs approach hourly API budgets; the run logs the
  rate-limit budget at start and end and relies on backoff rather than failing.
- **Org renamed**: stable identifiers mean the org component updates in place.
- **Huge billing payloads**: itemized usage can be thousands of rows — only
  aggregates are stored, never raw line items.
- **Archived/forked repos**: enrichment respects `includeForks`/`includeArchived`
  exactly as listing does.
- **Multiple orgs**: one importer config per org; no cross-org aggregation.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The importer MUST emit one organization-level component per run
  (`github:organization`), classified under a new `ACCOUNT` component category
  representing "the provider-level billing/administrative container that owns
  assets" (GitHub org now; AWS account, Azure subscription later).
- **FR-002**: The new `ACCOUNT` category MUST be added via the constitutional
  three-way taxonomy update: taxonomy research note, `packages/core` constant +
  metadata, and a migration replacing the `components_category_check` CHECK
  constraint.
- **FR-003**: The org component MUST carry plan name, seat usage, two-factor
  enforcement, member-privilege policies, and disk usage when the token has
  sufficient permission.
- **FR-004**: The org component MUST carry a teams summary (name, member count,
  privacy) in its details. Teams MUST NOT be emitted as components and MUST NOT
  be linked to curated `Team` entities.
- **FR-005**: Repository components MUST use GitHub's stable numeric repository
  ID as `externalId` (breaking change from `full_name`): renamed/transferred
  repos update in place; pre-existing `full_name`-keyed components retire and
  re-create once.
- **FR-006**: Every emitted asset type MUST use stable numeric identifiers for
  `externalId` (org id, repo id, `repo-id:workflow-id`, runner id, package id).
- **FR-007**: The importer MUST emit one branch instance per repository branch
  whose name matches an entry in the environment mapping (built-in defaults +
  `environmentMapping` overrides) — e.g. `main→PRODUCTION`, `develop→DEV`
  yields both a production and a dev instance where both branches exist. Branch
  names with no mapping entry emit no instance; no branch name is automatically
  `PRODUCTION`. Branch instance `deployedAt` reflects last activity on that
  branch.
- **FR-008**: Each GitHub deployment environment MUST emit one instance, mapped
  to the environment enum via a default name mapping
  (`prod/production/live→PRODUCTION`, `staging/stage→STAGING`,
  `dev/develop→DEV`, `test/qa→TEST`, `demo→DEMO`, unmatched→`OTHER`),
  overridable per-config via `environmentMapping`. The same mapping governs
  branch instances per FR-007 — for branches it acts as both classifier and
  selector, while environment names always emit an instance (unmatched→`OTHER`).
- **FR-009**: Environment instances MUST derive `status` from the latest
  deployment state (`success→RUNNING`, `failure→ERROR`,
  `in_progress`/`queued→RUNNING`, never deployed→`STOPPED`), `version` from
  latest deployment ref → latest release tag → null, and `deployedAt` from
  deployment timestamp → release publish time → null. Branch instances carry
  `version` = branch name and `deployedAt` = last activity on that branch
  (per FR-007).
- **FR-010**: The org component MUST carry an aggregated billing snapshot for
  the configured period (current or previous month): totals (gross, discount,
  net), per-product/SKU breakdown, and top repositories by net spend capped at
  25 — never raw line items.
- **FR-011**: Repository components MUST carry attributed spend (net amount +
  per-product breakdown) in details where the source provides per-repository
  attribution.
- **FR-012**: Every capability that can fail due to permissions or platform
  availability MUST record an explicit status marker (`OK`, `FORBIDDEN`,
  `ERROR`, `UNAVAILABLE`) in the org component's details, log a warning, and
  MUST NOT fail the run.
- **FR-013**: The config schema MUST expose per-capability toggles with these
  defaults: `includeOrganization`/`includeBilling`/`includeEnvironments`/
  `includeReleases` on; `includeWorkflows`/`includeRunners`/`includePackages`
  off; plus `billingPeriod` ("current"/"previous"), `environmentMapping`, and
  `baseUrl`.
- **FR-014**: `includeWorkflows` emits each repo's Actions workflows as `JOB`
  components; `includeRunners` emits org-level self-hosted runners as `COMPUTE`
  components (repo-level runners out of scope); `includePackages` emits org
  packages as `PACKAGE_REGISTRY` components.
- **FR-015**: `baseUrl` MUST pass the shared URL-safety guard (HTTPS-only,
  hostname-based — literal private IPs rejected), enabling GHES while
  preserving the SSRF posture.
- **FR-016**: Authentication remains a single PAT secret; the spec MUST document
  required token scopes (`read:org` minimum; org-admin/`admin:org` for billing).
- **FR-017**: The importer MUST log the API rate-limit budget at run start and
  end (observability only — rate limits are never emitted as assets).
- **FR-018**: All API traffic MUST pin the documented GitHub API version
  (2026-03-10) via request headers.
- **FR-019**: Security-scanning endpoints (Dependabot, code scanning, secret
  scanning alerts) MUST NOT be consumed — Componode is not a security scanner.

### Key Entities

- **Component** (`ACCOUNT` category, new): the GitHub organization — one per
  config, anchor for billing/teams/capability markers in `details`.
- **Component** (`REPOSITORY`, existing): gains stable `externalId` and
  per-repo billing attribution.
- **ComponentInstance** (existing): gains real environment-derived instances
  alongside the branch instance; status/version/deployedAt become meaningful.
- **DiscoveredAsset.details** (existing contract): free-form JSONB carrying the
  org profile, teams summary, billing snapshot, and capability markers.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After one run, 100% of org-level facts the token can access
  (plan, seats, policies, teams) are visible on the organization component.
- **SC-002**: 100% of repositories with GitHub deployment environments display
  them as instances with correct environment classification; repository
  renames produce zero duplicate components.
- **SC-003**: With an admin token, the billing snapshot is present and
  aggregated; with a non-admin token, 100% of inaccessible capabilities show an
  explicit status marker — zero silently-absent sections, zero run failures.
- **SC-004**: A 1,000-repository organization completes a full run within one
  API rate-limit window (≈1 hour) without manual intervention.
- **SC-005**: Disabling any capability cleanly retires only that capability's
  components on the next run; re-enabling restores them.

## Assumptions

- Authentication stays PAT-only (secrets shape unchanged); GitHub App auth is a
  future follow-up spec.
- Billing data is a **current-period snapshot** that overwrites each run —
  first-class cost history/attribution modeling is deferred to its own spec
  (it will matter for AWS/Azure too).
- Billing endpoints require org-admin permission and the enhanced billing
  platform; absence is expected and handled via status markers, including on
  GHES where these endpoints may not exist.
- Preview billing endpoints (usage summary, AI credit, premium requests) are
  consumed via generic requests alongside the typed ones.
- GitHub's per-environment deployment status requires extra API calls
  (≈2 per environment); accepted as the cost of accurate instance status.
- The `externalId` change (FR-005) is a one-time re-catalog for existing
  installs: previously curated ownership/grouping on repo components is lost
  and must be re-assigned. Accepted by the product owner.
