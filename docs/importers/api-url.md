# API URL importer

Imports a single API endpoint as a component. On each run it performs one
HTTP `GET` against the URL and records the response.

## What it creates

- One component (`API` category, provider `API_URL`) named after the URL.
- One instance (`PRODUCTION` environment) whose status is `RUNNING` when the
  endpoint responds 2xx, otherwise `ERROR`. The response status code and
  parsed JSON payload are stored in component `details`.

## Prerequisites in the external tool

- The URL must be reachable over **HTTP(S)** from the Componode backend and
  return JSON.
- The endpoint is fetched **unauthenticated** — there is no credential
  support. Don't point it at endpoints that require auth or that expose
  sensitive payloads to this network path.
- URLs pointing at `localhost`, private/loopback/link-local IPs, cloud
  metadata addresses, or non-HTTP(S) schemes are rejected by the SSRF guard.

## Credentials

None.

## Configuration

| Field | Type | Default | Description |
|---|---|---|---|
| `url` | URL | — | The API endpoint to probe (required) |

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| "URL is not allowed" | URL is private/loopback/metadata or non-HTTP(S) — the SSRF guard is working |
| Instance `ERROR` status | Endpoint responded non-2xx — still recorded, that's the point of the probe |

## Source identity

Identity is the canonicalized `url` (scheme-normalized, credentials and auth
query params stripped — never stored). `externalId` already uses the URL, so
it is unchanged. Migration 023 backfills a Source + memberships for existing
configs.
