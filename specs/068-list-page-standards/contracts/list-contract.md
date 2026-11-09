# Contract: Standardized list endpoints

**Feature**: `068-list-page-standards` | **Date**: 2026-11-09 | **ADR**: ADR-130 (amends ADR-080, ADR-081)

Authoritative per-endpoint contract for the unified list surface. Every
endpoint below returns `{data, pagination:{page,pageSize,total,pageCount,hasNext}}`
and accepts the shared params (`page`, `pageSize`, `sort`, `order`,
`search`) plus its listed filters — `search` is omitted (rejected as an
unknown param) on the endpoints whose rows call it out. `pageSize`
integer 1–100, default 25; `page` integer ≥1, default 1; `order`
`asc|desc`, default `asc` unless a row notes `desc`.
Sort values are per-endpoint whitelists — anything else → `400`.

`docs/openapi.yaml` is the machine-checked contract (ADR-104); this file
is the design record.

---

## Catalog

### `GET /api/v1/components`

Already offset-paginated (spec 003). Changes: wider sort whitelist, wider
search, three bugfixes (research D12).

- **Filters (existing, unchanged)**: `category`, `provider`, `lifecycle`,
  `status` (CSV), `componentGroup`/`group` (slug, `none` sentinel),
  `wired` (`wired|unwired` CSV), `tag`, `includeRetired`, `includeGone`.
- **Sort keys** (displayed columns): `name`, `category`, `resourceType`,
  `owner` (→ `teams.name`), `health` (→ `worstStatus` CASE),
  `instances` (→ `instanceCount` subquery), `lastSeenAt`.
- **Search fields**: `name`, `slug`, `resourceType`, `externalId`,
  `tags` (unnest ILIKE). Replaces client substring + prefix-only API.
- **Bugfixes**: `worstStatus` omits GONE rung when `includeGone=false`;
  explicit `lifecycle` overrides default `!= RETIRED`.

### `GET /api/v1/products`

- **Filters (existing)**: `type`, `lifecycle`, `tag`, `criticality`,
  `missing` (CSV `owner|dependencies|description`), `includeRetired`;
  `q` **renamed to `search`**.
- **Sort keys**: `name`, `type`, `owner` (joined owner name),
  `criticality`, `updated` (→ `updatedAt`).
- **Unsortable (app-computed)**: `health`, `components` count,
  `completeness` — no affordance.
- **Extras**: `edges` top-level, scoped to page ids (unchanged shape).
- **Notes**: `missing=dependencies` via computed surfaces Set →
  `id IN/NOT IN`; enrichments computed for page ids only.

### `GET /api/v1/component-groups`

- **Filters**: `lifecycle`, `includeRetired` (route now `safeParse`s →
  `400` on bad input — bugfix).
- **Sort keys**: `name`, `lifecycle`, `createdAt`.
- **Counts**: add `memberCount` (components with `componentGroupId`) for
  the card grid.

## Organization

### `GET /api/v1/lobs` / `GET /api/v1/teams`

- **Filters**: `search` only (no lifecycle param today).
- **Sort keys**: lobs → `name`, `createdAt`, `teamCount`, `productCount`;
  teams → `name`, `createdAt`, `lob` (→ parent LOB name), `memberCount`,
  `productCount`, `componentCount` — the count keys order by the same
  per-row subqueries the columns display (FR-005).
- **Derived counts (new fields)**: lobs → `teamCount`, `productCount`;
  teams → `memberCount`, `productCount`, `componentCount` — replaces the
  pages' fetch-all-products/components counting.

### `GET /api/v1/users` (ADMIN)

- **Filters (existing, now Zod-validated)**: `role`, `isActive`,
  `search`.
- **Sort keys**: `name` (display name, username fallback), `role`,
  `isActive`, `lastActiveAt` (derived last-session timestamp), `createdAt`
  (`order` defaults `desc`).

### `GET /api/v1/sessions`

- **Filters**: `search` (device/user agent fragment) optional.
- **Sort keys**: `createdAt`, `lastSeenAt`, `expiresAt`, `location` (→
  stored `ip` column; the device label is app-computed — unsortable)
  (`order` defaults `desc`).

## Operations

### `GET /api/v1/agents` (ADMIN)

