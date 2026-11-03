# Contract: Web/API importer and URL Check API deltas

## ImporterConfig

The existing authenticated ImporterConfig create/update/read operations keep
their paths and role boundaries. Their `scope` uses the v2 collection shape
defined in [`importer-config-scope.md`](importer-config-scope.md). Existing
config migrations are explicit and one-to-one.

## URL Check reads and writes

Read behavior remains available to authenticated sessions:

- `GET /api/v1/components/{componentId}/url-checks`
- `GET /api/v1/url-checks/{id}`
- `GET /api/v1/url-checks/{id}/metrics`
- `GET /api/v1/url-checks/{id}/observations`
- `GET /api/v1/components/{componentId}/monitoring-setup`

Direct check-definition writes are deprecated and read-only immediately:

| Operation                                          | Required behavior                      |
| -------------------------------------------------- | -------------------------------------- |
| `POST /api/v1/components/{componentId}/url-checks` | HTTP 410, `URL_CHECK_WRITE_DEPRECATED` |
| `PATCH /api/v1/url-checks/{id}`                    | HTTP 410, `URL_CHECK_WRITE_DEPRECATED` |
| `DELETE /api/v1/url-checks/{id}`                   | HTTP 410, `URL_CHECK_WRITE_DEPRECATED` |

`PUT /api/v1/components/{componentId}/monitoring-setup` remains available for
the Component-level shared cadence/vantage defaults under its existing
permission.

`POST /api/v1/components` continues ordinary manual Component/Instance
creation. A request carrying the retired `monitoring` block returns HTTP 410
with `URL_CHECK_WRITE_DEPRECATED`; no Component, instance, setup, or check is
created.

Importer-managed definitions change only through ImporterConfig writes. The
Component detail check list is read-only for all checks and links to the
ImporterConfig when a managed owner exists. Legacy manual check rows remain
disabled and readable.

All operation/response changes update `docs/openapi.yaml` in the same
implementation change and regenerate `docs/api.md` under ADR-104. The
deprecated write operations remain in OpenAPI with `deprecated: true` and the
410 response until a later API-removal decision.
