# Componode Roadmap

Development proceeds as sequential spec-kit features under `specs/`. This
file tracks shipped and upcoming work — update it when a spec completes.

## Shipped (features 001–031)

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

## Next — v1.1

See `.specify/memory/constitution.md` § v1.1 Roadmap for the authoritative
list — the Import Agents program (025–028) and the UX baseline (029) are
shipped on `release/1.1.0`. First follow-on: the UX-rewrite backend gaps
in `researches/ux-rewrite-gaps.md`, resolved as their own specs on
`release/1.1.0` in queue order — `032` admin session visibility (G2),
`033` detail reads + feed names
(G7/G8/G9/G11), `034` team↔LOB (G12), `035` schema-driven importer forms
(G13). G20 resolves client-side without a spec; G15–G19 are deferred
unscheduled (see the registry's spec-queue block):

- Runtime-loaded importer plugins
- Invite-based registration
- E2E tests
- Per-environment blast-radius traversal
- Kubernetes/Helm packaging
- Remaining providers
- Range filters (multi-value enum filters shipped in 015)

Deferred UI work includes the product-graph canvas and custom importer-form
widgets (`docs/ux.md` §11).
