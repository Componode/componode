# Quickstart — Validating Import Agents Foundation

## Automated validation

```bash
pnpm install
pnpm -r build
pnpm --filter @componode/backend test       # integration: CRUD, enroll, WS auth/liveness, audit, delete-block
pnpm --filter @componode/agent test         # unit: env config, backoff, enroll+persist, mocked-WS session
pnpm --filter @componode/frontend test      # enrollment dialog, badges
pnpm --filter @componode/core test          # protocol schemas, registry factory
pnpm lint && pnpm typecheck && pnpm build
pnpm --filter @componode/backend docs:api:check   # openapi.yaml in sync (ADR-104)
```

Key integration-test coverage (testcontainers Postgres + real WS server):

- create → enrollment token once; re-GET never exposes it
- enroll happy path → durable credential; second use / expired / unknown
  token → `AGENT_ENROLLMENT_INVALID`, no audit row
- WS connect w/ credential → `hello` → `hello.ok` → `agent_sessions` row,
  status `CONNECTED`; bad credential / revoked → 401 before upgrade
- version mismatch (`protocolVersion` or importer set) → `error` + close
- second connect same credential → first session `superseded`
- heartbeat silence >90 s → session `heartbeat_timeout`, status `OFFLINE`
- revoke → session dropped, `revokedAt` set, reconnect rejected
- delete blocked with `AGENT_IN_USE` when `importer_configs.agentId` set;
  succeeds when unbound
- audit feed shows `created`/`enrolled`/`token_rotated`/`revoked`/`deleted`
  with correct actors; zero audit rows from rejected attempts
- `agent:read` non-admin → 403 `AUTH_FORBIDDEN`

## Manual smoke (dev loopback)

1. `docker compose up` the hub (or `pnpm dev`), log in as admin.
2. `/agents` → **Add agent** `dev-agent` → enrollment dialog shows token
   + copy-ready `docker run` command.
3. Run the agent against the loopback hub — either the container (with a
   TLS-terminating or host-mapped loopback address) or, simplest, the built
   package on the host (plaintext `ws://`/`http://` is allowed **only** for
   loopback hosts — `ws://host.docker.internal` is refused by design):

   ```bash
   # From repo root, after pnpm build:
   HUB_URL=http://localhost:3000 \
   AGENT_ENROLLMENT_TOKEN=<token> \
   AGENT_STATE_DIR=/tmp/agent-state \
   node packages/agent/dist/main.js
   ```

   For the containerized variant, the image must reach the hub over TLS or
   over a loopback alias (e.g. a same-host hub via `--network host` on
   Linux). State dir inside the image is `/state` (`AGENT_STATE_DIR`
   already set by `Dockerfile.agent`):

   ```bash
   docker run --rm --network host \
     -e HUB_URL=http://localhost:3000 \
     -e AGENT_ENROLLMENT_TOKEN=<token> \
     -v agent-state:/state \
     componode-agent
   ```

4. Agent logs show enroll → connect → `hello.ok` → heartbeat ticks.
   `/agents` shows `dev-agent` **Connected** with versions; agent detail
   Connection history lists the session with remote address.
5. `docker stop` → within ~90 s the agent flips to **Offline**, session
   row closed `heartbeat_timeout`.
6. Restart the container (same volume) → reconnects with the persisted
   credential, no re-enrollment.
7. Admin: **Rotate token** → new enrollment token shown once, audit
   `token_rotated`. **Revoke** → session drops, agent logs show `close
   {reason:"revoked"}` and it does not retry. **Delete** the other agent
   → gone.
8. `/activity` shows the full lifecycle with actors; `agent:dev-agent`
  appears for `enrolled`.
9. Negative: run the agent with `HUB_URL=ws://<non-localhost>` → refuses
   to start (TLS mandatory); with a bad token → upgrade rejected,
   nothing in `/activity`.
