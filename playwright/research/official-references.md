# Official Reference Index

The importer endpoint details and mock request/response expectations are summarized in [`../contracts/mock-api-contracts.md`](../contracts/mock-api-contracts.md). Use these primary references when implementing or updating the mocks; also read each local Componode importer setup guide.

## Playwright

- [Docker](https://playwright.dev/docs/docker): supported runner image, browser dependencies, and container recommendations.
- [API testing](https://playwright.dev/docs/api-testing): request-context setup and postcondition checks.
- [APIRequestContext](https://playwright.dev/docs/api/class-apirequestcontext): request APIs usable for pagination and fixture checks.
- [Test reporters](https://playwright.dev/docs/test-reporters): HTML and other reporter configuration.
- [Accessibility testing](https://playwright.dev/docs/accessibility-testing): automated accessibility checks and limitations.
- [Test use options](https://playwright.dev/docs/test-use-options): browser context and HTTPS options.
- [CI](https://playwright.dev/docs/ci): reference only for keeping the local runner CI-compatible; this feature does not add CI configuration.

## pnpm

- [Workspaces](https://pnpm.io/workspaces): a workspace root is anchored by `pnpm-workspace.yaml`.
- [pnpm CLI](https://pnpm.io/pnpm-cli): `--ignore-workspace` behavior and project selection. This workload instead uses a nested workspace file so local commands are ordinary pnpm commands.

## Docker and Compose

- [Compose networking](https://docs.docker.com/compose/how-tos/networking/): service-name discovery, aliases, and internal networks.
- [Compose networks reference](https://docs.docker.com/reference/compose-file/networks/): `internal` network behavior.
- [Compose services reference](https://docs.docker.com/reference/compose-file/services/): service-scoped network aliases.
- [Build context and `.dockerignore`](https://docs.docker.com/build/concepts/context/): context filtering and ignore-file behavior.
- [Compose build reference](https://docs.docker.com/reference/compose-file/build/): context paths relative to the Compose file.
- [Docker Engine API](https://docs.docker.com/reference/api/engine/): Docker Engine HTTP API.
- [Docker Engine API v1.41](https://docs.docker.com/reference/api/engine/version/v1.41/): minimum API surface for Swarm inventory.
- [Protect Docker daemon access](https://docs.docker.com/engine/security/protect-access/): CA, server certificates, and client certificates.
- [Remote access to Docker Engine](https://docs.docker.com/engine/daemon/remote-access/): secure remote transport guidance.

## Caddy

- [Caddy `tls` directive](https://caddyserver.com/docs/caddyfile/directives/tls): `tls internal` uses Caddy's local CA.
- [Automatic HTTPS](https://caddyserver.com/docs/automatic-https): local CA files and trust-chain behavior.
- [Caddy command line](https://caddyserver.com/docs/command-line): Caddy trust command and CA trust-store behavior.

## Dex OIDC provider

- [Dex documentation](https://dexidp.io/docs/): local provider configuration.
- [Dex local connector](https://dexidp.io/docs/connectors/local/): static test users and password database.
- [Dex storage](https://dexidp.io/docs/configuration/storage/): SQLite is suitable for quick local setup.
- [Dex OAuth2 configuration](https://dexidp.io/docs/configuration/oauth2/): authorization-code and refresh-token grants.

## GitHub REST API

- [REST API pagination](https://docs.github.com/en/rest/using-the-rest-api/using-pagination-in-the-rest-api): `Link` response headers and page navigation.
- [REST API rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api): rate-limit response behavior.
- [Repositories](https://docs.github.com/en/rest/repos/repos): organization and repository routes.
- [Organizations](https://docs.github.com/en/rest/orgs/orgs): organization route family.
- [Rate limit endpoint](https://docs.github.com/en/rest/rate-limit/rate-limit): `GET /rate_limit`.
- [Actions workflows](https://docs.github.com/en/rest/actions/workflows): workflow routes.
- [Self-hosted runners](https://docs.github.com/en/rest/actions/self-hosted-runners): runner response envelope.
- [Packages](https://docs.github.com/en/rest/packages/packages): organization package routes.
- [Teams](https://docs.github.com/en/rest/teams/teams): organization team routes.
- [Billing](https://docs.github.com/en/rest/billing/billing): organization billing routes.
- [Deployments](https://docs.github.com/en/rest/deployments/deployments): deployment routes.
- [Deployment statuses](https://docs.github.com/en/rest/deployments/statuses): deployment status routes.
- [Releases](https://docs.github.com/en/rest/releases/releases): latest release route.
- [Branches](https://docs.github.com/en/rest/branches/branches): branch routes.
- [Environments](https://docs.github.com/en/rest/deployments/environments): repository environment routes.

## Alibaba Cloud APIs

- [STS endpoints](https://www.alibabacloud.com/help/en/ram/developer-reference/api-sts-2015-04-01-endpoint): fixed STS host resolution.
- [STS GetCallerIdentity](https://www.alibabacloud.com/help/en/ram/developer-reference/api-sts-2015-04-01-getcalleridentity): identity response shape.
- [Resource Center endpoints](https://www.alibabacloud.com/help/en/resource-management/resource-center/developer-reference/api-resourcecenter-2022-12-01-endpoint): configurable Resource Center endpoint.
- [Resource Center API overview](https://help.aliyun.com/en/resource-management/resource-center/developer-reference/api-resourcecenter-2022-12-01-overview): operation catalog.
- [GetResourceCenterServiceStatus](https://www.alibabacloud.com/help/en/resource-management/resource-center/developer-reference/api-resourcecenter-2022-12-01-getresourcecenterservicestatus): service status response.
- [GetResourceCounts](https://www.alibabacloud.com/help/en/resource-management/resource-center/developer-reference/api-resourcecenter-2022-12-01-getresourcecounts): count/filter response shape.
- [Resource Center SearchResources](https://www.alibabacloud.com/help/en/resource-management/resource-center/developer-reference/api-resourcecenter-2022-12-01-searchresources): request fields and `NextToken` paging.
- [GetResourceConfiguration](https://www.alibabacloud.com/help/en/resource-management/resource-center/developer-reference/api-resourcecenter-2022-12-01-getresourceconfiguration): optional resource configuration response.
- [BSS OpenAPI endpoints](https://www.alibabacloud.com/help/en/user-center/developer-reference/api-bssopenapi-2017-12-14-endpoint): fixed global billing host.
- [BSS DescribeInstanceBill](https://www.alibabacloud.com/help/en/user-center/developer-reference/api-bssopenapi-2017-12-14-describeinstancebill): billing request and response.

## Componode source references

The implementation session must re-open these local sources at the current 055 base and after 054 is integrated:

- `docs/importers/alibaba-cloud.md`, `docs/importers/github.md`, `docs/importers/docker.md`, `docs/importers/web-url.md`, `docs/importers/api-url.md`.
- `packages/importer-alibaba-cloud/src/importer.ts`, `packages/importer-alibaba-cloud/src/client.ts`.
- `packages/importer-github/src/importer.ts` and its `github-*.ts` helpers.
- `packages/importer-docker/src/importer.ts`, `packages/importer-docker/src/transport.ts`.
- `packages/importer-web-url/src/importer.ts`, `packages/importer-api-url/src/importer.ts`.
- `packages/core/src/validation/url-safety.ts`.
- `packages/backend/src/db/types.ts`, `packages/backend/src/routes/`, `packages/frontend/src/ux/app/routes.tsx`, `docs/ux.md`, and `docs/openapi.yaml`.
- 054 branch: `specs/054-url-check-onboarding/`, `researches/adrs/ADR-125-url-check-onboarding-recovery.md`, and the related route/UI/integration-test changes after they are committed and integrated.

## Reference maintenance

When an importer or OIDC/Docker/Playwright behavior changes, update the affected primary links and endpoint list in the same workload branch. Do not replace an official provider reference with a blog post when a provider API document exists.
