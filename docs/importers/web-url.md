# Web URL importer

Imports a single web page or endpoint as a component. On each run it
performs one HTTP `GET` against the URL and records the response.

## What it creates

- One component (`WEB_ENDPOINT` category, provider `WEB_URL`) named after
  the URL.
- One instance (`PRODUCTION` environment) whose status is `RUNNING` when the
  page responds 2xx, otherwise `ERROR`. The status code and a 200-character
  body preview are stored in component `details`.

## Prerequisites in the external tool

- The URL must be reachable over **HTTP(S)** from the Componode backend.
- The page is fetched **unauthenticated** — there is no credential support.
- URLs pointing at `localhost`, private/loopback/link-local IPs, cloud
  metadata addresses, or non-HTTP(S) schemes are rejected by the SSRF guard.

## Credentials

None.

## Configuration

| Field | Type | Default | Description |
|---|---|---|---|
| `url` | URL | — | The web page/endpoint to probe (required) |

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| "URL is not allowed" | URL is private/loopback/metadata or non-HTTP(S) — the SSRF guard is working |
| Instance `ERROR` status | Page responded non-2xx — recorded as-is so the catalog reflects reachability |

## Source identity

Identity is the canonicalized `url` (scheme-normalized, credentials and auth
query params stripped — never stored). `externalId` already uses the URL, so
it is unchanged. Migration 023 backfills a Source + memberships for existing
configs.
