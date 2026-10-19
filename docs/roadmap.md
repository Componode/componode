# Componode Roadmap

Development proceeds as sequential spec-kit features under `specs/`. This
file tracks shipped and upcoming work — update it when a spec completes.

## Shipped (features 001–022)

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

## Next — v1.1

Immediately next: `023-coverage-and-hygiene` heads the queue.

See `.specify/memory/constitution.md` § v1.1 Roadmap for the authoritative
list:

- Runtime-loaded importer plugins
- Invite-based registration
- E2E tests
- Per-environment blast-radius traversal
- Kubernetes/Helm packaging
- Remaining providers
- Range filters (multi-value enum filters shipped in 015)

Deferred UI work includes the product-graph canvas and custom importer-form
widgets (`docs/ux.md` §11).
