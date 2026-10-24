# Implementation Plan: Self-Service Profile Update

**Branch**: `030-self-service-profile` | **Date**: 2026-10-24 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/030-self-service-profile/spec.md`

## Summary

Resolve ux-rewrite gap G14: non-admin users cannot save their own profile
because `PATCH /users/:id` is gated on the admin-only `user:update`
permission. Add `PATCH /users/me` — a self-bound route (no id parameter,
identity comes from the session) validated by a strict
`updateSelfSchema` (`displayName` + `email` only) and routed through the
existing `updateUser` service so transaction and audit semantics match the
admin path exactly. The profile settings page swaps its mutation to the
new self path for all roles, `profileSelfEdit` flips on, and
`docs/openapi.yaml` + the gap registry update in the same change
(ADR-104; registry convention). No migration, no new permission, no ADR
amendment — the change sits inside ratified surfaces.

## Technical Context

**Language/Version**: TypeScript 6, Node 24 (per repo stack)

**Primary Dependencies**: existing — Fastify, Kysely, Zod, TanStack Query.
**New**: none.

**Storage**: PostgreSQL — no migration; `persons.displayName` and
`persons.email` already exist with no uniqueness constraint (matches
admin-update semantics).

**Testing**: vitest unit/route tests (backend, frontend) — existing
harnesses.

**Target Platform**: Docker Compose deploy; Linux/Windows dev.

**Project Type**: pnpm monorepo feature across `packages/core`,
`packages/backend`, `packages/frontend`, `docs/`, `researches/`.

**Performance Goals**: single-row UPDATE per call — negligible; no new
read amplification.

**Constraints**: no `sql.raw` (ADR-084); Zod strict at the route boundary,
reject unknown fields (ADR-095); error responses `{code, message,
details?}` with controlled codes (ADR-071); authenticated, side-effectful
route — `verifySession` required, GET/HEAD rules N/A (ADR-094, ADR-097);
openapi.yaml updated in the same change (ADR-104).

**Scale/Scope**: one new route, one new core schema, one new frontend
hook, one flag flip — the smallest spec in the gap queue.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Single-org** — PASS: no tenancy; self-scope is identity, not
  tenant.
- **II. Importer-first** — N/A: no importer surface.
- **III. Two-level taxonomy** — N/A.
- **IV. Environment-as-instance** — N/A.
- **V. Factual vs meaning** — PASS: profile attributes are user-curated
  meaning-layer data on an existing entity.
- **VI. Test-first** — PASS: tasks order failing route/hook tests before
  implementation per package.
- **VII. Observability** — PASS: audit write reuses `writeEntityChange`
  via the existing service; request logging is middleware-wide.

No violations → no Complexity Tracking entries.

## Project Structure

### Documentation (this feature)

```text
specs/030-self-service-profile/
├── plan.md              # This file
├── research.md          # Phase 0 decisions D1–D7
├── data-model.md        # Phase 1: field sets + schema contract
├── contracts/
│   └── users-me.md      # Phase 1: PATCH /users/me contract
├── quickstart.md        # Phase 1: validation guide
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT this command)
```

### Source Code (repository root)

```text
packages/core/src/schemas/user.ts        # + updateSelfSchema, UpdateSelfInput
packages/backend/src/routes/users.ts     # + PATCH /users/me (verifySession)
packages/backend/src/services/user-service.ts  # reused unchanged
packages/backend/src/test/               # route tests (existing harness)
packages/frontend/src/api/hooks/users.ts # + useUpdateSelf
packages/frontend/src/ux/app/settings/profile.tsx  # swap to self path
packages/frontend/src/ux/lib/flags.ts    # profileSelfEdit → true
docs/openapi.yaml                        # + patch under /users/me
docs/api.md                              # regenerated via pnpm docs:api
researches/ux-rewrite-gaps.md            # G14 → Resolved by spec 030
```

**Structure Decision**: the change threads the existing verticals — core
contracts → backend route/service → frontend hook/page → docs. The only
new symbols are `updateSelfSchema`, the `PATCH /users/me` handler, and
`useUpdateSelf`; everything else is reuse (`updateUser`, `toActor`,
`writeEntityChange`, `SettingsSection`).

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

None — all gates pass.
