---
title: Troubleshooting & FAQ
description: Common failures and fixes, grouped by where they surface.
---

# Troubleshooting & FAQ

Common failures grouped by where they surface. When in doubt, check the
logs first — `docker compose logs app` for the hub, and the agent process
logs for remote runs.

## Deployment

| Symptom | Likely cause |
|---|---|
| Port conflict on startup | `PORT` in `.env` is taken — change it or free the port |
| `app` never becomes healthy | Postgres isn't ready — `docker compose logs postgres` |
| App exits before accepting traffic | A required secret is missing; the log names it |
| Container exits on upgrade | A migration failed — fix the issue, `docker compose up -d` again; data survives in the volume |
| Browser shows a cert warning | Expected — bundled Caddy issues a self-signed cert. See [Deployment → TLS](./deployment#tls-and-reverse-proxy) |
| Smoke test won't run on Windows | It's a Bash script — use Git Bash/WSL or run the PowerShell-equivalent steps from `scripts/smoke-test.sh` |

## Sign-in & access

| Symptom | Likely cause |
|---|---|
| Valid login rejected | Wrong credentials, or the user is deactivated — an admin can check under `/users` |
| Register page returns 404 | Self-registration is disabled in authentication settings |
| OIDC login loops or fails | Issuer URL, client credentials, or `PUBLIC_URL` mismatch — the callback must resolve to the external origin |
| `403` on an action you can see in the UI | UI guards are advisory — your role genuinely lacks the permission. See [roles](./credentials-and-access#people-and-roles) |
| Mutations fail with a CSRF error | Missing/mismatched `x-csrf-token` header — happens only to non-browser API clients |

## Imports

| Symptom | Likely cause |
|---|---|
| Credential test fails | Wrong secret values, expired token, or insufficient scopes — each [importer guide](./importers/) lists required permissions |
| URL field rejected | URL safety rules block `localhost`, private/loopback IPs, and non-HTTP(S) schemes |
| Capability sections show `FORBIDDEN`/`ERROR`/`UNAVAILABLE` | The credential lacks an optional permission — base import still succeeded; the marker lives on `details.capabilities` |
| A re-run created duplicates | Shouldn't happen — matching is by stable external ID. If it does, that's a bug worth reporting |
| Assets vanished from view | The source stopped reporting them → instances flip to `GONE`, and default queries hide them. Include GONE/RETIRED via filters |
| Run is stuck | Cancel it from the run page; the importer's abort token propagates to the agent when remote |

## Import Agents

| Symptom | Likely cause |
|---|---|
| `no credential material` at startup | No token env/file and no persisted credential — pass an enrollment token |
| `enrollment rejected by hub (401)` | Token used, expired (~24 h), or mistyped — rotate a new one |
| `credential rejected (401)` on stream | Agent revoked or deleted — rotate to re-enable, or recreate |
| `importer_mismatch` close | Agent image built from a different commit than the hub — rebuild in lockstep |
| `refuses insecure` config error | `HUB_URL` is `http://`/`ws://` to a non-loopback host — use TLS |
| Remote run fails `AGENT_UNAVAILABLE` / `AGENT_LOST` | Agent offline, blocked by policy, or its session dropped — remote runs never resume; fix the agent and re-run |

Full agent reference: [Import Agents](./import-agents) ·
[wire protocol](./agent-protocol).

## API

| Symptom | Likely cause |
|---|---|
| `401` on an authenticated route | Session cookie missing/expired — log in again |
| `409 CYCLE` when wiring products | The edge would create a composition cycle — `COMPOSES` is a DAG |
| `VALIDATION_FAILED` | Request body failed Zod validation; `details` names the fields |
| Error body looks like RFC 7807 | Expected — see [API conventions](./api#conventions) |

## FAQ

**Is this production-ready?** No — it's a personal learning project. The
security design is real and documented, but don't run it against
infrastructure you care about.

**Can importers write back to my tools?** No. Importers are pull-only
generators; they never mutate the source system or the database.

**Will a deleted importer config erase history?** No. Its Source becomes
`UNMONITORED`, run history is preserved, and its components stay `ACTIVE`
while any other source still reports them.

**Where's the API spec?** [Interactive OpenAPI](./openapi-reference)
(rendered from `openapi.yaml`) or the [conventions + tables](./api) page.
