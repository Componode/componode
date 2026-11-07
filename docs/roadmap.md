---
title: Roadmap
description: Shipped features and what is next.
---

# Componode Roadmap

Development proceeds as sequential spec-kit features under `specs/`. This
file tracks shipped and upcoming work — update it when a spec completes.

## Shipped (features 001–067, bugfix 066)

- `001-foundation` — core contracts, 24-table schema, auth, RBAC,
  observability.
- `002-importer-framework` — run service, scheduler, registry,
  reconciliation.
- `003-component-catalog` — component/instance services + UI, the 7 v1
  importers.
- `004-ux-shell` — sidebar shell, dark mode, dashboard, Ctrl+K search.
- `005-product-hierarchy` — product tree, typed edges, LOB/Team ownership.
- `006-audit-settings` — audit tables, activity feed, admin settings.
- `007-deployment-cicd-docs` — Docker Compose packaging, CI/CD, docs.
- `008-rfc-7807-errors` — RFC 7807 Problem Details across the API.
- `009-bugfix-spa-csrf` — SPA fallback + CSRF double-submit protection.
- `010-security-hardening` — remediation of the 2026-09 security assessment
  (OIDC verification, hashed sessions, SSRF guard, TLS defaults).
- `011-github-importer-expansion` — org accounts, billing snapshots,
  environment instances, GHES support.
- `012-bugfix-empty-body-content-type` — `Content-Type` handling on body-less
  requests.
- `013-credential-store` — encrypted in-app credential store (ADR-107).
- `014-bugfix-app-shell` — pinned shell chrome, width-aware sidebar.
- `015-ui-refresh` — emerald brand palette, faceted filters, mobile nav
  drawer.
- `016-bugfix-login-redirect` — first-login bounce caused by a stale session
  cache.
- `017-product-metadata` — practical catalog metadata: curated links, tags,
  product criticality, and display-only `sunsetAt` on products and
  components (ADR-111). Importer reconciliation never clobbers curated
  fields.
- `018-edge-rule-ergonomics` — any product type may be a `COMPOSES` parent
  (ADR-109); `CONSUMES_FROM` → `PLATFORM` unchanged. Platforms can finally
  compose their parts.
- `019-group-deps-health` — `DEPENDS_ON` may target a `ComponentGroup`
  (ADR-110: persisted group edges, read-time expansion with `sources[]`
  attribution, kind-discriminated removal, `componentIds[]` bulk wiring,
  delete guards both directions) and every product gets a derived read-only
  health rollup (ADR-112: production-first worst-of, `GONE`/`RETIRED`
  excluded) on detail, list, and the dashboard attention feed.
- `020-platform-product-workflow` — the full guided Platform Product
  workflow (ADR-017): a dashboard worklist detects components depended on
  by ≥2 products, and one atomic promotion creates the `PLATFORM` product,
  wires its `DEPENDS_ON` edge, rewrites chosen consumers to
  `CONSUMES_FROM`, and prompts for LOB/Team ownership. Promotion is also
  reachable from every component's detail page.
- `021-catalog-bootstrap` — practical-DPAM cold start (ADR-114): a
  declarative YAML/JSON bootstrap endpoint upserts products by derived slug
  and wires `DEPENDS_ON` edges by component slug/name/externalId, with
  strict whole-document validation, per-item atomicity, dry-run previews,
  and an idempotent `{created, updated, edgesAdded, skipped}` report; the
  Components list can create a product from checked components in one
  transaction, and the dependency picker wires multiple components per
  action.
- `022-edge-suggestions` — staged, human-reviewed `DEPENDS_ON` candidates
  (ADR-113): server-generated from name/topic-tag/namespace signals on
  import completion, product writes, and rescan; accept wires through the
  normal edge path with audit, dismiss is permanent, and `SUPERSEDED`
  tombstones keep covered or deliberately unwired pairs from regenerating.
- `023-coverage-and-hygiene` — read-only coverage layer: dashboard
  catalog-coverage figures wired to filtered worklists (`wired`/`unwired`
  component facet, `missing` product facet), a per-facet completeness chip
  on product rows and detail headers, platform consumer counts, and
  overdue-`sunsetAt` items in the attention feed — all derived per read,
  no persisted state.
