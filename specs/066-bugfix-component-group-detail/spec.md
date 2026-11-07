# Feature Specification: Component group detail page defects

**Feature Branch**: `064-docker-importer-enrichment` (fix rides PR #246 per user direction)

**Created**: 2026-02-14

**Status**: Shipped

**Input**: User report — on `/component-groups/componode-dockers` the Members
table never shows components, and the Edit group dialog's "Owning team"
select renders with no options. Request: sweep the page and the edit-group
flow for related inconsistencies; keep the fixes in PR #246.

## Problem

Two user-visible defects on the component-group detail page
(`packages/frontend/src/ux/app/component-groups/$slug.tsx`), plus related
inconsistencies found while sweeping the same surface:

1. **Members never render.** The page queries
   `GET /components?group=<value>` with `group?.id` (the group UUID), but the
   backend `group`/`componentGroup` list filter matches
   `component_groups.slug` (`component-catalog-service.ts`). A UUID never
   equals a slug, so the members table is permanently empty. The same query
   also caps at `pageSize: 100`, silently truncating groups with more
   members.
2. **Owning team dropdown is empty.** The edit dialog reads
   `teams.data?.items`, but `GET /teams` returns `{ teams: [...] }` —
   `items` is always `undefined`, so `SelectContent` renders no options.
3. **Owning team cannot be cleared.** The dialog offers no "Unassigned"
   option, and `updateComponentGroupSchema.teamOwnerId` rejects `null`
   even though `updateComponentGroup` already persists `?? null`. Component
   edit (`component-edit-dialog.tsx`) supports clearing via a `NONE`
   sentinel; group edit does not.
4. **Description cannot be cleared.** Same pattern: the service writes
   `parsed.description ?? null`, but the update schema rejects `null` and
   the form sends `|| undefined`, so emptying the field is a silent no-op.

## Root Cause

Frontend/backend contract drift on one page: the members query passes the
wrong identifier kind (id where the API contract is slug), the teams query
reads the wrong response envelope key, and the update schema never gained
the nullable fields the service layer was already written to persist.

## Impacted User Scenarios

- Editor/admin opens a component group detail page expecting its member
  components — sees "No components to show" regardless of actual membership.
- Editor opens Edit group to reassign ownership — the Owning team dropdown
  is empty; ownership can be changed only via direct API calls, and never
  cleared at all.

## Acceptance Criteria

1. `GET /component-groups/:slug` detail page lists every component whose
   `componentGroupId` matches the group, including beyond the first 100.
2. The members query filters by group **slug** (the documented
   `componentGroup`/`group` list-filter contract), not id.
3. Edit group → Owning team lists all teams from `GET /teams`; selecting a
   team persists `teamOwnerId`; selecting "Unassigned" clears it (`null`).
4. Emptying the description field persists `description: null`.
5. `PATCH /component-groups/:id` accepts `teamOwnerId: null` and
   `description: null`; `docs/openapi.yaml` reflects the nullable fields.
6. Regression coverage: backend integration test for null-clearing, a
   frontend unit test asserting the slug filter + populated dropdown +
   null submission, and a Playwright journey covering members render and
   the edit-group team flow end to end.

## Out of Scope

- Role-gating the Edit/Delete affordances (app-wide convention: detail
  pages do not hide write actions; backend enforces `componentGroup:*`
  roles — unchanged).
- Changing the `group`/`componentGroup` list-filter contract itself
  (slug-based filtering is pinned by `quickstart.test.ts`).
