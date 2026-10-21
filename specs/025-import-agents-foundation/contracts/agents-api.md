# Contract — Agent Management & Enrollment API

All routes under `/api/v1`. Management routes use session auth +
`agent:*` permissions (admin default, ADR-054 amendment). The two
`agent/*` channel routes are public-in-OpenAPI (`security: []`) and
authenticate by token material, not session (research R9). Both are
registered in `docs/openapi.yaml` per ADR-104.

## Admin management routes (`routes/agents.ts`)

| Method   | Path                    | Permission     | Body / Params                  | Response                                                                                                           |
| -------- | ----------------------- | -------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `GET`    | `/agents`               | `agent:read`   | —                              | `{ agents: ImportAgent[] }`                                                                                        |
| `POST`   | `/agents`               | `agent:create` | `createImportAgentSchema`      | `201 { agent, enrollment: { token, expiresAt } }` — token shown once                                               |
| `GET`    | `/agents/{id}`          | `agent:read`   | —                              | `{ agent: ImportAgent }` or 404 `AGENT_NOT_FOUND`                                                                  |
| `PATCH`  | `/agents/{id}`          | `agent:update` | `updateImportAgentSchema`      | `{ agent }`                                                                                                        |
| `DELETE` | `/agents/{id}`          | `agent:delete` | —                              | `204`; `409 AGENT_IN_USE` if any `importer_configs.agentId` references it                                          |
| `POST`   | `/agents/{id}/enroll`   | `agent:update` | —                              | `200 { agent, enrollment: { token, expiresAt } }` — issues a fresh enrollment token (rotation); clears `revokedAt` |
| `POST`   | `/agents/{id}/revoke`   | `agent:update` | —                              | `{ agent }` — sets `revokedAt`, drops live session (`disconnectReason: "revoked"`), rejects future connects        |
| `GET`    | `/agents/{id}/sessions` | `agent:read`   | `?limit` (default 50, max 200) | `{ sessions: AgentSession[] }` newest-first                                                                        |

Errors on management routes follow the standard envelope: duplicate name
→ `409 AGENT_NAME_TAKEN`; unknown id → `404 AGENT_NOT_FOUND`; Zod
rejects → `400 VALIDATION_FAILED`.

## Agent channel (`routes/agent-channel.ts`)

### `POST /api/v1/agent/enroll` — public, CSRF-exempt (R8)

Body: `{ token: string }` (`enrollRequestSchema`).

- `200 { agentToken: string, agent: ImportAgent }` — the
  durable credential plus the agent DTO, returned exactly once. Marks
  `enrollmentTokenUsedAt`, clears `enrollmentTokenHash`, sets
  `credentialHash`/`credentialIssuedAt`, writes `enrolled` audit entry
  (actor `agent:<name>`).
- `401 AGENT_ENROLLMENT_INVALID` — unknown, expired, used, or revoked
  agent's token. Logged + `agent_stream_rejected_total{reason="enroll_*"}`;
  no audit row.

### `GET /api/v1/agent/stream` — WebSocket upgrade

preHandler `verifyAgentCredential` (`plugins/agent-auth.ts`):
`Authorization: Bearer <agentToken>` → `hashToken()` →
`import_agents.credentialHash` lookup; `revokedAt` set → reject.
Rejects with `401 AGENT_CREDENTIAL_INVALID` before upgrade — logged,
counted (`reason="credential"`), never audited.

Post-upgrade behavior (handshake, heartbeat, close) is defined in
[agent-protocol.md](./agent-protocol.md).

## Show-once guarantee

`enrollment.token` and `agentToken` appear **only** in their issuance
responses. List/detail DTOs expose `hasCredential` and
`pendingEnrollment` booleans — never hashes or plaintext.
