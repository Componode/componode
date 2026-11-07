# Plan: Component group detail page defects (bugfix 066)

## Approach

Minimal fix at the seams where the contract drifted, plus regression coverage
at three levels (backend integration, frontend unit, Playwright journey).

## Changes

| File | Change |
|------|--------|
| `packages/frontend/src/ux/app/component-groups/$slug.tsx` | Members via `useAllComponents({ group: group?.slug, includeRetired: true }, !!group?.slug)` — slug is the list-filter contract; `useAllComponents` lifts the silent 100-row cap. Teams read `teams.data?.teams`. Edit dialog gains a `NO_TEAM` sentinel "Unassigned" option mapping to `teamOwnerId: null`; emptied description submits `null`. |
| `packages/frontend/src/api/hooks/component-groups.ts` | `UpdateComponentGroupInput.description`/`teamOwnerId` accept `string \| null`. |
| `packages/core/src/schemas/components.ts` | `updateComponentGroupSchema`: `description` + `teamOwnerId` become `.nullable().optional()` (service already persists `?? null`). |
| `docs/openapi.yaml` | PATCH `/component-groups/{id}` requestBody marks both fields `nullable: true`. |

## Test seams

- **Backend** (`component-groups.test.ts`): `PATCH` with explicit nulls →
  200 + cleared fields (was 400).
- **Frontend** (`component-group-detail.test.tsx`): hook-boundary mocks that
  emulate the API's slug-filter contract — members render only when the
  query passes the slug; dropdown lists `teams.data.teams`; submit maps
  "Unassigned" → `null` and emptied description → `null`.
- **Playwright** (`tests/journeys/component-groups.spec.ts`): API-seeded
  team/group/components → UI asserts members, assigns a team via the
  dropdown, verifies persistence via API, then clears via "Unassigned".

## Risks

- Contract change is additive (null was already accepted by the component
  assignment schema and anticipated by the service) — no migration, no
  breaking change for existing clients.
- `useAllComponents` pages through the list endpoint; groups with very large
  membership cost a few extra requests — bounded and only on this page.
