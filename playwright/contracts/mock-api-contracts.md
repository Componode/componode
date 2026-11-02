# Local Mock API Contracts

These contracts describe only the provider behavior called by current Componode implementations. They are not replacements for provider APIs and are reachable only on the internal test network. The endpoint paths below must be checked against the current importer source before implementation.

## Common scenario protocol

- Each mock has immutable fixture profiles for `baseline`, `empty`, `changed`, `omitted`, and relevant failure conditions where the provider contract supports that concept.
- A test-only scenario controller resets/selects profiles; it is not part of the provider-facing API and must not be published to the host.
- Scenario selection is serialized with importer runs. The first implementation uses one Playwright worker.
- Mocks return provider-shaped JSON/XML/text and status/header behavior, not Componode `DiscoveredAsset` objects.
- Verify every importer reports its provider-native Source identity before its first yield, including empty inventories.
- Any new importer-package unit test must exercise `validateDiscoveredAsset`; the planned user journeys do not bypass that contract.
- Mock logs expose request method/path/action and scenario name only. Never print Authorization headers, request signing material, raw secret values, or generated enrollment tokens.
- Every test target resolves to a Compose service alias. The runtime network is internal and has no external route.

## `web-url` and `api-url`

Both implementations make one GET request to the configured URL.

| Importer | Success response | Other scenarios |
| --- | --- | --- |
| Web URL | HTTP response with representative text body; verify status-to-component state | Empty text body still yields the single endpoint asset; non-success HTTP response yields an ERROR instance; timeout/connection failure fails the run |
| API URL | HTTP response with valid JSON matching the importer’s expected payload shape | A valid empty JSON value is still the single endpoint asset's payload; changed payload; malformed/empty HTTP body fails JSON parsing; non-success HTTP response with valid JSON yields an ERROR instance |

Both URL importers emit one endpoint Component for a valid URL and response; inventory omission is not an applicable scenario for them. Exercise omitted resources with collection importers instead. Use an internal `.test` alias. The URL safety validator rejects localhost names and private IP literals, but validates the URL hostname without resolving DNS; Docker internal DNS must resolve the permitted test hostname directly to the mock.

## GitHub REST

The importer accepts a configurable HTTPS `baseUrl`, so configure Octokit to a local HTTPS mock. The Node process trusts the test CA using an explicit CA bundle.

The mock must implement the routes used by the importer:

- `GET /rate_limit`.
- `GET /orgs/{org}`.
- `GET /orgs/{org}/repos` and `GET /repos/{owner}/{repo}`.
- `GET /orgs/{org}/teams`.
- Organization Actions runners and packages.
- Organization billing usage, Actions, Packages, shared-storage, AI-credit, and premium-request usage endpoints.
- Repository environments, deployments, deployment statuses, latest release, branches, branch detail, and Actions workflows.

Behavior contracts:

- Paginated repositories/teams use valid GitHub `Link` headers and support multiple pages.
- `orgs.get` 403/404 follows the importer’s identity fallback path; 5xx fails the run.
- Capability endpoint failures generate the importer’s expected error markers rather than an unrelated global mock failure.
- Runner responses include the expected `total_count` envelope.
- Include normal, empty, changed, omitted, capability failure, 403/404 fallback, and 5xx fixtures.

## Alibaba Cloud RPC APIs

The SDK makes signed RPC-style HTTPS calls. Only Resource Center has a configurable endpoint; STS and BSS retain default host resolution.

| Product | Host | Actions |
| --- | --- | --- |
| STS 2015-04-01 | `sts.aliyuncs.com` (or the configured regional host) | `GetCallerIdentity` |
| Resource Center 2022-12-01 | Configurable endpoint | `GetResourceCenterServiceStatus`, `GetResourceCounts`, `SearchResources`, optional `GetResourceConfiguration` |
| BSS OpenAPI 2017-12-14 | `business.aliyuncs.com` | `DescribeInstanceBill` |

The mock must:

- Route fixed STS and BSS hostnames through Compose network aliases and a locally trusted TLS certificate whose SANs match those official hosts.
- Use the configurable Resource Center endpoint for its local route.
- Parse RPC query fields and validate the expected `Action`, API `Version`, required request shape, and presence of authentication fields.
- Return provider-shaped response envelopes, including `NextToken` pagination for `SearchResources` and `DescribeInstanceBill`.
- Accept synthetic fake credentials and not implement cryptographic signature verification.
- Support service-disabled, empty inventory, multi-page inventory, configuration enrichment, billing success/empty, and provider-error profiles.

Do not allow a fallback request to the public Alibaba endpoints. A missing alias or unrecognized RPC action fails closed.

## Docker Engine API over mTLS

The Docker target uses the existing TCP target profile, which requires HTTPS with client certificate and key. Do not mount the host Docker socket and do not use a privileged Docker-in-Docker service.

The fake Engine API server implements only the importer’s read-only calls:

- `GET /info`.
- `GET /version`, with API version at least 1.41 for Swarm behavior.
- `GET /containers/json?all=1` and `GET /containers/{id}/json`.
- `GET /images/json`.
- `GET /services?status=true`, `GET /nodes`, and `GET /secrets` for manager/Swarm scenarios.

Use an ephemeral test CA and client certificate. The server requires and verifies the client certificate, and test credentials are created through the Componode credential flow. Scenarios cover an ordinary engine, manager/Swarm inventory, API version below the Swarm floor, malformed data, and transport/provider errors.

## OIDC and application-owned URL Check targets

- Dex is a real local OIDC provider, not an external provider mock. The issuer, discovery document, authorization endpoint, token endpoint, and JWKS URL use a local HTTPS hostname and matching trusted CA.
- A local URL Check target is separate from importer mock APIs. It verifies NONE, BASIC, BEARER, and CUSTOM_HEADERS through a real Hub probe. It returns a status based on expected credentials and records only header names and match booleans.
- Agent-vantage probes use the real Import Agent WSS connection. The offline case uses a registered Agent with no active session; no host Docker control is required to create this state.
- All observations and histories are read back through Componode APIs/UI. Request secrets are never echoed by the target.
