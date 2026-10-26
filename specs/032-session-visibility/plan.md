# Implementation Plan: Admin Session Visibility

**Branch**: `032-session-visibility` | **Date**: 2026-10-24 | **Spec**: [spec.md](spec.md)

## Summary

Resolve gap G2: persist `userAgent` + `ip` on sessions at creation
(migration 020), expose `device` (coarse parsed label), `ip`, and a
caller-relative `current` marker on session list rows; include `userId`
on the admin sessions endpoint. Wire the four flag-gated columns and
flip sessionDevice/sessionLocation/sessionOwner/sessionCurrent.

## Decisions (research)

- **D1 Schema**: migration `020_session_metadata.ts` —
  `sessions.userAgent text null`, `sessions.ip text null`. Existing rows
  stay null (documented empty state).
- **D2 Capture**: `createSession(userId, meta?: {userAgent?, ip?})` —
  three call sites pass `req.headers["user-agent"]` + `req.ip`:
  `routes/auth.ts:179` (login), `services/auth-service.ts:48`,
  `services/oidc-service.ts:217` (req threaded via handler).
- **D3 Device label**: `parseDevice(ua)` — a ~30-line mapper in
  `session-service.ts` (browser + OS keywords → "Chrome · Windows" /
  "Unknown device"). No new dependency.
- **D4 current**: `listUserSessions` gains `currentSessionHash?: string`;
  selects `sessions.id` internally (never serialized) and sets
  `current = row.id === hash`. Route passes `req.sessionId`.
- **D5 Admin owner**: the select already joins nothing for userId —
  `sessions.userId` added to both lists (self list benefits too: the
  admin tab and self view share the serializer).
- **ADR fidelity**: no amendment — no new endpoint (two existing lists
  grow fields), no new permission/error/entity; session hash stays
  secret (ADR-099).

## Constitution Check

All seven pass; VI test-first observed (integration tests red before
service/route changes).

## Source touch-points

```text
packages/backend/src/db/migrations/020_session_metadata.ts   # NEW
packages/backend/src/db/types.ts                             # SessionRow + userAgent, ip
packages/backend/src/services/session-service.ts             # createSession meta, listUserSessions fields + parseDevice
packages/backend/src/routes/auth.ts · services/auth-service.ts · services/oidc-service.ts  # meta call sites
packages/backend/src/routes/sessions.ts                      # current hash pass-through
packages/backend/test/integration/sessions-visibility.test.ts # NEW
packages/core/src/schemas/session.ts (or types)              # Session view type + device/ip/userId/current
packages/frontend/src/api/mappers/operations.ts              # mapSession
packages/frontend/src/ux/components/admin/sessions-table.tsx # flagged columns live
packages/frontend/src/ux/lib/flags.ts                        # 4 flips
docs/openapi.yaml · docs/api.md · researches/ux-rewrite-gaps.md · docs/roadmap.md
```
