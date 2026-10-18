# Componode Roadmap

Development proceeds as sequential spec-kit features under `specs/`. This
file tracks shipped and upcoming work — update it when a spec completes.

## Shipped (v1.0.0, features 001–017)

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

## Next — v1.1

Immediately next: `020-platform-product-workflow` heads the queue.

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
