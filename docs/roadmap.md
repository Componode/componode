# Componode Roadmap

Development proceeds as sequential spec-kit features under `specs/`. This
file tracks shipped and upcoming work — update it when a spec completes.

## Shipped (features 001–043)

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
  `STORED` (ADR-117): `AGENT_MANAGED` rows hold only secret *references*
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

## Next — post-v1.1

**Docker importer program — Wave C**: `046` is expected to be
`docker-workload-inventory` (`@componode/importer-docker` — Docker Engine
workload inventory: socket/pipe, mTLS TCP, pinned-host-key SSH targets;
`CONTAINER` components + container instances; see
`researches/docker-importer-spec-waves.md` and
`researches/docker-importer-implementation-tracking.md` Phase 3).
Waves D (observations + Source UI) and E (Swarm) follow.

See `.specify/memory/constitution.md` § v1.1 Roadmap for the authoritative
list — the Import Agents program (025–028), the UX baseline (029), and
the gap specs `030`–`034` + `037` (G14, G1, G2, G7/G8/G9/G11, G12, G13)
are shipped on `release/1.1.0`. The gap program's grouped backend specs
closed with `039`/`040`, and the three feature-spec gaps shipped as
`042-catalog-authoring` — what remains are the deferred entries (see
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
- Range filters (multi-value enum filters shipped in 015)

Deferred UI work includes interactive graph authoring (the read-only
canvas shipped in 038 under ADR-118) and custom importer-form widgets
(`docs/ux.md` §9).
