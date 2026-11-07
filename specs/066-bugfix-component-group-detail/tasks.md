# Tasks: Component group detail page defects (bugfix 066)

## Phase 1 — Regression tests (red)

- [x] T001 Backend: extend `component-groups.test.ts` — PATCH
      `teamOwnerId: null` + `description: null` returns 200 and clears both
      fields (currently 400 VALIDATION_FAILED).
- [x] T002 Frontend unit: new `component-group-detail.test.tsx` — assert the
      members query filters by group **slug**, member rows render, the edit
      dialog lists teams from `teams.data.teams`, and submit sends
      `teamOwnerId: null` for "Unassigned" / the uuid for a picked team.
- [x] T003 Playwright: `tests/journeys/component-groups.spec.ts` — API-seed
      team + group + member components, assert members render on
      `/component-groups/<slug>`, open Edit group, pick a team, save,
      assert ownership persists; then clear via "Unassigned".

## Phase 2 — Fix

- [x] T004 `$slug.tsx`: members via `useAllComponents({ group: group?.slug,
      includeRetired: true }, !!group?.slug)`; render flat array (also lifts
      the silent 100-member cap).
- [x] T005 `$slug.tsx`: `teams.data?.items` → `teams.data?.teams`; add
      `NONE` "Unassigned" option and map it to `teamOwnerId: null`; send
      `description: null` when emptied.
- [x] T006 `component-groups.ts` hook types: `description`/`teamOwnerId`
      accept `string | null`.
- [x] T007 Core: `updateComponentGroupSchema` — `description` and
      `teamOwnerId` become `.nullable().optional()` (service already
      persists `?? null`).
- [x] T008 `docs/openapi.yaml`: PATCH `/component-groups/{id}` requestBody —
      mark `description` + `teamOwnerId` `nullable: true`.

## Phase 3 — Verify

- [x] T009 Backend integration test green; frontend unit green; lint +
      typecheck on core/backend/frontend.
- [x] T010 Focused Playwright run for the new spec; commit + push to
      `064-docker-importer-enrichment` (PR #246).
