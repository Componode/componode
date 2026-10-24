# Research: Self-Service Profile Update

No NEEDS CLARIFICATION items remained after specify/clarify — the open
questions were resolved by reading the existing surfaces. Decisions and
their anchors:

## D1 — Route shape: `PATCH /users/me`

**Decision**: a new self-bound route `PATCH /users/me` registered with
`verifySession` only; the target identity is `req.user.id` — there is no
`:id` parameter, so no caller can address another record (FR-002
scenario 3 falls out structurally).

**Rationale**: `GET /users/me` already exists with exactly this posture
(authenticated, self-bound, no `x-permission` in `docs/openapi.yaml`).
Fastify routing resolves static `/users/me` ahead of the `/users/:id`
param route for the same method — proven precedent on GET.

**Alternatives considered**: (a) relax `PATCH /users/:id` to allow
`id === req.user.id` — rejected: the handler would still declare
`user:update`-shaped input (`role`, `isActive`, `teamId`) and need
per-field authorization inside one route; two schemas, two gates, one
route is strictly worse. (b) Widen `user:update` to cover self —
rejected at spec time: permissions are role-level and cannot express a
restricted field set.

Ratified in: ADR-070 (`/api/v1` prefix), ADR-097 (all non-public routes
authenticated), ADR-054 (session auth).

## D2 — Boundary schema: strict `updateSelfSchema` in core

**Decision**: `packages/core/src/schemas/user.ts` gains
`updateSelfSchema = z.object({ displayName: z.string().max(100).optional(),
email: z.string().email().optional() }).strict()` plus the
`UpdateSelfInput` type.

**Rationale**: `.strict()` rejects unknown keys with
`VALIDATION_FAILED` (400) — a stripped `role: "ADMIN"` would silently
no-op while the caller believes it applied; strict rejection is the
honest failure FR-002/SC-002 require. Field validation mirrors
`updateUserSchema` exactly (FR-003). Newer core schemas already use
`.strict()` (`credential.ts`, `bootstrap.ts`, `components.ts`) — this
follows the current convention rather than `updateUserSchema`'s older
non-strict shape.

**Alternatives considered**: reusing `updateUserSchema` + an allowlist
in the route — rejected: two sources of truth for the same restriction;
the schema *is* the boundary contract.

Ratified in: ADR-095 (Zod at the boundary, reject unknown fields).

## D3 — Service reuse: `updateUser`, unchanged

**Decision**: the route calls
`updateUser(req.user.id, parsed.data, toActor(req))`. `UpdateSelfInput`
is a structural subset of `UpdateUserInput` (both fields optional in
each), so no signature change is needed.

**Rationale**: `updateUser` already wraps the UPDATE and
`writeEntityChange` in one transaction and no-ops on empty input — the
audit attribution FR-004 requires is free. Duplicating it would fork
audit semantics between the admin and self paths.

Ratified in: spec FR-004; audit pipeline from spec 006.

## D4 — Frontend: new `useUpdateSelf` hook; profile page always uses it

**Decision**: `useUpdateSelf()` in `packages/frontend/src/api/hooks/users.ts`
POSTs `PATCH /users/me` with `{displayName?, email?}` and invalidates
`["auth", "session"]` (the session query feeding `useSession()`) plus
`["users"]` (admin list). The profile page swaps `useUpdateUser` →
`useUpdateSelf` and drops its admin special-casing — the self path works
for admins too, so every role uses one path on this page. `useUpdateUser`
stays for the admin user-management surfaces.

**Rationale**: one code path for self-edit regardless of role removes the
`user.role === "ADMIN"` fork and matches "there is no way to address
another record" at the client layer too.

## D5 — Flag: `profileSelfEdit` → `true`

**Decision**: flip the flag in `packages/frontend/src/ux/lib/flags.ts`
and simplify the page gate (`canEdit` becomes unconditional — every
authenticated user may edit their own profile; the fieldset/footerNote
fallback is removed).

**Rationale**: per `docs/ux.md` §7 the flag flips when the capability
lands; the read-only fallback exists only for the missing backend. The
flag constant stays (documenting the resolved gap, same as
`passwordReset`).

## D6 — OpenAPI + contract test

**Decision**: `docs/openapi.yaml` gains `patch` under `/users/me` — no
`x-permission` (authenticated-only, identical posture to `GET /users/me`),
`security` inherited, request `{displayName?, email?}`, responses
`200 {user}`, `400` VALIDATION_FAILED, `401`, `404`. `docs/api.md`
regenerates via `pnpm docs:api`.

**Rationale**: ADR-104 requires endpoint changes to update openapi.yaml
in the same change; the backend contract test enforces route↔spec
parity, `x-permission`↔`requireRole`, and `security: []`↔`verifySession`
— an unpermissioned authenticated route matches the GET `/users/me`
shape, which the test already accepts.

Ratified in: ADR-104, ADR-071 (`{code, message, details?}`).

## D7 — Registry bookkeeping in the same change

**Decision**: `researches/ux-rewrite-gaps.md` marks G14 **Resolved by
spec 030** (retaining the entry per convention) inside this feature's
diff.

**Rationale**: the registry rule — flag flips and gap entry resolves in
the change that lands the capability.

## ADR fidelity

No amendment needed. The change adds one endpoint inside ratified
surfaces: no new permission name (rbac map unchanged — self-scope is an
identity check, not a permission), no new error code, no new entity.
Had we introduced a `user:updateSelf` permission name instead, the
permission enumeration would have needed an ADR — D1/D2 avoid that by
construction.
