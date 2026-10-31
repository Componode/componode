# Contract: per-importer source identity keys

Ratified in ADR-120. `externalIdentity` is always canonicalized
(`canonicalizeSourceIdentity` — userinfo, auth query params, fragments
stripped) before matching or persisting. Sources are never matched by
`label` (ADR-119 #1).

## Key table

| Importer | `externalIdentity` | Acquisition | `label` (as sent) |
|---|---|---|---|
| `github` | `{canonicalBaseUrl}org/{orgId}` | `octokit.rest.orgs.get({org})` at run start | `parsed.org` |
| `aws` | `{sourceKey}` | `scope.sourceKey` — required | none |
| `azure` | `{subscriptionId}` or `{sourceKey}` | `scope.subscriptionId` preferred; `scope.sourceKey` fallback | none |
| `alibaba-cloud` | `{accountId}` | `client.getCallerIdentity()` (already pre-yield) | `Alibaba Cloud account {accountId}` |
| `kubernetes` | `{canonicalEndpoint}` or `{sourceKey}` | `scope.endpoint` preferred; `scope.sourceKey` fallback | none |
| `api-url` | `{canonicalUrl}` | `scope.url` (required) | canonical url |
| `web-url` | `{canonicalUrl}` | `scope.url` (required) | canonical url |
| `mcp-server` | `{canonicalEndpoint}` or `{sourceKey}` | `scope.endpoint` preferred; `scope.sourceKey` fallback | none |

## `sourceKey` scope field

- Optional scope key on `aws`, `azure`, `kubernetes`, `mcp-server`
  configs; Zod: trimmed non-empty string.
- For `aws` it is effectively required: the stub has no provider-native
  identity source, so a run without `sourceKey` must fail fast
  (config-level validation error, not a mid-run violation).
- For `azure`/`kubernetes`/`mcp-server` it is the fallback when the
  preferred key (`subscriptionId`/`endpoint`) is absent; when neither is
  present the run fails the same way.
- Non-secret by definition — lives in scope, never in credentials.

## Failure semantics

- Adopting importer yields before reporting, or finishes without
  reporting → `CONTRACT_VIOLATION` (existing enforcement, spec 044).
- Identity acquisition itself fails (API error, missing required key) →
  run `FAILED` before any yield; no Source is invented.
- Two configs reporting the same `externalIdentity` → same
  `ImporterSource`, rebind-on-report (ADR-119 A1).

## externalId qualification rule

`qualifyExternalId(identity, nativeId) = "{identity}::{nativeId}"`,
applied only where the native ID is not globally unique:

| Importer | Qualified? |
|---|---|
| github | only when `baseUrl` differs from `https://api.github.com` |
| aws | always |
| azure | never — scope identity already prefixes (`{sub}:{rtype}`) |
| alibaba-cloud | only the non-ARN fallback `{type}:{id}` |
| kubernetes | always |
| api-url | never |
| web-url | never |
| mcp-server | always |

`legacyExternalId(qualified)` strips the first `{identity}::` prefix —
the exact pre-migration format for all importers above.
