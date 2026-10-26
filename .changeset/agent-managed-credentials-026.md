---
"@componode/core": minor
"@componode/backend": minor
"@componode/frontend": minor
"@componode/agent": minor
---

Agent-managed credentials (spec `026-agent-managed-credentials`, ADR-117): `AGENT_MANAGED` credential rows hold secret references (`env`/`file`) resolved on the agent host — values never cross the hub-agent channel. Remote `credential.test` dispatch over the agent stream.
