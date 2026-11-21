### ADR-013 — Component taxonomy: 24 categories + provider + resourceType

> **Status:** Ratified

**Context**: The component type taxonomy is the heart of the tool. Research
across 18 tools (IDPs, cloud/CSPM, API/MCP, CMDB/EA, Kubernetes) confirmed
two-level classification is the industry norm.

**Decision**: **Two-level discriminator: `Component.category` (enum) +
`Component.provider` (enum) + free-form `Component.resourceType` (string).**

**24 categories** (all in v1):
```
COMPUTE, SERVERLESS, CONTAINER, CONTAINER_ORCHESTRATION,
DATABASE, STORAGE, NETWORK, QUEUE, CDN, DNS, CERTIFICATE, SECRET, KMS_KEY,
IDENTITY, OBSERVABILITY, API, MCP_SERVER, WEB_ENDPOINT,
REPOSITORY, PACKAGE_REGISTRY, DOCUMENTATION, IAC, JOB, LIBRARY
```

**Provider enum** (with `OTHER` escape hatch):
```
AWS, AZURE, GCP, ALIBABA_CLOUD, CLOUDFLARE,
OPENSHIFT, KUBERNETES, DOCKER, PODMAN,
GITHUB, GITLAB, BITBUCKET, AZURE_DEVOPS,
APIGEE, KONG, AWS_API_GATEWAY, GRAVITEE, BOOMI, MULESOFT,
MCP, OKTA, KEYCLOAK, ENTRA_ID,
DATADOG, PAGERDUTY, SENTRY, NEWRELIC,
NPM, PYPI, MAVEN, NUGET, ECR, GHCR,
ON_PREM, OTHER
```

**`resourceType`** carries the provider-native type verbatim (e.g.
`ec2:instance`, `Microsoft.Compute/virtualMachines`, `apps/v1:Deployment`).

**Rationale**: Grounded in primary-source research
(`researches/component_taxonomy_research.md`). Matches AWS Resource Explorer
(`{service}:{resource-type}`), Azure Resource Graph
(`{provider}/{resource-type}`), cartography (provider-prefixed labels),
Humanitec (`type` + `driver_type`). The `CONTAINER`/`CONTAINER_ORCHESTRATION`
split mirrors the Kubernetes API's own workload-vs-scope distinction. MCP_SERVER
is a genuinely new asset class (Port ships `_mcp_server`; MCP spec defines
servers by tools/resources/prompts capabilities).

**Amendment (011-github-importer-expansion)**: `ACCOUNT` added as a 25th
category — provider-level billing/administrative containers that own assets
(GitHub organization, AWS account, Azure subscription). Emitted by importers as
a component with `instances: []`; organizational sub-resources (teams, members)
are details on the component, not pseudo-components.

---

### Amendment 2 — package-registry providers + `cdxType`→category mapping (spec 075)

BOM catalog promotion (ADR-132) creates Library components from package
identities, so the provider enum gains the 13 ecosystem values the mapping
needs — `NPM`, `PYPI`, `MAVEN`, `NUGET`, `GOLANG`, `CARGO`, `RUBYGEMS`,
`PACKAGIST`, `GHCR`, `ECR`, `DEBIAN`, `RPM`, `ALPINE` — grouped separately
from the original platform providers via `COMPONENT_PROVIDER_GROUPS`
(*Platforms* = 11, *Package registries* = 13). `ecosystem` → provider:
`npm`→`NPM`, `pypi`→`PYPI`, `maven`→`MAVEN`, `nuget`→`NUGET`,
`golang`→`GOLANG`, `cargo`→`CARGO`, `gem`→`RUBYGEMS`, `composer`→`PACKAGIST`,
`deb`→`DEBIAN`, `rpm`→`RPM`, `apk`→`ALPINE`, `docker`/`oci`→`DOCKER`|`GHCR`|`ECR`
resolved from the purl's registry hostname, anything else→`OTHER`.
`cdxType` → category: `library`/`framework`/`machine-learning-model`→`LIBRARY`;
`container`→`CONTAINER`; `device`/`firmware`/`operating-system`/`platform`/
`application`→`COMPUTE`; `service`→`API`; `file`/`data`→`STORAGE`;
unmapped→`LIBRARY` (packages default). Migration 036 rebuilds
`components_provider_check` over all 24 values (the
`015_alibaba_cloud_provider.ts` drop/add pattern). Lossy inference is never
silent — the curation preview surfaces a `mappedFrom` note for every
non-`library`/`framework` derivation.