- `024-alibaba-cloud-importer` — the eighth in-tree importer
  (`@componode/importer-alibaba-cloud`, ADR-115): Resource Center
  `SearchResources` backbone discovers an account's resources across all
  regions, `sts:GetCallerIdentity` powers the credential test and the
  ACCOUNT component, `GetResourceCounts` feeds a coverage summary that
  surfaces unmapped `ACS::*::*` skips, and opt-in
  `enrichResources`/`includeCosts` (`GetResourceConfiguration`,
  `DescribeInstanceBill`) degrade to capability markers. Adds the
  `ALIBABA_CLOUD` provider constant, metadata, and CHECK-constraint
  migration.
- `025-import-agents-foundation` — Import Agents (ADR-116): an agent process
  inside private/egress-only networks enrolls with a single-use token,
  receives a durable bearer credential, and streams to the hub over an
  outbound WebSocket with a lockstep `hello` handshake (protocol version +
  exact importer manifest). Hub tracks presence (`CONNECTED`/`OFFLINE`/
  `NEVER_CONNECTED`), session history, and six audited lifecycle actions;
  the UI adds agent management with a show-once enrollment dialog and
  copy-ready install command. Job dispatch is deferred to 027.
- `026-agent-managed-credentials` — a second credential kind beside
  `STORED` (ADR-117): `AGENT_MANAGED` rows hold only secret _references_
  (`env` names or files under the agent's `SECRETS_DIR`); values resolve
  on the agent host at test time and never cross the hub-agent channel.
  Kind is immutable and executor-checked (`AGENT_MANAGED` requires
  agent-bound configs; `STORED` can't bind to them; OIDC stays `STORED`).
  Remote `credential.test` dispatches over the agent stream with
  coverage checks (`CREDENTIAL_MISSING_KEY`), dispatch-time audit +
  `lastUsedAt`, timeout/disconnect handling, and sanitized,
  path-and-value-free errors both directions. Job dispatch and run-time
  secret delivery remain 027.
- `027-remote-import-execution` — bound configs run on the agent (ADR-116
  Amendment 2): `job.assign`/`job.ack`/`asset.batch`/`phase`/`run.error`/
  `run.complete`/`cancel` frames are live; the hub dispatcher owns capacity
  (per-agent `maxConcurrentJobs`), dispatch/ack timeouts
  (`AGENT_UNAVAILABLE`), NACK→errorType mapping (`AGENT_INCOMPATIBLE` /
  `SECRET_RESOLUTION_FAILED`), session-lifeline failures (`AGENT_LOST`,
  never resumed), and agent-stream cancellation. Configs gain an
  Execution selector with save-time and dispatch-time policy gates;
  runs, agents, configs, and the dashboard all name the executor
  (`OFFLINE_AGENT` attention item).
- `028-agent-operations-observability` — operational visibility for Import
  Agents (ADR-116 Amendment 3, protocol v2): the agent runs an
  unauthenticated, GET-only ops listener (`/healthz`, `/readyz`,
  `/metrics` — `AGENT_OPS_*` envs, non-fatal bind, Docker HEALTHCHECK)
  with a nine-series local metric catalog; every heartbeat carries an
  `ops` snapshot (uptime, active jobs, cumulative job/asset/credential-
  test/secret-resolution/reconnect counters) persisted to
  `import_agents."reportedStatus"` and surfaced labeled agent-reported on
  `GET /agents/{id}` and `GET /agents` alongside `lastHeartbeatAt` and
  `lastDisconnectReason`; the hub gains dispatch-wait, remote-job-
  duration, session-duration, and last-contact series, and the UI shows
  an Agent-reported block with a stale-heartbeat signal plus a
  last-disconnect column. Remote Import Agents program complete.
- `029-ux-rewrite` — the v1.1 UX baseline: the v0 prototype ported under
  `/ux` (design tokens, primitives, and patterns scoped to `.ux-root`)
  and wired to the live API — dashboard, products (authoring, promote,
  bootstrap import, history), components, component groups, suggestions,
  activity, import operations (importers, runs, agents), org, and
  settings. Backend capabilities the API lacks render flagged fallbacks
  tracked in `researches/ux-rewrite-gaps.md`.
- `030-self-service-profile` — first ux-rewrite gap resolution (G14):
  `PATCH /users/me` bound to the session user behind a strict
  `updateSelfSchema` (`displayName` + `email` only — privileged keys
  rejected, not stripped), reusing `updateUser` for identical audit
  attribution; the profile page uses the self path for all roles and the
  `profileSelfEdit` fallback is retired.
- `031-importer-run-aggregates` — ux-rewrite gap G1: `GET
/importer-configs/:id/run-aggregates?days=N` returns zero-filled
  per-day run buckets (runs, failed count, asset created/updated sums)
  computed server-side; the importer-card sparkline renders live data and
  `historyAggregates` is on.
- `032-session-visibility` — ux-rewrite gap G2: sessions persist
  `userAgent` + `ip` at creation (migration 020); session lists return
  `device` (parsed label), `ip` location, `userId`, and a caller-relative
  `current` marker — all four session flags on.
- `033-detail-reads-feed-names` — ux-rewrite gaps G7/G8/G9/G11:
  `GET /teams/:id` and `GET /lobs/:id` ship; all three detail reads
  (teams, LOBs, component groups) resolve id-or-slug so `/ux/*/:slug`
  pages drop list-and-match; audit feed, entity history, and run changes
  carry server-resolved `entityName`/`fromEntityName`/`toEntityName`
  (read-time lookup — history and renames covered, null fallback on
  unresolvable rows).
- `034-team-lob-association` — ux-rewrite gap G12: `teams.lobId` links a
  team to at most one LOB (migration 021, ADR-077 Amendment 1 — advisory,
  `ON DELETE SET NULL`, not counted in the LOB delete guard); team writes
  accept and validate it, team reads embed a resolved `lob` summary. The
  product form groups its team picker by the selected LOB (that LOB's
  teams first, all others reachable below — nothing hidden), the team
  dialog assigns the association, team detail shows its LOB, and LOB
  detail/grid list their teams.
- `035-bugfix-user-form-validation` — user creation surfaces server
  validation detail: `VALIDATION_FAILED` `invalid-params`/`details` render
  inline per field (not a bare "Invalid input" toast), the username
  `pattern` is escaped for the `v` flag, and password `minLength` matches
  `PASSWORD_MIN_LENGTH`.
- `036-bugfix-ux-findings` — UX findings batch F001–F012: session-expiry redirect, checked-state controls, password policy surfacing, stale form state, strict-schema payload fixes, scope-validation detail, importer scope hints, credential rotate, component edit dialog.
- `037-schema-driven-importer-forms` — last ux-rewrite backend gap (G13):
  the importer create/edit form renders typed scope controls generated
  from each manifest's serialized `configSchema` — text/URL inputs,
  dropdowns, switches, list editors, required markers, materialized
  defaults, a per-field JSON fallback for complex fields, an
  "Unrecognized fields" block for stored keys outside the schema, and a
  lossless Edit-as-JSON mode. Frontend-only.

- `038-ux-11-conformance` — v1.1.0-vs-v0 conformance corrections: defect fixes (slug-keyed attention links, wired password-reset, `replaced` disconnect META, LOB delete guard, GONE/RETIRED opt-ins, breadcrumbs, ForbiddenState coverage, importer lastRun + convert-secrets, promote slug field error, feed sentences, ErrorState boundary), restorations (auth checklist/shell/footer, credentials alert, radius scale, command-menu adornments, org table columns, session device/location), product-map relations canvas ratified by ADR-118, and gap registry G21–G32 with flag gates — no dead controls or unbacked renders ship.

- `039-list-enrichment` — backend rollups behind the spec-038 flag gates: `worstStatus` + `lastSeenAt` on `GET /components`, `memberCount` + `componentCount` on `GET /teams`; `componentListHealth`, `componentListLastSeen`, `teamMemberCounts` flipped ON; G21 + G22 resolved.

- `040-dashboard-intelligence` — backend fields behind the spec-038 flag gates: `deltas` (trailing-7-day created counts) on `GET /dashboard/summary`, `AttentionItem.detail` + the `CREDENTIAL_EXPIRING` kind (30-day window, ranked above sunsets — ADR-116 Amendment 4), `createdBy` + `enrollmentExpiresAt` on the agent read; `statDeltas`, `attentionDetail`, `credentialExpiring`, `agentEnrolledBy` flipped ON; G23–G25 resolved.

- `041-display-prefs` — client-side only: `useUxPrefs` seam consumes `ux.prefs` app-wide — compact table density and reduce-motion via `data-*` root attributes + stylesheet rules, `RelativeTime` renders absolute when the pref is off; `displayPrefs` flag removed; G20 resolved.

- `042-catalog-authoring` — the three remaining ux-rewrite feature gaps: `POST /components` (`component:create` → EDITOR, ADR-054 Amendment 1) + "Add manually"/"New group" dialogs (G29); product-detail Relations card wiring `useAddEdge`/`useRemoveEdge` with kind-aware targets and surfaced `409 CYCLE` (G31); suggestions Pending/History tabs via a new `DECIDED` status filter spanning all terminal states (G32, ADR-113 amendment). `manualEntityCreate` + `suggestionsHistory` flags removed.

- `045-importer-source-migration` — Wave B of the Docker importer program:
  all 8 in-tree importers adopt `reportsSourceIdentity` with per-importer
  identity keys (ADR-120) — github `{canonicalBase}#org:{id}`/`#login:`
  fallback, alibaba-cloud STS accountId, azure subscriptionId, aws/k8s/mcp
  `sourceKey`-or-endpoint, api-url/web-url canonical URL. `{identity}::{id}`
  externalId qualification where IDs are source-local, adopt-on-report
  matching, `sourceDetails` → membership `details`, and migration 023 —
  derivable-only Source+membership backfill with `LEGACY_UNATTRIBUTED`
  preserved and no batch rekey.
- `044-importer-source-core` — the generic ImporterSource core (ADR-119):
  durable `importer_sources` with `ACTIVE`/`UNMONITORED`/`RETIRED`
  lifecycle and one-config binding, `reportSourceIdentity` +
  `resolveTarget` on the importer context, `targetRefKey` +
  `reportsSourceIdentity` manifest fields, durable Source→Component/
  Instance memberships, source-scoped reconciliation (legacy
  `sourceId NULL` path untouched), `import_runs.sourceId` durable with
  `configId` nullable `ON DELETE SET NULL`, Source list/detail/runs/
  retire/reactivate API, agent-local target registry with
  fail-before-network preflight + `source.identity` frame (protocol v3).
- `043-importer-source-adrs` — decision-record wave for the Docker
  importer program: ADR-119 (ImporterSource identity/lifecycle,
  source-scoped reconciliation, run-history retention, Agent target
  resolution) plus amendments to ADR-035/036/037/047/056/065/077/116;
  contract-first admission of `@componode/importer-docker` to the
  lockstep set. Docs-only — no runtime code.

- `046-docker-workload-inventory` — Wave C of the Docker importer
  program: `@componode/importer-docker` in lockstep (core/backend/agent);
  agent-only execution (`requiresAgent` manifest flag, ADR-121);
  `docker-targets.json` profiles — socket/npipe, verified mTLS TCP,
  pinned-host-key SSH, allowlisted named Context; `targetRefKey` +
  `resolveTarget` + credential-test preflight; `docker-engine:{/info.ID}`
  source identity; `CONTAINER` workload components + per-container
  instances; opt-in `PACKAGE_REGISTRY` image inventory; minimization
  allowlist (no env vars/raw paths/health output);
  `docs/importers/docker.md`.
- `047-docker-source-health` — Wave D of the Docker importer program:
  `rawConfig.dockerObservation` allowlisted snapshot (engine state +
  latest health facts, never health output/test commands/stats/events);
  health-aware `InstanceStatus` mapping (unhealthy/OOM → `ERROR`,
  rendered on instance detail; ADR-121 Amendment 1, ADR-112 rollup
  verified); generic ImporterSource UI at `/sources` +
  `/sources/:id` (identity, bound config, runs, memberships,
  ADMIN-gated retire/reactivate, rebind-on-report reattach); and
  user-confirmed `compose:`/`service:` tag suggestions in the
  component edit dialog.

- `048-docker-swarm-inventory` — Wave E of the Docker importer program:
  Swarm auto-discovery on manager endpoints (`ControlAvailable` gate on
  the already-fetched `/info`, zero extra calls otherwise; API v1.41
  floor for `ServiceStatus`), `CONTAINER_ORCHESTRATION` services with
  aggregate instances + replica-derived status (`swarmObservation`),
  `COMPUTE` nodes (`swarmNodeObservation`), metadata-only `SECRET`
  secrets + bounded secret/config references; ADR-121 Amendment 2.

- `049-docker-hub-execution` — Docker importer runs on the Hub or an
  Import Agent: database-backed `docker_targets` registry (immutable
  `targetId`, strict transport profiles, no secrets), ADMIN target
  CRUD/enable/disable/test APIs + management screens, Hub target picker
  in the importer form, `importer:target:*` permissions, `TARGET_*`
  errors, `cancelReason` on runs, `docker_target` audit events, and
  deployment docs for opt-in socket/context access — the default Compose
  stack still mounts no Docker socket; ADR-122.
- `050-bugfix-codeql-sanitize` — CodeQL `js/incomplete-sanitization`
  findings on the importer-docs generator: shared `mdCell()` escape
  (backslash-first ordering) plus a unit regression test.
- `051-url-check-monitoring` — unified HTTP(S) URL Check monitoring
  (ADR-123, ADR-124): per-ComponentInstance checks with independent probe
  history on a shared per-Component monitoring setup (default 5-minute
  cadence, Hub or Import Agent vantage — agent probes ride new
  `url_check.probe`/`url_check.probe.result` stream frames correlated by
  `probeId`, protocol v4), GET/HEAD with no redirects and no body
  retention, per-check success policy (2xx default) plus optional
  availability target, availability/error-rate/coverage-gap and
  p50·p95·p99 TTFB over rolling 24h/7d/30d with 30-day observation
  retention, `MISSED` rows for scheduled-but-unexecuted slots
  (conservative SLI, shown as a distinct coverage gap), API-category auth
  (Basic/Bearer/custom headers via reusable Credentials —
  `Authorization` reserved, agent vantage requires `AGENT_MANAGED`),
  `component_monitoring_setups`/`url_checks`/`url_check_observations`
  schema (migration 024), `urlCheck:*`/`monitoringSetup:update` EDITOR
  permissions, and monitoring state kept fully separate from
  importer-reported instance status and product health.
- `052-url-check-probe-bounds` — operational bounds for Agent-vantage
  URL Check probes (gap-analysis G1; ADR-124 Amendment 1, ADR-116
  Amendment 8): per-agent admission control on the hub
  (`URL_CHECK_AGENT_CONCURRENCY`/`_RATE_LIMIT`/`_QUEUE_MAX` — bounded
  deferral, overflow → `MISSED/SATURATED`), an agent-side in-flight cap
  (`URL_CHECK_MAX_PROBES`) with explicit `SATURATED` refusal, the
  `url_check.probe.cancel` frame (protocol v5) aborting in-flight
  fetches on dispatch deadline and session close, one-observation-per-
  slot integrity under timeout/disconnect/restart, and bounded-label
  telemetry on both ends.
- `053-component-check-summary` — at-a-glance monitoring summary on the
  Component checks table (gap-analysis G2; ADR-124 Amendment 2): each
  row carries a compact 24-hour availability figure and p95 latency
  labeled with window and "reachable from" vantage, coverage gaps stay
  distinguishable via the missed-slots annotation, no-observation checks
  show an explicit no-data state, and the whole table — summaries plus
  the recent-outcome strip — loads through a single bounded list request
  (`summary`/`recent` embedded in `GET
/components/:componentId/url-checks`; the per-row observations fan-out
  is gone).
- `054-url-check-onboarding` — onboarding completion (gap-analysis G3;
  ADR-125): composite new-Component creation accepts the regular URL
  Check editor's API-authentication and availability-target fields; a
  focused `POST /components/:id/instances` recovery path adds the first
  manual `ComponentInstance` to an ACTIVE zero-instance Component; and
  Credential/Import Agent selector boundaries are enforced server-side —
  ordinary checks and Hub setup remain EDITOR while `credential:read` and
  `agent:read` stay ADMIN.
- `055-playwright-workload` — Playwright workload suite hardening:
  test branches raise GitHub issues rather than patch app source,
  hub-probe re-arm ordering and product-detail navigation fixes.
- `056-url-check-failure-policy` — repeated-failure policy for URL
  checks (gap-analysis Phase 4; ADR-124 Amendment 3): a check probes at
  cadence with one observation per slot and **auto-disables** after a
  configurable consecutive non-success streak (`FAILURE` + `MISSED`
  count, `SUCCESS` resets) — global `URL_CHECK_AUTO_DISABLE_AFTER`
  default (12) with a per-check override and `0` = never. The disable is
  audited under the system actor, shows an Auto-disabled state distinct
  from manual disable, and resumes only via manual re-enable; alerting
  stays out of scope. Also normalizes every shipped spec's `Status` to
  `Shipped` and records the `Draft`→`Shipped` convention in AGENTS.md.
- `057-bugfix-alibaba-sdk-clients` — Alibaba Cloud importer SDK client
  fixes (GitHub issues #231/#232): SDK client constructors resolve
  through a `.default`-unwrapping interop fallback (CJS `__esModule` namespace
  binding broke `new Client()` under bundled runtimes); new `region`,
  `stsEndpoint`, `bssEndpoint` config fields pin/redirect all three
  clients — STS/BSS fall back to their documented global endpoints, and
  endpoint URLs normalize to host[:port] + protocol at the SDK boundary.
- `058-web-api-importer-journey` — Web/API importer collections and
  importer-managed URL Checks (ADR-126): one ImporterConfig declares
  named Component profiles with per-environment ComponentInstances and
  one managed check per instance; stable generated keys (`sourceKey`,
  `componentKey`, `instanceKey`, `checkKey`) drive identity, the Source
  identity is `collection:<sourceKey>` with reattachment of unmonitored
  Sources. Check definitions sync through `source_url_check_memberships`
  (shared `checkKey`s stay scheduled while an effective enabled owner
  remains; config disable/delete pauses, explicit re-enable resumes with
  a reset streak). Managed check outcomes now drive monitored instance
  status (`SUCCESS`→`RUNNING`, `FAILURE`→`ERROR`; `MISSED`/disabled/no-data
  preserve; `GONE` stays reconciliation-owned); direct check writes are
  deprecated (`410 URL_CHECK_WRITE_DEPRECATED`) and legacy manual checks
  are disabled and retained read-only.

- `059-product-map-topology` — Product Map topology moved into the
  Dependencies tab (ADR-127, amends ADR-118/ADR-103): the standalone Map
  tab is removed and `?tab=map` resolves to `dependencies`; all five
  relation families (composedBy, composes, consumesFrom, consumedBy,
  dependsOnGroups) render as directed read-only lanes with four-node caps
  and `+N` expansion, ComponentGroups as typed nodes. The detail read
  enriches related Products in one bounded batch (criticality, ADR-112
  health, component count) and degrades failed families into
  `unavailableRelationGroups`. Nodes are keyboard-operable with accessible
  direction labels, focus announcements, Escape clearing, and a read-only
  inspection panel; usable at 768px with no horizontal overflow and
  reduced-motion compliant.

- `060-component-relationships` — Component detail gains a read-only
  Relationships tab (ADR-128, amends ADR-103): one-hop typed lanes for
  `DEPENDS_ON`/`SOURCES_FROM`/`EXPOSES` in both directions, Product
  dependents with direct and `via [ComponentGroup]` provenance on a single
  node, and nested ComponentInstances (GONE excluded by default, explicit
  "Show gone" toggle). `GET /components/{id}/relationships` is a bounded,
  authenticated, side-effect-free read that degrades failed relation
  groups into `unavailableKinds`. Reuses the Product Map's keyboard,
  `+N`, inspection, and reduced-motion patterns; no edge authoring.

- `061-topology-component-deps` — Product topology gains a "Depends on
  components" lane (ADR-127 Amendment 2): direct `DEPENDS_ON` Component
  targets render as typed nodes with operational status (worst non-GONE
  instance status, no-data when absent), selection/inspection, `+N`
  expansion, and Open-component navigation. Group-mediated and
  `COMPOSES`-inherited components stay out of the lane — provenance remains
  attributed to the group node. The empty state only appears when a product
  has no relations of any kind, and card copy distinguishes composition,
  platform consumption, component, and group dependencies. No API change —
  frontend-only, reusing the existing detail read.
- `062-prototype-ux-parity` — Prototype visual identity is applied
  end-to-end: bundled Geist Sans/Mono, document-level `.ux-root` tokens and
  canvas (including portals and auth routes), a dedicated read-only Product
  Map tab, real Help/docs and Notifications destinations, and live
  pending-suggestion/attention-agent nav pills. No API change.
- `063-docker-importer-onboarding` — Guided Docker importer setup:
  a dedicated wizard (`/importers/new/docker`) walks Hub admins through
  transport → route → secrets → identity → probe → create, with inline
  masked secret capture under canonical credential keys, coverage-gated
  reuse of existing STORED credentials, and a stateless
  `POST /docker-targets/probe` endpoint that verifies a prospective
  route before anything persists. The generic importer form gains an
  Advanced disclosure for Docker's power-user scope keys, and
  `docs/importers/docker.md` opens with a five-minute quickstart.
  Agent-side setup simplification remains deferred.
- `064-docker-importer-enrichment` — Docker imports now keep bounded
  operational truth the Engine API already returns: container instances
  carry `imageId`, host-config limits/posture, and health-check timings;
  Swarm services carry published ports, network names, and job modes;
  every run emits one `docker-engine` component with version/platform/
  Swarm-manager facts; and opt-in image inventory merges allowlisted OCI
  provenance per unique image. Component detail renders all of it in
  named allowlist sections — env vars, host paths, health output, and
  unbounded engine fields remain excluded (ADR-121 Amendment 3).
- `065-docker-infra-inventory` — Docker imports now inventory
  infrastructure alongside workloads under the same bounded,
  fail-closed rules: every run emits one NETWORK Component per Docker
  network (driver, scope, posture flags, attachment names) and one
  STORAGE Component per volume (driver, scope, `df` usage facts), with
  scope/name-qualified identities, `instances: []`, and the standing
  exclusions — IPAM/addressing, options, mountpoints, status, and
  unbounded labels never leave the boundary (ADR-121 Amendment 4).
- `066-bugfix-component-group-detail` — Component group detail page
  fixes: members now render (the list filter contract is slug-based, not
  id), the Edit group Owning team dropdown lists teams, and owning
  team/description can be cleared via explicit nulls.
- `067-auto-component-groups` — Source-scoped auto ComponentGroups
  (ADR-129): a generic pass assigns each ImporterSource's
  sole-reported components to a system-provisioned ComponentGroup —
  Docker is the first strategy; membership is recomputed every run,
  lifecycle is derived, and human-managed groups are never touched.

## Next — post-v1.1

The Docker importer program's mapped waves (A–E) plus Hub execution
(049) are complete and the URL Check monitoring program — monitoring
(051), operational bounds (052), the Component-level summary (053),
onboarding completion (054), the repeated-failure auto-disable
policy (056), and importer-managed checks (058) — has shipped, as has the Product Map
topology (059), the Component Relationships view (060), component
dependencies in the Product topology (061), prototype UX parity (062),
guided Docker importer onboarding (063), Docker importer enrichment
(064), Docker infrastructure inventory (065), a component-group detail
bugfix (066), and source-scoped auto ComponentGroups (067).
See
`researches/` and the deferred queues below for the next initiative (for
example importer-source migrations, UX gap follow-through, or a new
importer wave).

See `.specify/memory/constitution.md` § v1.1 Roadmap for the authoritative
list — the Import Agents program (025–028), the UX baseline (029), and
the gap specs `030`–`034` + `037` (G14, G1, G2, G7/G8/G9/G11, G12, G13)
are shipped on `release/1.1.0`. The gap program's grouped backend specs
closed with `039`/`040`, and the three feature-spec gaps shipped as the
catalog-authoring spec (042) — what remains are the deferred entries (see
`researches/ux-rewrite-gaps.md` spec-queue block):

Deferred unscheduled — kept here as the standing reference so future
planning/discussion can surface them directly (full entries in
`researches/ux-rewrite-gaps.md`):

- **Security/auth batch** — G16 TOTP (settings/security toggle, no
  backend; needs ADR), G17 session-concurrency + IP-binding controls,
  G27 auth hardening (allowed email domains, password policy,
  register work-email), G30 "keep me signed in" per-session TTL on login
- **Org/settings batch** — G15 notification delivery + prefs matrix
  (needs SMTP + per-user prefs endpoint), G18 workspace profile fields
  (AppSettings lacks org-level config), G19 retention/export/destructive
  ops, G28 LOB owner field
- **Standalone** — G26 `includeGone` opt-in on component detail

Beyond the gap queue, the ratified importer-source program (ADR-119,
spec 043) is queued in staged waves per
`researches/docker-importer-implementation-tracking.md`: the generic
ImporterSource core, staged migration of existing importers, Docker
Engine workload inventory, Docker observations + Source UI, then Swarm
inventory. Alongside:

- Runtime-loaded importer plugins
- Invite-based registration
- E2E tests
- Per-environment blast-radius traversal
- Kubernetes/Helm packaging
- Remaining providers
- Range filters — the range-type subset; multi-value enum filters already
  shipped in spec 015

Deferred UI work includes interactive graph authoring (the read-only
canvas shipped in 038 under ADR-118) and custom importer-form widgets
(`docs/ux.md` §9).
