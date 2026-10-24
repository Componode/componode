# Data Model: Self-Service Profile Update

**No schema changes.** `persons.displayName` and `persons.email` already
exist; no migration, no new entity, no uniqueness constraint (matching
admin-update semantics — usernames, not emails, are unique identifiers).

## Entity: `persons` (User)

| Field | Self-editable | Admin-editable | Notes |
|---|---|---|---|
| `displayName` | yes | yes | ≤100 chars; nullable |
| `email` | yes | yes | email format; nullable |
| `username` | no | no | immutable identifier |
| `role` | **no** | yes | privileged — strict schema rejects |
| `isActive` | **no** | yes | privileged — strict schema rejects |
| `teamId` | **no** | yes | privileged — strict schema rejects |
| `passwordHash` | no | no | change-password flow only |

## Contracts (core)

```ts
// packages/core/src/schemas/user.ts — NEW, alongside updateUserSchema
export const updateSelfSchema = z.object({
  displayName: z.string().max(100).optional(),
  email: z.string().email().optional(),
}).strict();
export type UpdateSelfInput = z.infer<typeof updateSelfSchema>;
```

`UpdateSelfInput` is a structural subset of `UpdateUserInput` — assignable
to `updateUser(id, input, actor)` with no signature change.

## Validation rules

- Same as the admin update path: email format, `displayName` ≤ 100 chars
  (FR-003).
- `.strict()` → any additional key (`role`, `isActive`, `teamId`,
  `username`, `password`, `id`, …) fails with `VALIDATION_FAILED` (400) —
  nothing partially applies (FR-002, SC-002).
- Empty body `{}` is valid input → service no-ops, returns the current
  record (existing `updateUser` behavior; not an error).
- Clearing a field to `null` is not expressible (fields are
  `optional()`, not `nullable()`) — identical to the admin path today.
