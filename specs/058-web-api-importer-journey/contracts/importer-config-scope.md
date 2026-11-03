# Contract: Web/API importer collection scope v2

## Purpose

Define the authored inventory and managed URL Check configuration for
`web-url` and `api-url`. The scope is stored on an ImporterConfig and is the
canonical definition source for managed checks. Importer packages remain
database-free and yield only `DiscoveredAsset`.

## Collection

| Field        | Required | Constraint                                                                          |
| ------------ | -------: | ----------------------------------------------------------------------------------- |
| `sourceKey`  |      yes | Generated UUID v7; immutable; persisted across config edits and Source reattachment |
| `components` |      yes | At least one Component profile                                                      |

The reported Source identity is `collection:<sourceKey>`. The config label is
display metadata and is never used as Source identity.

## Component profile

| Field          | Required | Constraint                                                                                     |
| -------------- | -------: | ---------------------------------------------------------------------------------------------- |
| `componentKey` |      yes | Generated UUID v7; stable; may be reused across Sources to identify the same logical Component |
| `name`         |      yes | Trimmed, 1–200 characters; editable; initial value suggested from the first instance URL host  |
| `instances`    |      yes | At least one ComponentInstance definition                                                      |

Importer package determines provider, category, and resource type:

| Importer  | Provider  | Category       | Resource type |
| --------- | --------- | -------------- | ------------- |
| `web-url` | `WEB_URL` | `WEB_ENDPOINT` | `web:url`     |
| `api-url` | `API_URL` | `api:url`      |

## ComponentInstance definition

| Field         | Required | Constraint                                                     |
| ------------- | -------: | -------------------------------------------------------------- |
| `instanceKey` |      yes | Generated UUID v7, stable and unique within a Component        |
| `environment` |      yes | Existing `ENVIRONMENTS` enum                                   |
| `url`         |      yes | HTTP(S), max 2048; independently checked by ADR-106 validation |
| `region`      |       no | Max 100 characters                                             |
| `version`     |       no | Max 100 characters                                             |
| `check`       |      yes | One managed URL Check definition for this instance             |

`instanceKey`, not environment or URL, determines the ComponentInstance
external identity. Reusing the same Component and instance keys across Sources
resolves to the same catalog records.

## Managed URL Check definition

| Field                |    Required | Constraint                                                                 |
| -------------------- | ----------: | -------------------------------------------------------------------------- |
| `checkKey`           |         yes | Generated UUID v7; stable and unique within the ComponentInstance          |
| `name`               |         yes | Trimmed, 1–120 characters; defaults from profile and environment           |
| `url`                |          no | Optional HTTP(S) override, max 2048; defaults to the ComponentInstance URL |
| `method`             |         yes | `GET` or `HEAD`; default `GET`                                             |
| `enabled`            |         yes | Boolean; default true                                                      |
| `successPolicy`      |         yes | Explicit status codes/ranges; default 200–299; at least one matcher        |
| `cadenceSeconds`     |          no | Null inherits Component monitoring setup; otherwise integer 60–86400       |
| `authMode`           |         yes | `NONE`, `BASIC`, `BEARER`, or `CUSTOM_HEADERS`; default `NONE`             |
| `credentialId`       | conditional | Credential UUID required for authenticated modes                           |
| `authConfig`         | conditional | Credential key-name mapping only; no secret values                         |
| `availabilityTarget` |          no | Null or number 0–100; paired with `targetWindow`                           |
| `targetWindow`       |          no | Null or `24H`, `7D`, `30D`; paired with `availabilityTarget`               |
| `autoDisableAfter`   |          no | Null inherits system default; integer 0–1000; 0 means never                |

Additional rules:

- Authentication is offered only by `api-url` because its Components have
  category `API`. `web-url` check definitions use `authMode: NONE`.
- `Authorization` is reserved for `BASIC`/`BEARER`; custom header names use
  the existing HTTP token validation.
- Agent-vantage checks use `AGENT_MANAGED` Credentials. Hub-vantage checks
  use existing Credential rules.
- The Component monitoring setup owns shared cadence and vantage. Per-check
  cadence is an override; there is no per-check vantage field.
- URL destination safety runs on save and again at probe time.
- Unknown fields are rejected at the config boundary.

## Identity and migration

- `componentKey`, `instanceKey`, `checkKey`, and `sourceKey` are stable across
  display-name and URL edits.
- Existing `{ url }` scope becomes one profile with one instance. Existing
  external identities seed the profile/instance keys; the existing Source row
  UUID seeds `sourceKey`.
- No automatic merge occurs across old ImporterConfigs.
- Existing importer config scope needs an explicit v1→v2 migration; changing
  `manifest.version` does not perform this transformation.
