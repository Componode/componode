# Quickstart: validating app-level auto groups + multi-membership

Prereq: `pnpm dev` stack running (backend + frontend + postgres), Docker
Desktop engine reachable, an authenticated session.

## Scenario 1 — Compose project groups appear

1. Import the Docker engine (or trigger a re-import of the existing config).
2. `GET /api/v1/component-groups` → expect, alongside `docker-desktop`
   (source group) and any human groups, one group per compose project:
   `name = "componode"`, `autoGroupKey = "compose:componode"`,
   `autoSourceId` = the docker source id. Slug matches
   `docker-app-componode-*`.
3. `GET /api/v1/components?group=<app-group-slug>` → `componode/app`,
   `componode/caddy`, `componode/postgres`, `componode_default` network,
   `componode_postgres_data`/`caddy_data` volumes — and NOT the engine,
   images, or `bridge`/`host`/`none` networks.
4. **Multi-membership check**: `GET /api/v1/components/{app-id}` →
   `componentGroups` contains `Componode Dockers` (human) AND
   `docker-desktop` (source auto) AND `componode` (app auto) simultaneously.
5. `docker-tls-proxy/proxy` → in `docker-tls-proxy` app group +
   `docker-desktop`; NOT in `componode`.

## Scenario 2 — Swarm stack groups

With a swarm stack deployed (`docker stack deploy payments …`):
`GET /component-groups` → `name = "payments"`,
`autoGroupKey = "stack:payments"`; members = stack services only.

## Scenario 3 — Human multi-assign via UI

1. Component detail → edit → Groups multi-select → pick two human groups →
   save.
2. `GET /components/{id}` → `componentGroups` lists both **plus** any auto
   memberships (untouched).
3. Try assigning an auto-managed group (`docker-desktop`) via the API →
   `409 GROUP_AUTO_MANAGED`.

## Scenario 4 — Guards & lifecycle

- `PATCH /component-groups/{app-group-id}` `{lifecycle:"RETIRED"}` → 409.
- `DELETE /component-groups/{app-group-id}` → 409.
- `PATCH` name/description/teamOwnerId on an app group → 200 (human fields
  stay editable).
- App group `lifecycle` → `RETIRED` only when all members retire.

## Scenario 5 — Eviction & opt-out

- `docker compose down` the project (or stop a service) → next import →
  that component leaves the app group; group shrinks; if emptied of ACTIVE
  members → `RETIRED`.
- Set `"autoGroup": false` in the docker config scope → re-import → **both**
  `docker-desktop` and all `docker-app-*` groups frozen as-is.

## Scenario 6 — Coverage/edges (regression)

- Product `DEPENDS_ON` the `componode` app group → product detail lists
  every member; a product depending on `docker-desktop` covers members of
  BOTH groups (multi-membership widens coverage correctly).
- Suggestions queue: components covered by any depended-on group stay
  suppressed.

## Automated equivalents

- Backend: `packages/backend/test/integration/auto-component-groups.test.ts`
  (extended) + new `component-group-membership.test.ts`.
- Playwright: `playwright/tests/` — multi-assign dialog, group filter,
  app-group listing (mock docker engine fixtures per `docker-infra.spec.ts`).
