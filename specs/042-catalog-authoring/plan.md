# Implementation Plan: Catalog Authoring

**Branch**: `042-catalog-authoring` | **Date**: 2026-10-31 | **Spec**: [spec.md](./spec.md)

## Summary

G29/G31/G32 — three authoring surfaces. **G29**: new `POST /components`
(Zod schema, `component:create` permission — new PERMISSIONS entry → ADR-054
Amendment, uuid v7, slug-unique controlled error, audit event) + create
dialogs on `/ux/components` and `/ux/component-groups` (the latter uses the
existing endpoint). **G31**: edge add/remove UI on product detail relations
using the existing `useAddEdge`/`useRemoveEdge` hooks and `product:edge:*`
endpoints, with `409 CYCLE` surfaced. **G32**: decided-history tab on
`/ux/suggestions` via the existing `useSuggestions(status)` param. Both flags
deleted.

## Technical Context

Fastify + Kysely backend; React frontend (TanStack Query, shadcn/ui,
TanStack Router `$slug` routes). RBAC: `PERMISSIONS` map in
`backend/src/plugins/rbac.ts` (ADR-054). Tests: backend integration
(testcontainers) + frontend unit (vitest/jsdom).

## Constitution Check

| Principle | Verdict |
|---|---|
| VI Test-first | Pass — integration test for POST /components; unit tests for new UI logic. |
| ADR-054 permission matrix | Pass w/ amendment — `component:create: EDITOR` extends the enumerated set. |
| ADR-049/109/110 edge rules | Pass — authoring uses existing endpoints; DAG/platform rules enforced server-side. |
| ADR-104 openapi sync | Pass — POST /components added to docs/openapi.yaml + api.md regen. |
| Gap governance | Pass — flags removed only when surfaces work. |

## Design (research.md)

1. **POST /components**: mirror `POST /component-groups` — `createComponentSchema`
   (name required; optional slug/type/lifecycle?/description/teamOwnerId —
   scope to the contract's writable fields), service validates slug
   uniqueness (`409 SLUG_CONFLICT`-style controlled code per precedent),
   audit `component.create`, permission `component:create: EDITOR`.
2. **Create dialogs**: reuse the `Dialog` pattern from teams/lobs pages;
   slug auto-derived from name (existing slug util), editable.
3. **Edge authoring**: product detail relations area gets an "Add relation"
   control — kind select → target search (products for composes/consumes-from
   with PLATFORM-only filter for consumes-from; components/groups for
   depends-on) → `useAddEdge`; existing edges get remove affordances via
   `useRemoveEdge`; `onError` surfaces server message (409 CYCLE).
4. **History tab**: tabs on `/ux/suggestions` — Pending (current) / History
   (`useSuggestions("DECIDED")` or explicit statuses per the hook's contract).

## Project Structure

```text
packages/backend/src/routes/components.ts            # + POST /components
packages/backend/src/services/component-*-service.ts # + createComponent
packages/core/src/contracts/                         # + createComponentSchema (or route-local per precedent)
packages/backend/src/plugins/rbac.ts                 # + component:create
packages/backend/test/integration/                   # + create-component tests
packages/frontend/src/ux/app/components/index.tsx    # Add-manually dialog
packages/frontend/src/ux/app/component-groups/index.tsx # New-group dialog
packages/frontend/src/ux/app/products/$slug.tsx       # relations authoring
packages/frontend/src/ux/app/suggestions.tsx          # history tab
packages/frontend/src/api/hooks/                     # component/group create mutations if absent
docs/openapi.yaml, researches/adrs/ADR-054-*.md, docs/ux.md
```
