# Data Model: View Models & Mapping Rules

No DB schema changes. This feature adds **view-model** shapes (the
prototype's fixture types) produced by mappers from existing API types.
Source of truth for field-level diffs: `v0-componode-dpam/docs/ux-data-model.md`
(pinned `@9b040bc`); summary below.

## Universal mapping conventions

| Rule | Handling |
|---|---|
| `at`/`lastActiveAt` (UX) ↔ `createdAt`/`completedAt` (API) | Rename in mapper only |
| `xOwnerName` display + `xOwnerId` for forms | Mapper keeps both |
| `lifecycle`/`status`/`role` unions | Narrow in mapper; unknown → neutral badge, never throw |
| `slug` vs `id` route params | Prototype param kept; resolved in read hook/mapper inputs |
| `useState` copies of server data | Deleted; mutation hooks + invalidation |
| Nullable API fields (`displayName`, `email`, `startedAt`, `lastSeenAt`, `reportedStatus`) | Defined fallback per field |
| Internal fields (ids not shown, tokens, session internals) | Never reach the view model |

## Entity summary

- **Product**: core fields match; `completeness` facets derived (verify facet
  names vs core); `componentCount` = `counts.components` (detail only);
  `consumedByCount` PLATFORM-only; `createdAt`/graph relations are API-only
  (shown only where the detail page needs them).
- **Component**: fields match; `instances` detail-only
  (`ComponentWithInstances`); nullable `lastSeenAt` handled.
- **ComponentInstance**: match; nullable `lastSeenAt`; `componentId`,
  `slug`, `deployedAt` are API-only.
- **ImporterConfig**: `scheduleLabel` derived from cron; `credentialLabel`
  derived by joining `credentialIds` → credential labels; `lastRun` derived
  from latest `ImportRun`; `history` chart is a **gap** (needs per-day run
  aggregate); `scope` rendered from `ImporterManifest.configSchema`;
  `agentId`/`agentIncompatible` drive execution display.
- **ImportRun**: match + `INTERRUPTED` in `RunStatus` metadata;
  `triggeredBy`/`startedAt` nullable (PENDING); `durationSec` derived;
  `cancelRequestedAt` → "cancelling" state.
- **RunError**: `at` ← `createdAt`. **RunChange**: no API source — gap
  (confirm vs audit-derived).
- **User**: match; `displayName`/`email` nullable; `lastActiveAt` is a gap
  (derive from newest session `lastSeenAt` or flag).
- **Session**: ids/timestamps match; `username`/`displayName`, `device`,
  `location` are gaps; `current` derived vs caller's session id.
- **Credential**: verify vs `CredentialListItem`/`CredentialDetail` (ADR-117);
  `keyHints` masked only; `usedBy` ← `CredentialDependents`; "expired"
  derived from `expiresAt` (confirm rule).
- **ImportAgent/AgentSession**: per spec-028 (`reportedStatus`,
  `lastHeartbeatAt`, `lastDisconnectReason` null-first-class);
  `allowedImporters` empty = all; enrollment token shown once;
  `remoteAddress` ADMIN-only (verify).
- **AuditEvent**: closed unions fall back to generic row; prefer `entityId`
  links over names; `summary` source to verify.
- **Suggestion**: `EdgeSuggestion` kind/reason/status — verify status field;
  `from`/`to` resolved id → name.

## Gap registry (seed for `researches/ux-rewrite-gaps.md`)

1. Per-day run aggregates (importer history chart)
2. Session device/location + owning user on sessions list
3. Run change feed (or audit-derived confirmation)
4. `POST /users/:id/password-reset`
5. Expired-credential state rule
6. `credentialId` filter on `GET /importers`
7. `GET /teams/:id`, `PATCH/DELETE /teams/:id` (detail+edit+delete)
8. `GET /lobs/:id`, `PATCH/DELETE /lobs/:id` (detail+edit+delete)
9. Slug lookup for component groups (or resolve slug→id client-side)
10. Audit `actor` filter param name (confirm)
