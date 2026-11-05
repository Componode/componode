# Componode Improvement Opportunities: Devin Research and Planning Brief

Nov 5, 2026 · @Estevan

## How to use this brief

Devin should validate each opportunity against the code, research the unknowns, and return an implementation plan. Do not start building until the owner approves that plan.

**Project:** [Componode source](https://github.com/Componode/componode) and [documentation](https://componode.github.io/componode/). Componode is an open-source, self-hosted catalog that models digital products as compositions of imported components.

**Goal:** Make Componode more trustworthy, easier to try and more useful, with low implementation and maintenance cost.

**Non-goals:**

- Competing with commercial tools or matching their feature sets
- Multi-tenancy or a hosted service
- Features that need permanent maintainer attention

**Project constraints:**

- The maintainer is one person using AI-assisted development, so prefer small, reversible changes.
- Importers report facts. Humans author meaning. Importers must never create Digital Products or product edges.
- Keep the existing spec-driven workflow, ADRs and changesets.
- Treat the published status as accurate: this is a learning project, not a production-grade solution.

**Working rules for Devin:**

1. Re-verify every finding against the latest `main` first, because the repo changes quickly.
2. Mark each finding as confirmed, changed or no longer applies.
3. Read existing ADRs before proposing a design, and name any ADR you need to amend.
4. Reuse existing services and patterns before adding a dependency.
5. Effort figures here are estimates, so replace them with your own evidence-based sizing.

## Repository baseline

This brief reflects commit `11c86a7` on `main`, dated 5 November 2026. Specs 001 to 062 exist, so the next spec number is 063.

| Area | Current state | Evidence |
| --- | --- | --- |
| Live importers | GitHub, Alibaba Cloud, Docker, API URL, Web URL | `docs/importers/index.md` |
| Scaffold importers | AWS, Azure, Kubernetes and MCP emit placeholders only | `docs/importers/aws.md` and `packages/importer-*/src` |
| Product model | `COMPOSES`, `CONSUMES_FROM`, `DEPENDS_ON`, per-environment instances, derived health | `docs/digital-products.md` |
| Component relationships | Read-only view shipped in spec 060, but no code inserts rows | `component-relationship-service.ts` and code search |
| Impact analysis | Direct dependents only | `GET /components/{id}/dependents` |
| Export | UI section exists behind `flags.advancedOps`, with no API behind it | `settings/advanced.tsx`, gap G19 |
| Machine access | Session cookie and agent bearer only | `docs/openapi.yaml` security schemes |
| Notifications | None found in backend code | Code search |
| Certificate monitoring | None found in URL checks | Code search |
| Releases | No git tags, and packages are at 1.0.0 while docs refer to 1.1 | `git ls-remote --tags`, `package.json` |
| Licence | README and `package.json` claim Apache 2.0, but no `LICENSE` file is tracked | `git ls-files` |

**Rules that bind this work:**

- `.specify/memory/constitution.md` holds seven binding principles. Test-first is non-negotiable.
- `AGENTS.md` says to implement only from `tasks.md` under `specs/`, never from `.devin/plans` or temporary notes.
- Use the `speckit-*` skills in `.devin/skills/` for feature work.
- `CONTEXT.md` sets the vocabulary. For example, say "Importer", never "connector".
- The importer contract excludes relationships in v1, under ADR-057 and principle V.
- Monitoring state stays separate from importer status and product health, under ADR-123.

**Evidence limits:** This review read the code and docs. It did not run the app or test suite, and it did not review open GitHub issues. Check those before relying on any finding.

## Priority overview

Finish Phase 0 first, then deliver Phase 1, which needs no new integrations. Estimates assume part-time, AI-assisted work and must be re-sized by Devin.

| ID | Opportunity | Value | Estimate | Depends on |
| --- | --- | --- | --- | --- |
| P0-1 | Add `LICENSE` file | Very high | Under 1 hour | None |
| P0-2 | Add `SECURITY.md` | High | Under 1 hour | None |
| P0-3 | First tagged release and version alignment | Very high | 1 day | P0-1 |
| P0-4 | Correct upgrade documentation | High | Under 1 hour | P0-3 decision |
| P0-5 | Add SBOM attestations to images | Medium | Under 1 hour | P0-3 |
| P0-6 | Validate OIDC `redirect_uri` | High | 2 to 4 hours | None |
| P0-7 | Bound the OIDC state store and rate limit OIDC routes | Medium | 2 to 4 hours | None |
| P0-8 | Reject placeholder secrets at startup | High | 2 to 4 hours | None |
| P0-9 | Add contributor intake | Medium | 2 hours | None |
| P0-10 | Label scaffolds and fix documentation drift | High | 2 to 4 hours | None |
| P0-11 | Shared guarded fetch for SSRF | High | 1 to 2 days | None |
| P1-1 | Transitive "what breaks?" view | Very high | 1 to 3 days | None |
| P1-2 | Runnable demo catalog | Very high | 1 to 2 days | P0-8 design |
| P1-3 | Catalog export | High | 1 to 2 days | None |
| P2-1 | Real Kubernetes importer | Very high | 3 to 5 days | None |
| P2-2 | Label-based suggestions | High | 1 to 2 days | P2-1 |
| P2-3 | Real Azure importer | High | 2 to 4 days | P2-2 helpful |
| P2-4 | Real AWS importer | High | 3 to 5 days | P2-2 helpful |
| P3-1 | Scoped read-only API tokens | High | 2 to 4 days | None |
| P3-2 | TLS certificate expiry on URL checks | Medium | 2 to 3 days | None |
| P3-3 | Generic outbound webhook | Medium | 3 to 5 days | P0-11 |
| P3-4 | Importer starter kit | Medium | 1 day | P2-1 |

&#91;embedded content: delivery roadmap · 4 phases, 3 gates, 22 items\]

Three links cross phases: P0-8 shapes P1-2, P0-11 is required for P3-3, and P2-1 informs P3-4.

## Phase 0: Project basics and security fixes

These items remove legal, security and adoption blockers at very low cost. Most should need only a small bugfix spec, but Devin should confirm that against the constitution.

### P0-1: Add `LICENSE`

- **Evidence:** `README.md` links to `LICENSE`, and `package.json` declares `Apache-2.0`, but `git ls-files` finds no such file.
- **Proposal:** Add the unmodified Apache 2.0 text at the repository root. Add `NOTICE` only if needed.
- **Research:** Check whether bundled dependencies need attribution in release artifacts.
- **Done when:** GitHub detects Apache 2.0, and the README badge link resolves.

### P0-2: Add `SECURITY.md`

- **Evidence:** `docs/security.md` exists, but no root policy tells reporters how to disclose privately.
- **Proposal:** Document supported versions, private reporting, expected response and the "not production-grade" status. Prefer GitHub private vulnerability reporting.
- **Done when:** The repository's Security tab shows the policy, and private reporting is enabled.

### P0-3: First tagged release and version alignment

- **Evidence:** There are no git tags, so no tag-triggered release has run. Packages say 1.0.0, while docs and the constitution refer to 1.1. `release.yml` builds the default `Dockerfile`, so it appears not to publish an agent image.
- **Proposal:** Choose the correct version, apply changesets, run `scripts/release-dry-run.sh`, then tag the release. Publish hub and agent images at the same tag, because agents must match the hub in lockstep.
- **Research:** Check whether the pending changeset files produce a sensible changelog.
- **Done when:** A tagged GitHub release exists, both images pull from GHCR, and docs state one version.

### P0-4: Correct the upgrade documentation

- **Evidence:** `docs/deployment.md` runs `docker compose down`, `pull`, then `up -d`. The `app` and `agent` services are `build:`-only, so this should not rebuild them.
- **Proposal:** After P0-3, offer two paths. Use `up -d --build` for source installs, and pinned `image:` tags for release installs.
- **Done when:** A smoke test upgrades from one commit to another and reports the new version.

### P0-5: Add SBOM attestations

- **Evidence:** `release.yml` sets neither `sbom` nor `provenance`. [Docker's guide](https://docs.docker.com/build/ci/github-actions/attestations.md) says SBOM attestations are off by default. Public repositories get `mode=max` provenance by default.
- **Proposal:** Set `sbom: true` and explicit `provenance: mode=max` on every image build.
- **Done when:** `docker buildx imagetools inspect` shows both attestations on a released image.

### P0-6: Validate OIDC `redirect_uri`

- **Evidence:** `packages/backend/src/routes/auth.ts` passes `query.redirect_uri` to `initiateLogin` unchanged. The callback then redirects to `${redirectUri}?csrf=${csrfToken}`. The 13 September assessment rated this Medium, and the code is unchanged.
- **Proposal:** Accept same-origin relative paths only. Reject absolute URLs, `//` prefixes, backslashes and control characters, then fall back to `/`.
- **Research:** Check how the frontend uses this flow, because the assessment reported the OIDC button as unreachable.
- **Done when:** Tests prove that external, protocol-relative and encoded bypass values all redirect to `/`.

### P0-7: Bound OIDC state and rate limit OIDC routes

- **Evidence:** `oidc-service.ts` keeps login state in an in-memory `Map`, with no expiry or size limit. It's reachable from a public endpoint.
- **Proposal:** Add a short TTL and a maximum size. Add dedicated limits on `/auth/oidc/login` and `/auth/oidc/callback`.
- **Research:** Decide whether in-memory state is acceptable, given the single-container deployment.
- **Done when:** Expired state is rejected, memory stays bounded under load, and limits return 429.

### P0-8: Reject placeholder secrets

- **Evidence:** `.env.example` ships `COOKIE_SECRET=change-me-in-production` and `BOOTSTRAP_ADMIN_PASSWORD=ChangeMe123!`. Code search found no rejection of either value. `COOKIE_SECRET` is read only in `app.ts`.
- **Proposal:** In production, refuse to start with missing, placeholder or short secrets. Keep a clear error message, and make `smoke-test.sh` generate real values.
- **Research:** Review the fixed `postgres` and `componode_pw` database passwords in `docker-compose.yml` and `init-db.sql`.
- **Done when:** The app exits with a clear error on each sample value, and the Quickstart still works.

### P0-9: Add contributor intake

- **Evidence:** `.github` has a pull request template, but no issue templates. `CONTRIBUTING.md` needs review for depth.
- **Proposal:** Add templates for bugs, importer requests and security redirects. Add a code of conduct, and create `good first issue` labels.
- **Done when:** New issues start from a template, and at least five starter issues exist.

### P0-10: Label scaffolds and fix documentation drift

- **Evidence:** Scaffolds write placeholder rows into a real catalog. `AGENTS.md` says eight importers and omits Docker, while the README says nine. `docs/digital-products.md` shows AWS and Kubernetes assets as what importers "typically yield".
- **Proposal:** Show a "Preview" badge and warning for scaffolds in the importer form. Mark affected docs as illustrative until those importers are real.
- **Research:** Confirm how the current UI presents scaffolds. This review didn't run it.
- **Done when:** No user can create a scaffold config without seeing that it produces placeholder data.

### P0-11: Shared guarded fetch for SSRF

- **Evidence:** `url-safety.ts` checks the URL as written, and its own comment notes that a public hostname may resolve privately. `probe.ts` calls `fetch` directly, with no DNS pinning. `docs/importers/index.md` discloses this limit.
- **Proposal:** Build one guarded fetch in `@componode/core`. It resolves the hostname, rejects private and metadata addresses, pins the validated IP, and keeps redirects off.
- **Research:** Confirm how this works with `undici`, proxies, IPv6 and SDK-managed requests. Decide how the agent should apply it, since agents often probe private networks on purpose.
- **Done when:** Tests cover a public hostname resolving to `169.254.169.254`, plus DNS rebinding between validation and connection.

## Phase 1: Value from existing data

This phase makes current data more useful and the project easier to evaluate. None of it depends on a new external integration.

### P1-1: Transitive "what breaks?" view

**Why:** It answers the main question a catalog should answer. The docs already describe the walk from a failed instance up to a customer-facing product.

**Evidence:** `GET /components/{id}/dependents` returns direct dependents only, and it excludes reach through a Component Group. Per-environment blast radius is listed on the roadmap. Recursive queries already exist in `product-service.ts`, `product-edge-service.ts` and `catalog-coverage-service.ts`.

**Proposed behaviour:**

1. Start from a Component, including its Component Group memberships.
2. Find products with a direct or group `DEPENDS_ON` edge.
3. Walk up `COMPOSES` to parent products.
4. When a reached product is a `PLATFORM`, follow `CONSUMES_FROM` to its consumers.
5. Return each product with its type, owner, criticality, health and an explanation path.

**Research questions:**

- Is the mixed traversal safe? `COMPOSES` is a DAG, but `CONSUMES_FROM` may create cycles once combined. Use deduplicating recursion and a depth limit.
- What does "per-environment" mean when product edges have no environment? Instances are per-environment, so the view may only filter the starting instance status.
- How many paths per product should the response return?
- Which ADR does this amend, and does it extend ADR-128's read view?

**Done when:**

- A Component page shows every affected product, grouped by depth or type.
- The small bank worked example returns the expected chain.
- Retired products are excluded by default.
- The endpoint is read-only, computed on read, and available to `VIEWER`.
- Performance is measured against the Playwright bulk fixtures.

### P1-2: Runnable demo catalog

**Why:** Evaluators need cloud or GitHub credentials to see a populated catalog. A demo removes that barrier, and new docs screenshots show what it could contain.

**Evidence:** `playwright/scripts/seed.ts`, `seed-bulk.ts` and `seed-app-flows.ts` exist, but they target the test environment. The Quickstart has no demo path.

**Proposal:** Add one command that starts a stack with the small bank example. Seed through public APIs where possible, so the demo also proves those paths work.

**Research questions:**

- Should the demo be a Compose profile, an override file or a one-shot seed container?
- Can it reuse Playwright fixtures without shipping test mocks into production images?
- How should demo Components show believable provenance without pretending to be a real import?

**Security requirements:**

- Bind to loopback by default, and show a visible demo banner.
- Refuse to seed a database that already holds data.
- Generate demo credentials at runtime where practical, without weakening P0-8.

**Done when:** A new user reaches a populated dashboard, product map and impact view within five minutes, with no external accounts.

### P1-3: Catalog export

**Why:** Export gives users backup, reporting and freedom from lock-in. Those are core open-source expectations.

**Evidence:** The Advanced settings page draws an "Export catalog" button behind `flags.advancedOps`, but gap G19 confirms no API exists.

**Proposal:**

- Export curated data as YAML or JSON, using the existing `POST /products/bootstrap` format where possible.
- Export Components and Instances as JSON and CSV for reporting.
- Exclude credentials, tokens, sessions, password data and raw importer configuration.

**Research questions:**

- Which role may export? `VIEWER` can already read the catalog, but bulk export changes the risk.
- Does the audit need an export event? ADR-094 keeps `GET` free of domain side effects, so this may need a different route or a log entry.
- Should personal data, such as people's email addresses, be excluded by default?

**Security requirements:** Neutralise spreadsheet formula injection in CSV cells beginning with `=`, `+`, `-` or `@`. Stream large exports with size and rate limits.

**Done when:**

- Re-importing an unchanged export through bootstrap dry-run reports zero changes.
- Tests prove that no secret field can appear in any export.
- `flags.advancedOps` no longer hides a dead control.

## Phase 2: Real discovery

This phase turns the three most-referenced scaffolds into live importers. Follow `docs/importer-development.md`, and use the Alibaba Cloud importer as the main pattern. It's about 1,090 lines, with separate client, retry, mapping and capability modules.

All three importers share these rules:

- Read-only access only, and no writes to the source system.
- No secret values, environment variables or raw configuration payloads in catalog data.
- Optional sections degrade to capability markers rather than failing the run.
- Coverage summaries report discovered, imported and skipped resources.
- Support hub and Import Agent execution, with `testSecrets` where possible.
- Keep hub and agent package lists in lockstep, under ADR-116.
- Update generated docs, sidebar entries and importer pages.
- Plan how existing placeholder rows are retired when a scaffold becomes live.

### P2-1: Real Kubernetes importer

**Why first:** It fits the Import Agent model, and the `NAMESPACE_MATCH` suggestion signal is already waiting for this data.

**Evidence:** `packages/importer-kubernetes` has no Kubernetes client dependency. Its `resourceTypes` and `namespace` fields are only labels on placeholder assets.

**Proposed first scope:** Deployments, StatefulSets, DaemonSets and Services, plus Ingress hosts and CronJobs if the mapping stays simple. Record replica-derived status, image, namespace and allowlisted labels. Never read Secrets or container environment variables.

**Research questions:**

- Which authentication modes come first: in-cluster service account, kubeconfig file or both?
- What is the minimum `ClusterRole`? Publish a tested read-only manifest.
- How should environment be set: per config, per namespace rule or from a label?
- What is the stable source identity? ADR-120 allows `sourceKey` or endpoint, but cluster UID may be stronger.
- How do the same workloads across clusters map to one Component, several Components or a Component Group?
- Can Ingress hosts reuse importer-managed URL Checks from spec 058?
- Which official client adds the least size to hub and agent images?

**Done when:** A local `kind` cluster imports repeatably, removed workloads become `GONE`, and tests prove Secrets are never requested.

### P2-2: Label-based suggestions

**Why:** Name matching alone won't scale. Teams often already label ownership and application membership, and suggestions keep humans in control.

**Evidence:** `suggestion-signals.ts` supports `NAME_MATCH`, `TOPIC_TAG_MATCH` and `NAMESPACE_MATCH`. ADR-113 ratifies exactly these three signals, so a new signal needs an amendment.

**Proposal:** Add a `LABEL_MATCH` signal using an allowlist of keys. Start with [`app.kubernetes.io/part-of`](https://kubernetes.io/docs/concepts/overview/working-with-objects/common-labels) and `app.kubernetes.io/name`, plus configurable cloud tag keys such as `application`, `service` and `project`.

**Research questions:**

- Should allowed keys be global settings or importer config?
- What score should each key receive? Validate with fixtures to limit false positives.
- Does the new reason need a CHECK-constraint migration? `edge-suggestion.ts` and the migration suggest it does.
- Should the signal also propose owners, or stay limited to `DEPENDS_ON` edges?

**Done when:** Suggestions show a clear reason chip, nothing is auto-wired, and dismissed pairs never return.

### P2-3: Real Azure importer

**Why:** [Azure Resource Graph](https://learn.microsoft.com/azure/governance/resource-graph/overview) can query many subscriptions at once, returning common fields and provider properties. Microsoft describes it as a free service, and it needs read access.

**Research questions:**

- Should one config map to one subscription or many? ADR-120 uses `subscriptionId` as the source identity.
- Which authentication comes first: service principal secret, workload identity or managed identity?
- How should paging and throttling work? Microsoft publishes quota headers, but no numeric limits on the overview page.
- Are tags returned for every required resource type?
- How should `Microsoft.*` types map to Componode categories, and what happens to unmapped types?
- How can the importer handle Resource Graph's eventual consistency during reconciliation? A briefly missing resource must not become `GONE` too easily.

**Done when:** A live test subscription imports repeatably, unmapped types appear in coverage, and throttling produces a clear partial result or retry.

### P2-4: Real AWS importer

**Why:** AWS is the most prominent example in the project docs, and [Resource Explorer](https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/ResourceExplorer2.html) resembles the Alibaba Resource Center approach.

**Known constraints:**

- Search needs a view, and cross-region results need an aggregator index.
- Results stop at 1,000 per search, so queries must be split by region and service.
- `Complete: false` must become a coverage warning, not a silent gap.
- Tags only appear when the view includes them.
- Resource Explorer must already be enabled, so setup must be documented.

**Research questions:**

- Is Resource Explorer the right backbone compared with AWS Config queries or the Cloud Control API? Compare setup, cost, coverage and rate limits.
- Can the importer use Resource Explorer's `ListResources` API? The older SDK page reviewed here documents `Search` only, so check the current SDK v3 docs.
- How should the existing `sourceKey` move to an STS account identity without duplicate Components?
- How are multi-account organisations handled?
- Should credentials use assumed roles first, and how do agent-managed credentials fit?

**Done when:** A test account with more than 1,000 resources imports without silent truncation, using a published least-privilege IAM policy.

## Phase 3: Integration and operations

This phase lets Componode work with other tools. Each item adds attack surface, so design review matters more than build speed.

### P3-1: Scoped read-only API tokens

**Why:** Scripts and CI currently have no supported credential. Tokens would also enable later integrations such as an MCP server.

**Evidence:** `docs/openapi.yaml` lists `sessionCookie`, `agentBearer` and `csrfToken` only.

**Proposal:**

- Start with read-only tokens, then consider a separate bootstrap-write scope.
- Require an expiry date, show the value once, and store only a hash.
- Add a recognisable prefix, so secret scanners can detect leaked tokens.
- Limit a token to the creator's role, and revoke it when that account is disabled.
- Record creation, revocation and last use.

**Research questions:**

- Should tokens belong to people, or to service identities?
- How does bearer authentication fit `verifySession`, `requireRole` and CSRF checks? CSRF should apply to cookie sessions only.
- Does `lastUsedAt` conflict with ADR-094's rule on side-effect-free `GET` requests?
- Do logging redaction rules already cover `Authorization` headers on every path?
- Which ADRs and permissions in `rbac.ts` need amendment?

**Done when:** A token reads permitted routes, fails all write routes, stops at expiry and revocation, and never appears in logs.

### P3-2: TLS certificate expiry on URL checks

**Why:** Expired certificates cause avoidable outages, and URL checks already know the endpoints to watch.

**Evidence:** `packages/core/src/monitoring/probe.ts` uses `fetch`, which doesn't expose certificate details. No certificate-reading code was found. `CREDENTIAL_EXPIRING` offers a precedent for an attention item.

**Proposal:** Add a small TLS handshake check for HTTPS URLs. Record expiry and issuer, then raise an attention item within a configurable window.

**Research questions:**

- Should this run on each probe, or on a slower daily schedule?
- Does agent-vantage support need a protocol bump? Agents and hubs must stay in lockstep.
- Where should results live, given that monitoring state stays separate from instance status?

**Security requirements:** Apply the same SSRF policy as URL checks. Read certificate metadata only, and send no credentials on the handshake connection.

**Done when:** Tests cover valid, expiring, expired and self-signed certificates, plus blocked private addresses.

### P3-3: Generic outbound webhook

**Why:** Nothing currently pushes failures to the people who need them. A generic webhook avoids building email and per-vendor integrations.

**Evidence:** Code search found no webhook, Slack or SMTP code. Notification delivery is deferred as gap G15.

**Design warning:** Attention items are derived on read, so they aren't events today. Start with events that already happen on write, such as failed runs, auto-disabled checks and agent disconnects.

**Research questions:**

- Which three events are most useful for a first release?
- How should retries and delivery history work without adding a queue service?
- Can one payload format work with common chat webhooks, or should adapters wait?
- Is outbound delivery on the hub only, and what happens during restarts?

**Security requirements:**

- Sign payloads with HMAC, and store secrets in the credential store.
- Resolve DNS and pin the validated address, because `url-safety.ts` only checks the URL as written.
- Allow `ADMIN` configuration only, block redirects, and set strict timeouts.

**Done when:** A test receiver validates signatures, retries are bounded, and private-network targets are blocked.

### P3-4: Importer starter kit

**Why:** Importers are the best contribution path, but the guide says to copy `importer-github`, which is about 1,160 lines.

**Proposal:** Provide a minimal template or generator, plus a fixture-based test example and a checklist. Create one tracking issue for each requested source.

**Research questions:**

- Should this be a generator script, a template package or a smaller reference importer?
- Can it automatically update the hub and agent manifests, the registry and docs sidebar?
- Can a contract test suite verify any importer without provider credentials?

**Done when:** A new contributor can add a working importer from the kit without changing backend code.

## Later options and do-not-build list

These items stay out of the first plan. Revisit an item only when real demand appears or its stated blocker clears.

| Later option | Value | Start only when |
| --- | --- | --- |
| First relationship chain: Ingress to Service to Deployment | Gives spec 060 real data | An ADR amends ADR-057 for factual component edges |
| Ownership suggestions from CODEOWNERS or GitHub team access | Speeds up curation | Label suggestions prove useful |
| Read-only MCP server over the API | Lets assistants query ownership and dependencies | P3-1 ships |
| Backstage `catalog-info.yaml` import | Eases adoption for Backstage users | Users ask, and P3-1 ships |
| Helm chart | Simplifies Kubernetes deployment | The Kubernetes importer has users |

| Do not build now | Reason |
| --- | --- |
| Runtime importer plugins | Adds code-execution and supply-chain risk, while in-tree importers stay reviewable |
| Multi-tenancy | Conflicts with the constitution's first principle |
| Interactive graph editing | High UI cost, and read-only views cover most needs |
| Scorecards and maturity scoring | Outside the project's purpose, and `CONTEXT.md` avoids the term |
| TOTP and full notification preferences | OIDC can provide MFA, and webhooks cover first alerts |
| Backstage plugin or two-way sync | Creates ongoing upkeep and competing sources of truth |
| Risk scoring and security scanning | Explicitly deferred in project scope |

## Decisions, security rules and required output

Devin should research these decisions and recommend an answer, but the owner makes the final call. Return one plan that passes the security rules below.

### Open decisions for the owner

- [ ] Which version should the first release carry: 1.0.0 or 1.1.0?
- [ ] Should P1-1 remain one view, or be split into API and UI specs?
- [ ] Is a bundled demo acceptable in the main Compose file, or should it stay separate?
- [ ] Which role may export the catalog?
- [ ] Should Kubernetes ship before Azure and AWS, as proposed?
- [ ] Is Resource Explorer's setup burden acceptable for AWS users?
- [ ] Will API tokens belong to people or service identities?
- [ ] Which live cloud test accounts and budgets, if any, are available?

### Cross-cutting security rules

- **Least privilege:** Publish the minimum external permissions for every importer.
- **Data minimisation:** Store allowlisted fields only. Never store secrets, environment variables or raw provider payloads.
- **Outbound requests:** Reuse the guarded fetch from P0-11 for every new user-configurable destination.
- **Input handling:** Validate all new routes with strict Zod schemas that reject unknown fields.
- **Authorisation:** Enforce permissions on the API, never in the UI alone.
- **Output safety:** Follow RFC 7807 errors, and leak no internals or secrets.
- **Auditability:** Record security-relevant actions, while respecting ADR-094 for `GET` routes.
- **Supply chain:** Justify each new dependency, and prefer official SDKs.
- **Secure defaults:** New outbound or exposed features stay off until an admin enables them.

### Output required from Devin

1. A validation table covering every item, marked confirmed, changed or no longer applies.
2. Research notes in `researches/`, with cited sources for external APIs, limits and pricing.
3. A dependency-ordered plan, with revised estimates and the risks behind them.
4. The ADRs to create or amend, and any constitution conflicts.
5. A list of items that need a full spec, and items that qualify as small fixes.
6. Draft `spec.md` files for approved items, starting at spec 063 and using the `speckit-*` skills.
7. A test plan for each item, written before implementation under principle VI.
8. Answers to the open decisions, with a recommendation and trade-offs.

Stop after the plan and draft specs. Wait for owner approval before implementation.

### Sources

- [Componode repository](https://github.com/Componode/componode)
- [Componode documentation](https://componode.github.io/componode/)
- [AWS Resource Explorer API reference](https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/ResourceExplorer2.html)
- [Azure Resource Graph overview](https://learn.microsoft.com/azure/governance/resource-graph/overview)
- [Kubernetes recommended labels](https://kubernetes.io/docs/concepts/overview/working-with-objects/common-labels)
- [Docker attestations with GitHub Actions](https://docs.docker.com/build/ci/github-actions/attestations.md)
