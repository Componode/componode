# Data Model: URL Check Onboarding Completion

No schema migration is required.

## ComponentInstance (existing table)

Created by the new manual first-instance path:

| Field                                                      | Rule                                                                                                        |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `id`                                                       | UUID v7 generated server-side                                                                               |
| `componentId`                                              | Existing ACTIVE Component UUID                                                                              |
| `environment`                                              | Required core enum: `DEV`, `TEST`, `STAGING`, `DEMO`, `PRODUCTION`, `OTHER`                                 |
| `url`                                                      | Optional, max 2048 characters                                                                               |
| `version`                                                  | Optional, max 100 characters                                                                                |
| `region`                                                   | Optional, max 100 characters                                                                                |
| `status`                                                   | Server-set to `RUNNING`                                                                                     |
| `externalId`                                               | Deterministic manual marker: `manual:<component slug>`                                                      |
| `slug`                                                     | Unique globally; generated from component slug, environment, and external ID with suffix collision handling |
| `rawConfig`, `deployedAt`, `lastSeenAt`, `lastSeenInRunId` | `null`                                                                                                      |
| `createdBy`, `createdAt`, `updatedAt`                      | Standard audit/timestamp fields                                                                             |

The endpoint is intentionally scoped to a Component with **zero** existing `component_instances` rows. It does not become a general instance-CRUD surface.

## URL Check (existing table)

The composite flow now sends the full applicable create shape:

- `name`, `url`, `method`, `enabled`, `cadenceSeconds`, `successPolicy`
- `authMode`: `NONE`, `BASIC`, `BEARER`, or `CUSTOM_HEADERS` for API-category Components only
- `credentialId` + `authConfig`: credential ID plus key names only; never secret values
- `availabilityTarget` + `targetWindow`: optional and set together

## Role-sensitive fields

- `url_check.credentialId`, `authMode`, and `authConfig`: changing credential-bearing authentication requires `credential:read` (ADMIN); resubmitting unchanged values does not.
- `monitoring_setup.agentId`/`vantage === "AGENT"`: switching to Agent or changing the agent requires `agent:read` (ADMIN); preserving an existing Agent vantage does not.
- All other URL Check create/update fields and Hub setup remain EDITOR.