- **Filters**: `status` (existing agent status values), `search`.
- **Sort keys**: `name`, `status`, `agentVersion` (stored version column),
  `boundConfigCount` (bound-config count subquery), `lastSeenAt`,
  `createdAt`.
- **Counts**: `boundConfigCount` — orders by the same correlated count
  subquery the row exposes (FR-005).

### `GET /api/v1/credentials` (ADMIN)

- **Filters**: `status`, `search`.
- **Sort keys**: `name` (→ `label`), `status`, `expiresAt`, `lastUsedAt`,
  `usedByCount` (dependent-count expression), `createdAt` (`order`
  defaults `desc`).

### `GET /api/v1/docker-targets` (ADMIN)

- **Filters**: `search`.
- **Sort keys**: `name` (→ `label`), `targetId`, `enabled`, `createdAt`.

### `GET /api/v1/importer-configs`

- **Filters**: `importerName`, `enabled`, `search`.
- **Sort keys**: `name` (→ `label`), `importerName`, `enabled`,
  `createdAt`, `updatedAt` (`order` defaults `desc`) — no `status`/
  `lastRunAt` keys: the row exposes `enabled` (paused/running), not a
  status enum, and has no persisted last-run column.

### `GET /api/v1/importer-configs/:id/runs`

- **Filters**: `status`. No `search` param — the service applies none, so
  `search=` is rejected as unknown.
- **Sort keys**: `startedAt`, `createdAt`, `status`, `completedAt`,
  `assetsProcessed` (`order` defaults `desc`).

### `GET /api/v1/importer-configs/:id/runs/:runId/errors`

- **Filters**: `errorType` (the run-error code column). No `search` param.
- **Sort keys**: `createdAt`, `errorType`, `assetExternalId`,
  `errorMessage` (`order` defaults `desc`).

### `GET /api/v1/importer-configs/:id/runs/:runId/changes`

- **Filters**: `action` (the change-type column). No `search` param.
- **Sort keys**: `createdAt`, `action`, `entityType`, `actor` (→
  `createdByName`, coalescing the "importer" fallback the cell renders)
  (`order` defaults `desc`).

### `GET /api/v1/importer-sources`

- **Filters (existing)**: `status`, `importerName`; `search` matches the
  identity/name fragment.
- **Sort keys**: `name` (→ `externalIdentity` — the cell renders
  `label ?? externalIdentity`), `importerName`, `status`, `boundConfig`
  (→ joined config label), `components`, `instances` (active-membership
  count subqueries), `lastCompletedRunAt`, `createdAt` (`order` defaults
  `desc`).

## Suggestions & audit (envelope migration)

### `GET /api/v1/suggestions`

- **Filters (existing)**: `status` (`PENDING|DISMISSED|DECIDED`).
- **Params**: `limit`/`offset` **replaced by `page`/`pageSize`**; `search`
  **removed** — the queue has no server-side search, so `search=` is
  rejected as unknown. `order` defaults `desc`.
- **Sort keys**: `createdAt`, `score` (default), `decidedAt`, `status` —
  the service resolves the effective column per `status` view (decided
  rows carry no meaningful score; `decidedAt` maps to `createdAt` on the
  pending queue).
- Response migrates `{items,total}` → `{data,pagination}`.

### `GET /api/v1/audit/activity` (ADMIN)

- **Filters (existing)**: `kind`, `entityType`, `action`, `actor`,
  `from`, `to`. No `search` param — the feed has none, so `search=` is
  rejected as unknown.
- **Params**: `limit`/`offset` → `page`/`pageSize`; `sort`
  (`createdAt` default, `action`, `actor`, `kind`, `entityType`) +
  `order` (default `desc`); in-memory slice → SQL `LIMIT/OFFSET`.
- Response migrates `{items,total}` → `{data,pagination}`.

### `GET /api/v1/audit/entities/:entityType/:entityId` (ADMIN)

- Same migration as activity, scoped to one entity; entity-history UI
  adapts to the envelope (keeps current controls).

## Explicitly unchanged

- `GET /search`, `/dashboard/summary`, `/health`, `/metrics` — not lists.
- All detail GETs and detail sub-lists (members, agent sessions/configs/
  runs, source runs/memberships, component dependents/relationships/
  url-checks, platform-candidates, user sessions) — exempt per spec.
- `GET /url-checks/:id/observations` — cursor pagination stays.
