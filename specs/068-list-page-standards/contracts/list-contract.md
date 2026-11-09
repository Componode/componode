# Contract: Standardized list endpoints

**Feature**: `068-list-page-standards` | **Date**: 2026-11-09 | **ADR**: ADR-130 (amends ADR-080, ADR-081)

Authoritative per-endpoint contract for the unified list surface. Every
endpoint below returns `{data, pagination:{page,pageSize,total,pageCount,hasNext}}`
and accepts the shared params (`page`, `pageSize`, `sort`, `order`,
`search`) plus its listed filters. `pageSize` integer 1–100, default 25;
`page` integer ≥1, default 1; `order` `asc|desc`, default `asc`.
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
- **Sort keys**: `name`, `createdAt`; teams add `lob` (→ parent LOB name).
- **Derived counts (new fields)**: lobs → `teamCount`, `productCount`;
  teams → `memberCount`, `productCount`, `componentCount` — replaces the
  pages' fetch-all-products/components counting.

### `GET /api/v1/users` (ADMIN)

- **Filters (existing, now Zod-validated)**: `role`, `isActive`,
  `search`.
- **Sort keys**: `name` (display name/username), `role`, `isActive`,
  `lastActiveAt`/`createdAt` (whichever the row exposes).

### `GET /api/v1/sessions`

- **Filters**: `search` (device/user agent fragment) optional.
- **Sort keys**: `createdAt`, `lastSeenAt`, `expiresAt`.

## Operations

### `GET /api/v1/agents` (ADMIN)

- **Filters**: `status` (existing agent status values), `search`.
- **Sort keys**: `name`, `status`, `lastSeenAt`, `createdAt`.
- **Counts**: `boundConfigCount`/importer-version count if cheap subquery —
  else unsortable/unselectable (decide in tasks; display already derives).

### `GET /api/v1/credentials` (ADMIN)

- **Filters**: `status`, `search`.
- **Sort keys**: `name`, `status`, `expiresAt`, `lastUsedAt`, `createdAt`.

### `GET /api/v1/docker-targets` (ADMIN)

- **Filters**: `search`.
- **Sort keys**: `name`, `createdAt`.

### `GET /api/v1/importer-configs`

- **Filters**: `importerName`, `status` (if the config row exposes one),
  `search`.
- **Sort keys**: `name`, `importerName`, `status`, `createdAt`,
  `lastRunAt` (if exposed).

### `GET /api/v1/importer-configs/:id/runs`

- **Filters**: `status`.
- **Sort keys**: `startedAt`/`createdAt`, `status`, `finishedAt`.

### `GET /api/v1/importer-configs/:id/runs/:runId/errors`

- **Filters**: `code`/`severity` if columns exist, else `search`.
- **Sort keys**: `createdAt`/`id` order only (stable).

### `GET /api/v1/importer-configs/:id/runs/:runId/changes`

- **Filters**: `changeType`/`action` if columns exist.
- **Sort keys**: `createdAt`/`id` order only.

### `GET /api/v1/importer-sources`

- **Filters (existing)**: `status`, `importerName`; add `search`
  (identity/name fragment).
- **Sort keys**: `name`/identity, `importerName`, `status`,
  `lastCompleteRunAt` (if exposed), `createdAt`.

## Suggestions & audit (envelope migration)

### `GET /api/v1/suggestions`

- **Filters (existing)**: `status` (`PENDING|DISMISSED|DECIDED`).
- **Params**: `limit`/`offset` **replaced by `page`/`pageSize`**;
  `sort` → `createdAt`, `score` (if present); `order`.
- Response migrates `{items,total}` → `{data,pagination}`.

### `GET /api/v1/audit/activity` (ADMIN)

- **Filters (existing)**: `kind`, `entityType`, `action`, `actor`,
  `from`, `to`.
- **Params**: `limit`/`offset` → `page`/`pageSize`; add `sort`
  (`createdAt`, `action`, `actor`) + `order`; in-memory slice → SQL
  `LIMIT/OFFSET`.
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
