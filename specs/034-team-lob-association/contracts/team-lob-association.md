# Contract: team ↔ LOB association — `/api/v1/teams`, `/api/v1/lobs`

Delta on the existing org endpoints. No new routes; team payloads gain an
optional LOB association, and team writes accept it.

**Auth**: unchanged — reads `verifySession`; writes keep
`team:create`/`team:update` and `lob:create`/`lob:update`. No new
permission.

## Write delta — `POST /teams`, `PATCH /teams/:id`

```jsonc
// request body (in addition to name / slug / description)
{ "lobId": "0194…" }   // uuid — assign or change
{ "lobId": null }      // clear the association
```

- `lobId` absent on `PATCH` → field unchanged (normal partial-update
  semantics). `null` is meaningful: it clears.
- `lobId` must reference an existing Line of Business → otherwise
  `400 { "code": "VALIDATION_FAILED" }`. Rejected, never stored.
- `lobId` on `POST /lobs` / `PATCH /lobs/:id` → `400 VALIDATION_FAILED`
  (strict schema: unknown field) — LOBs do not carry the link.
- Changes land in `entity_changes` like any other team field.

## Read delta — team payloads

`GET /teams`, `GET /teams/:id`, and both write responses return:

```jsonc
{ "team": {
    "id": "…", "name": "Platform Eng", "slug": "platform-eng",
    "description": null,
    "lobId": "0194…",                                  // NEW: string | null
    "lob": { "id": "0194…", "name": "Platform",        // NEW: object | null
             "slug": "platform" },
    "createdAt": "…", "updatedAt": "…" } }
```

`lob` is the resolved summary (server-side join) — `null` when the team
is unassociated. LOB payloads are unchanged.

## Delete semantics

`DELETE /lobs/:id` is **not** blocked by associated teams — the
`teams.lobId` FK is `ON DELETE SET NULL`, so teams survive with the
association cleared. Products owning the LOB (`lobOwnerId`) still block
deletion per the existing `REFERENCED` guard.

## Derived surfaces (no new endpoints)

- Product form team picker: groups by selected LOB — that LOB's teams
  first, then all remaining teams in a separated group; `Unassigned`
  always offered; nothing hidden.
- Team detail: renders `lob.name` (linked to `/lobs/:slug`).
- LOB detail: lists teams filtered client-side by `lobId` (org lists are
  full reads — no `/lobs/:id/teams` endpoint).

## Errors

- `400 VALIDATION_FAILED` — malformed `lobId`, nonexistent LOB, or
  `lobId` sent to a LOB route.
- `401 AUTH_NO_SESSION` — unauthenticated.
- `403` — role without `team:create`/`team:update` (unchanged).
