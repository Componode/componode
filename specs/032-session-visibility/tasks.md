# Tasks: Admin Session Visibility

**Input**: `/specs/032-session-visibility/` (spec, plan)

## Phase 1: Backend

- [ ] T001 Failing integration tests in `packages/backend/test/integration/sessions-visibility.test.ts`: seed users + logins with distinct UA/IP → GET /sessions rows expose `device`, `ip`, exactly one `current:true`; admin GET /users/:id/sessions rows include `userId`, `device`, `ip`; non-admin 403; pre-existing null fields → device null, current false-safe
- [ ] T002 Migration `020_session_metadata.ts`: `sessions` + `userAgent text null`, `ip text null`; update `SessionRow` in `packages/backend/src/db/types.ts`
- [ ] T003 `createSession(userId, meta?)` stores UA/IP; thread `{userAgent: req.headers["user-agent"], ip: req.ip}` at the 3 call sites (routes/auth.ts, services/auth-service.ts, services/oidc-service.ts)
- [ ] T004 `listUserSessions` adds `userId`, `userAgent`, `ip`, internal `id` for current-compare → returns `{id, tokenLast4, createdAt, lastSeenAt, expiresAt, userId, device, ip, current}`; add `parseDevice(ua)`; accept `opts.currentSessionHash`; sessions.ts passes `req.sessionId`

## Phase 2: Frontend

- [ ] T005 Update Session view type + `mapSession` in `packages/frontend/src/api/mappers/operations.ts` for `device`, `ip`, `userId`, `current`
- [ ] T006 Failing component test `packages/frontend/src/test/unit/ux-sessions-table.test.tsx`: flagged columns render device/ip/owner/"This device" badge
- [ ] T007 Wire `sessions-table.tsx` flag branches to live fields; flip `sessionDevice`, `sessionLocation`, `sessionOwner`, `sessionCurrent` in `flags.ts`

## Phase 3: Docs + gate

- [ ] T008 openapi.yaml session row fields + `pnpm docs:api`; contract test green
- [ ] T009 `researches/ux-rewrite-gaps.md` G2 → Resolved by spec 032; `docs/roadmap.md` shipped + Next queue
- [ ] T010 `pnpm lint && pnpm typecheck` + targeted vitest + `pnpm build` green
