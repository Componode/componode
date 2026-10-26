# Implementation Plan: Detail Reads + Feed Names

**Branch**: `033-detail-reads-feed-names` | **Date**: 2026-10-26 | **Spec**: [spec.md](spec.md)

## Summary

Resolve ux-rewrite gaps G7/G8/G9/G11. Team and LOB detail endpoints ship
(`GET /teams/:id`, `GET /lobs/:id`) inside the existing `org.ts` generic
register, and every org/group detail `:id` param resolves **id-or-slug** —
the identifier the UX routes carry — so `/ux/teams/:slug`,
`/ux/lobs/:slug`, and `/ux/component-groups/:slug` stop resolving via
list-and-match. Audit feed items gain server-resolved display names
(`entityName` on entity changes, `fromEntityName`/`toEntityName` on edge
changes) via read-time batch lookup in `audit-query-service` — one
touchpoint covering activity feed, entity history, and run changes,
including all historical rows. No migration, no flags.

## Technical Context

**Language/Version**: TypeScript 6, Node 24. **Dependencies**: existing —
Fastify, Kysely, TanStack Query. **Storage**: PostgreSQL — no migration
(names resolved at read time; nothing persisted). **Testing**: vitest
(testcontainers backend integration, component/mapper unit).
**Constraints**: parameterized Kysely only (ADR-084); `verifySession`
reads, no new permission (ADR-097); GET side-effect-free (ADR-094); Zod
at the boundary (ADR-095); openapi.yaml + api.md same change (ADR-104).

## Decisions (research)

- **D1 Detail routes**: `GET /teams/:id` and `GET /lobs/:id` added inside
  `register()` in `routes/org.ts` — same shape as list/mutations,
  `verifySession` only (matches `GET /teams/:id/members` posture).
- **D2 id-or-slug resolution**: detail `:id` params resolve UUID-shaped
  values by `id` first, falling back to `slug` on miss; non-UUID values
  go straight to `slug`. A name like `12345678-…-…-…-abc` can mint a
  UUID-shaped slug, so the fallback ordering keeps pathological slugs
  reachable. Shared `isUuid` check mirrors the existing `actor`-filter
  regex in `audit-query-service.ts`. Mutations (`PATCH`/`DELETE`) stay
  id-only — unchanged surface.
  *Ratified in:* spec Assumptions (mechanism plan-level); consistent with
  `GET /products/:slug` / `GET /components/:slug` slug resolution.
- **D3 Group lookup (G9)**: zero new routes — `getComponentGroup` gains
  the same id-or-slug resolution, so `GET /component-groups/:id` answers
  slug queries. Satisfies the gap's "addressed by slug" option.
- **D4 Feed names — read-time batch resolution**: after pagination,
  `audit-query-service` collects `(entityType → Set(id))` from entity
  rows plus edge `from`/`to` endpoints, runs one `where id in (…)` per
  touched table, and attaches names. Chosen over write-time snapshot:
  covers all existing audit history and survives renames (spec SC-002
  demands names on current entities, which a snapshot can't backfill).
  Bounded — feed pages cap at `limit ≤ 200`, run changes by run size.
- **D5 Name source map**: `digital_product`→`digital_products.name`,
  `component`→`components.name`, `component_instance`→`components.name
  via componentId` + `environment` qualifier (`"name · env"`),
  `component_group`→`component_groups.name`,
  `importer_config`→`importer_configs.label`,
  `credential`→`credentials.label`, `user`→`persons.displayName ??
  username` (COALESCE), `team`→`teams.name`,
  `line_of_business`→`line_of_businesses.name`,
  `import_agent`→`import_agents.name`. `session`/`settings`/`auth`/
  `correction` and unknown types → `null` (client fallback).
- **D6 Contract delta**: `EntityChange += entityName?: string | null`;
  `EdgeChange += fromEntityName?, toEntityName?: string | null` in
  `packages/core/src/contracts/audit.ts`. Optional+nullable — additive,
  no caller breakage; absent name = `null`, never a synthesized id.
- **D7 Frontend**: `orgHooks` factory gains `detail` → `useTeam` /
  `useLob`; `useComponentGroup(idOrSlug)` added. Detail pages
  (`teams/$slug`, `lobs/$slug`, `component-groups/$slug`) drop
  list-and-match. `mapActivityItem` uses `entityName` /
  `fromEntityName`/`toEntityName` with the entity-kind label as fallback
  only when null (never a raw identifier pair); `mapRunChange` same for
  `entityName`.
- **ADR fidelity**: no amendment — additive read endpoints and additive
  nullable response fields inside ratified surfaces (ADR-070 pathing,
  ADR-097 auth, ADR-071 codes: `NOT_FOUND` reused, no new enum).

## Constitution Check

I single-org ✓ · II importer-first ✓ (reads only) · III taxonomy ✓
(canonical entity names) · IV env-as-instance ✓ (instance names carry
environment) · V factual layer ✓ · VI test-first ✓ (failing integration +
mapper tests before impl) · VII observability ✓ (request logging only).
No violations — re-checked post-design, unchanged.

## Source touch-points

```text
packages/core/src/contracts/audit.ts                    # + entityName / from,toEntityName
packages/backend/src/services/org-service.ts            # getOrgEntity → id-or-slug
packages/backend/src/services/component-group-service.ts# getComponentGroup → id-or-slug
packages/backend/src/services/audit-query-service.ts    # + name resolution attach
packages/backend/src/routes/org.ts                      # + GET /teams/:id, /lobs/:id
packages/backend/test/integration/                      # detail reads + feed names
packages/frontend/src/api/hooks/org.ts                  # + useTeam / useLob (detail)
packages/frontend/src/api/hooks/component-groups.ts     # + useComponentGroup
packages/frontend/src/ux/app/{teams,lobs,component-groups}/$slug.tsx  # direct read
packages/frontend/src/api/mappers/dashboard.ts          # entityName usage + fallback
packages/frontend/src/api/mappers/operations.ts         # mapRunChange entityName
packages/frontend/src/test/unit/                        # mapper tests
docs/openapi.yaml · docs/api.md · researches/ux-rewrite-gaps.md · docs/roadmap.md
```
