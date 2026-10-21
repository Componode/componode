---
"@componode/core": minor
"@componode/backend": minor
"@componode/frontend": minor
"@componode/agent": minor
---

Import Agent foundation (spec `025-import-agents-foundation`, ADR-116): the hub can now reach private, egress-only networks — a `componode-agent` process inside the network discovers assets locally and connects out over a single authenticated WebSocket.

- **Lifecycle API**: admins create, list, inspect, update, revoke, rotate, and delete Import Agents under `/api/v1/agents`. Creation/rotation return single-use enrollment material plus a copy-ready `docker run` command — tokens are stored hashed, shown once, and expire unused after 24h.
- **Enrollment & stream**: `POST /agent/enroll` exchanges the token for a durable bearer credential; `GET /agent/stream` upgrades to WebSocket and enforces a lockstep `hello` handshake — protocol version and the exact importer name/version set must match or the stream rejects with `version_mismatch`/`importer_mismatch`.
- **Presence & sessions**: agents report `CONNECTED`/`OFFLINE`/`NEVER_CONNECTED`; every stream lands an `agent_sessions` history row. Hub restart reconciles orphans; a second connection supersedes the first; `lastSeenAt` tracks the last accepted frame and a sweep closes stale sessions as `heartbeat_timeout`.
- **UI**: Agents settings page lists agents with live status, last-seen, and capability counts; the detail page shows session history, revoke/rotate/delete lifecycle actions, and a show-once enrollment dialog with the install command.
- **Agent runtime**: new `@componode/agent` package — enrolls over HTTP, persists the credential at `0600`, connects WSS with heartbeats and retry backoff, and fails closed (refuses non-loopback `http://`, honours `CA_BUNDLE`/proxy env vars, exits with distinct codes for credential/protocol/superseded terminal reasons). Ships as a non-root Alpine-based Docker image via `Dockerfile.agent`.
- Job dispatch, remote import execution, and agent-managed credentials are intentionally deferred to specs 026/027.
