# Component Taxonomy Research for Componode

> **Purpose**: Inform the foundational schema decision for the component-type
> taxonomy of Componode — specifically how "components" (the building blocks a
> Digital Product composes/depends on) should be classified, how polymorphism
> should be modeled, and how environment should be represented.
>
> **Scope**: Primary sources only (official docs, public schemas, GitHub source,
> published specs). Where a primary source could not be retrieved, this is
> stated explicitly. Secondary write-ups are used only to locate primary sources.
>
> **Relationship to existing work**: This document complements the Composable
> Product Model research. It validates, extends, and corrects the component
> taxonomy against what the industry actually models.

---

## Executive Summary

Across the seven tool categories surveyed, **no single canonical "component
taxonomy" exists**, but a clear consensus pattern emerges:

1. **Two-level classification is the industry norm.** Cloud/infra tools
   (AWS Resource Explorer, Azure Resource Graph, cartography) all key resources
   by a `(provider/service, resource-type)` pair. IDPs (Backstage, Harness IDP)
   use a `(kind, spec.type)` pair. Humanitec uses `(resource-type, driver-type)`.
   A flat single enum is rare and considered a smell (Backstage explicitly
   warns organizations to "take great care to establish a proper taxonomy").

2. **Polymorphism is handled one of three ways**: (a) a controlled top-level
   enum + free-form sub-type (Backstage `kind` + `spec.type`); (b) typed
   subclasses / table extension (ServiceNow CMDB `cmdb_ci` → hundreds of child
   tables); or (c) fully user-defined blueprints with JSON-schema validation
   (Port, Cortex, Ardoq). Componode's `category` + `provider` enum is closest
   to pattern (a) and should add a free-form `resourceType` field to carry the
   provider-native type (e.g. `ec2:instance`, `Microsoft.Compute/virtualMachines`).

3. **Environment is NOT a field on the logical asset.** Every tool that models
   environment at all models it as a **separate instance/deployment record**
   linked to the logical asset: ServiceNow CSDM's Business Application (design
   parent) → instance/deployment records across dev/test/prod; Humanitec's
   Resource (logical) → per-deployment Resource instances matched by Environment
   type; Apigee's API proxy (logical) → deployed to named environments. Backstage
   notably does **not** model environment at all — it has `spec.lifecycle`
   (experimental/production/deprecated), which is a maturity dimension, not an
   environment dimension. **Recommendation: model environment as a separate
   `ComponentInstance`/deployment record, not a field on `Component`.**

4. **The original import-source list misses several major categories the
   industry commonly tracks**: databases (as a first-class asset, not just
   "compute"), message queues/event buses, identity/SSO providers, secrets
   managers/KMS, observability backends (Datadog/PagerDuty/Sentry services),
   package/artifact registries, documentation/TechDocs sites, and
   IaC/Terraform-state backends. These appear as first-class entities in
   cartography, Backstage (Resource kind), Humanitec (resource types), and
   ServiceNow CMDB.

5. **MCP servers are an emerging, genuinely new asset class** — Port already
   ships a protected `_mcp_server` blueprint, and the MCP spec defines a server
   by its capabilities (tools/resources/prompts) plus `serverInfo` (name +
   version). Componode should model an MCP server as a distinct component
   category, not as a generic "API endpoint."

---

## 1. Methodology and Source Hierarchy

Each claim below is cited inline to a primary source URL. Source tiers, in
descending authority:

- **Spec / schema files** in the upstream repo (e.g. Backstage
  `API.v1alpha1.schema.json`, Kubernetes API meta-types).
- **Official reference documentation** (backstage.io, kubernetes.io,
  learn.microsoft.com, docs.aws.amazon.com, modelcontextprotocol.io).
- **Source code / generated API reference** (GitHub blob URLs).
- **Official Terraform provider docs** (registry.terraform.io) — used as a
  proxy for the vendor's own data model where the vendor's REST schema is not
  publicly linkable (e.g. OpsLevel, Humanitec).

Where only a secondary source was available, the claim is marked
**[secondary — primary not retrieved]**.

---

## 2. Internal Developer Portals / Service Catalogs

### 2.1 Backstage (spotify/backstage) — the de-facto reference model

Backstage's catalog is the most widely cited primary source for "what is a
software component." Its model is **two-level: `kind` (controlled) +
`spec.type` (free-form with suggested values)**.

**Kinds** (the controlled top-level enum), from the descriptor-format
documentation
([backstage.io/docs/features/software-catalog/descriptor-format](https://backstage.io/docs/features/software-catalog/descriptor-format),
mirrored in the repo at
[github.com/backstage/backstage/blob/master/docs/features/software-catalog/descriptor-format.md](https://github.com/backstage/backstage/blob/master/docs/features/software-catalog/descriptor-format.md)):

| Kind | Purpose |
|---|---|
| `Component` | "a single, individual piece of software" — the central kind |
| `API` | an interface a Component can expose/consume |
| `Resource` | "infrastructure a system needs to operate" (DBs, buckets, CDNs) |
| `System` | a collection of components + resources cooperating to expose APIs |
| `Domain` | a collection of Systems sharing terminology/business purpose |
| `Group` / `User` | ownership |
| `Template` | scaffolder templates |
| `Location` | a pointer to where catalog-info.yaml lives |

Source: [backstage.io catalog system model](https://backstage.io/docs/features/software-catalog/system-model) and
[getting-started/viewing-catalog.md](https://github.com/backstage/backstage/blob/master/docs/getting-started/viewing-catalog.md).

**`Component.spec.type`** — the field most relevant to Componode. The doc states
explicitly:

> "The software catalog accepts any type value, but an organization should take
> great care to establish a proper taxonomy for these."
> — [descriptor-format#spectype-required](https://backstage.io/docs/features/software-catalog/descriptor-format#spectype-required)

The **documented well-known values** are exactly three:

- `service` — "a backend service, typically exposing an API"
- `website` — "a website"
- `library` — "a software library, such as an npm module or a Java library"

Source: [descriptor-format](https://backstage.io/docs/features/software-catalog/descriptor-format) (the "current set of well-known and common values" list).
The TypeScript interface confirms `spec.type: string` (no enum constraint):
[ComponentEntity](https://backstage.io/api/stable/interfaces/_backstage_catalog-model.index.ComponentEntity.html).

> **Note on `job` / `resource` / `cli`:** These are frequently cited in
> community blog posts as "Backstage component types" but are **not** in the
> official well-known list. The official list is service/website/library only.
> A GitHub issue ([#24362](https://github.com/backstage/backstage/issues/24362))
> proposing to restrict `spec.type` to `[website, service, library, image, infrastructure]`
> was closed with "that's the job of a catalog processor" — i.e. Backstage
> deliberately leaves the enum open. Organizations commonly add `job`, `cli`,
> `mobile-app`, etc. via custom validation (see
> [Roadie: Kinds and Types in Backstage](https://roadie.io/blog/kinds-and-types-in-backstage/)
> — **[secondary]**, used here only to confirm the open-enum design intent).

**`Component.spec.lifecycle`** — the well-known values are
([descriptor-format#speclifecycle-required](https://backstage.io/docs/features/software-catalog/descriptor-format#speclifecycle-required)):

- `experimental`
- `production`
- `deprecated`

This is a **maturity/lifecycle dimension, NOT an environment dimension.** This
is an important distinction for Componode (see §10).

**`Resource.spec.type`** — explicitly **no enforced set of values**. The doc
gives only examples: `database`, `s3-bucket`, `kubernetes-cluster`
([descriptor-format#kind-resource](https://backstage.io/docs/features/software-catalog/descriptor-format#kind-resource)).
The `ResourceEntity` interface confirms `spec.type: string`
([ResourceEntity](https://backstage.io/api/stable/interfaces/_backstage_catalog-model.index.ResourceEntity.html)).

**`API.spec.type`** — well-known values, from the API kind schema
([API.v1alpha1.schema.json](https://github.com/backstage/backstage/blob/master/packages/catalog-model/src/schema/kinds/API.v1alpha1.schema.json))
and descriptor doc:

- `openapi` — OpenAPI 2/3
- `asyncapi` — AsyncAPI 2/3
- `graphql` — GraphQL schemas
- `grpc` — Protocol Buffers / gRPC
- `trpc` — listed in the schema's `examples` array

**Polymorphism pattern**: `kind` (controlled enum) + `spec.type` (free string
with suggested values). No provider discriminator — Backstage is
provider-agnostic by design; provider info lives in `metadata.annotations`
(e.g. `github.com/project-slug`, `backstage.io/kubernetes-label-selector`).

**Environment**: **not modeled.** Backstage has no environment field. Per-env
endpoints are sometimes stuffed into annotations/links, but the core model is
environment-agnostic. This is a known gap that commercial IDPs (OpsLevel,
Cortex, Harness) layer on top.

### 2.2 Harness IDP

Harness IDP 2.0 uses a Backstage-compatible descriptor format and explicitly
inherits the same kinds: Component, API, Resource, System, User/Group
([Harness IDP catalog overview](https://developer.harness.io/docs/internal-developer-portal/catalog/overview/)).
The `Component.spec.type` well-known values are repeated verbatim as
`service` / `website` / `library`
([register-a-software-component](https://developer.harness.io/docs/internal-developer-portal/tutorials/register-component-in-catalog/)).
IDP 2.0 introduced a Harness-native model (`apiVersion: harness.io/v1`) but
keeps the same `kind`/`spec.type` structure
([create-manually](https://developer.harness.io/docs/internal-developer-portal/catalog/create-entity/create-manually/)).

**Notable**: Harness lists Resource examples as "Databases, message queues,
storage buckets, or infrastructure resources" — i.e. it explicitly calls out
**databases and message queues** as first-class Resources, a category the
original list omitted.

### 2.3 OpsLevel

OpsLevel's central entity is the **Service**, whose schema is exposed via the
Terraform provider
([registry.terraform.io/providers/OpsLevel/opslevel — opslevel_service](https://registry.terraform.io/providers/OpsLevel/opslevel/latest/docs/data-sources/service)).
Service fields relevant to taxonomy:

- `lifecycle_alias` — the lifecycle stage (configurable; OpsLevel does not
  hard-code dev/staging/prod — levels are account-configured)
- `tier_alias` — the software tier (Tier 1/2/3, customer-defined)
- `language`, `framework` — primary implementation language/framework
- `product` — "an application that your end user interacts with. Multiple
  services can work together to power a single product." (This is a
  product→service composition relationship, directly relevant to Componode.)
- `system` — the system the service belongs to
- `repositories` — list of repos connected to the service (repo ≠ service)
- `component_type` — appears in check configuration
  ([opslevel_check_service_property](https://registry.terraform.io/providers/OpsLevel/opslevel/latest/docs/resources/check_service_property)):
  "The Component Type that a custom property belongs to … To limit the check
  to a specific component type (e.g., only Services)."

**Polymorphism**: OpsLevel uses a **single primary entity (Service)** with
discriminator fields (`tier`, `lifecycle`, `language`, `framework`) plus
**Custom Properties** (an object system)
([docs.opslevel.com/docs/custom-properties](https://docs.opslevel.com/docs/custom-properties)).
There is no fixed "component type enum"; type-ness is expressed via `tier` +
`language` + `framework` + custom properties + tags. This is the
**labels/properties pattern** rather than a typed hierarchy.

**Environment**: OpsLevel models lifecycle as a configurable stage on the
service, not a separate instance entity. It does not natively model
"dev/test/prod instances of a service" — that is left to integrations
(Kubernetes, etc.).

### 2.4 Port

Port takes the **fully user-defined blueprint** approach. Blueprints "represent
assets in your organization" and are completely customizable
([docs.port.io — set up blueprints](https://docs.port.io/build-your-software-catalog/customize-integrations/configure-data-model/setup-blueprint/)).
There is no fixed component-type enum; the default `service` blueprint is
described as "a flexible blueprint representing a piece of software that is
owned by a team/group"
([default-blueprints](https://docs.port.io/context-lake/data-model/setup-blueprint/default-blueprints/)).

**Notable for Componode**: Port ships **protected system blueprints** including
`_mcp_server` ("External MCP servers connected to Port") — i.e. **Port already
treats an MCP server as a first-class asset class**
([default-blueprints](https://docs.port.io/context-lake/data-model/setup-blueprint/default-blueprints/)).
This is primary-source confirmation that MCP servers are an emerging asset
category the industry is starting to track.

**Polymorphism**: blueprint = entity type; each blueprint has a JSON-schema
for its properties. Type system is entirely user-defined.

### 2.5 Cortex

Cortex ships built-in entity types **`service`, `domain`, `team`** and allows
**custom entity types** with a JSON schema
([docs.cortex.io — adding custom entity types](https://docs.cortex.io/ingesting-data-into-cortex/entities/adding-entities/entity-types);
[entities-overview/add-services](https://docs.cortex.io/ingesting-data-into-cortex/entities-overview/entities/adding-entities/add-services)).
Entities are defined by a `cortex.yaml` with `x-cortex-type` (e.g.
`x-cortex-type: service`)
([docs.cortex.io/configure/settings/search](https://docs.cortex.io/configure/settings/search)).

**Polymorphism**: built-in types + custom types validated by JSON schema. The
API "List entity types" endpoint "excludes Cortex default types of service,
domain, and team"
([docs.cortex.io/api/readme/entity-types](https://docs.cortex.io/api/readme/entity-types)),
confirming the default set.

**Groups** are free-form tags with no hierarchy
([docs.cortex.io — grouping entities](https://docs.cortex.io/ingesting-data-into-cortex/entities-overview/entities/groups)):
"You might use them to express priority (`tier-0`), stack (`python`), or
architectural role (`backend`, `frontend`, `library`, `api`)." This is the
**labels/tags pattern** layered on top of the type system.

### 2.6 Humanitec (Platform Orchestrator)

Humanitec's model is the most infrastructure-oriented of the IDPs. Its core
unit is the **Resource**, which is **strongly typed by Resource Type**
([developer.humanitec.com — resources/overview](https://developer.humanitec.com/app-humanitec-io/docs/platform-orchestrator/resources/overview/)):

> "Resources are strongly typed. Each Resource in the Graph has exactly one
> Resource Type, e.g. `workload`, `postgres`, or `postgres-instance`."

Resource Types are **open and user-definable**
([configure/resource-types](https://developer.humanitec.com/platform-orchestrator/docs/configure/resource-types/)):
a resource type has `id`, `description`, `is_developer_accessible`, and an
`output_schema` (JSON Schema). Documented/example types from the Terraform
provider
([humanitec_resource_definition](https://registry.terraform.io/providers/humanitec/humanitec/latest/docs/resources/resource_definition)):
`s3`, `dns`, `postgres`, plus implicit types `workload`, `k8s-cluster`,
`k8s-namespace`.

**Polymorphism**: **type + provider/implementation discriminator**. Each
Resource Definition has a `type` (the logical resource type, e.g. `postgres`)
**and** a `driver_type` (the concrete implementation, e.g.
`humanitec/postgres-cloudsql-static`). This is a **two-level (logical type +
provider/driver) discriminator** — directly analogous to the Componode
`category + provider` proposal. Multiple definitions can exist for the same
type, selected by **matching criteria** that include Environment type.

**Environment**: Humanitec models Environment as a **first-class deployment
context**. "The Platform Orchestrator reads the context from the metadata of
the deployment (the user is deploying to an Environment of type staging) and
now matches the correct Resource Definition for this context"
([resource-management-theory](https://developer.humanitec.com/app-humanitec-io/guides/getting-started/master-your-internal-developer-platform/resource-management-theory/)).
A Resource is instantiated **per deployment per environment** — the logical
type is stable, the concrete resource instance varies by environment. This is
the **instance-per-environment pattern**.

---

## 3. Cloud / Infrastructure Asset Inventory & CSPM

### 3.1 AWS Resource Explorer + AWS Config

AWS Resource Explorer keys every resource by a **two-part type string
`{service}:{resource-type}`**, exposed via the
`ListSupportedResourceTypes` API
([docs.aws.amazon.com — supported-resource-types](https://docs.aws.amazon.com/resource-explorer/latest/userguide/supported-resource-types.html);
[CLI list-supported-resource-types](https://docs.aws.amazon.com/cli/latest/reference/resource-explorer-2/list-supported-resource-types.html)).
Examples from the API response:

- `cloudfront:distribution`
- `cloudfront:cache-policy`
- `cloudwatch:alarm`
- `ec2:instance` (implied by the service grouping)

The API returns `{ "Service": ..., "ResourceType": ... }` pairs
([Boto3 ListSupportedResourceTypes](https://docs.aws.amazon.com/boto3/latest/reference/services/resource-explorer-2/paginator/ListSupportedResourceTypes.html)).
Resource Explorer only indexes resources that have ARNs
([Resource Explorer FAQs](https://aws.amazon.com/resourceexplorer/faqs/)).

**Polymorphism**: **`{service}:{resource-type}` two-level namespace** —
service is the provider/namespace, resource-type is the kind. This is the
canonical cloud-asset two-level discriminator.

**Environment**: AWS has no first-class "environment" concept at the resource
level. Environments are conventionally encoded via accounts, regions, tags, or
VPCs — not a field on the resource. (AWS Config records configuration
snapshots over time, which is a temporal/audit dimension, not environment.)

### 3.2 Azure Resource Graph

Azure Resource Graph queries resources by `type`, which follows the format
**`{resource-provider}/{resource-type}`**
([learn.microsoft.com — resource-providers-and-types](https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/resource-providers-and-types)):
"A resource type's name follows the format: `{resource-provider}/{resource-type}`.
The resource type for a key vault is `Microsoft.KeyVault/vaults`."
Example query: `where type =~ 'Microsoft.Compute/virtualMachines'`
([explore-resources](https://learn.microsoft.com/en-us/azure/governance/resource-graph/concepts/explore-resources)).

The resource-provider namespace (e.g. `Microsoft.Compute`, `Microsoft.KeyVault`,
`Microsoft.Network`, `Microsoft.Storage`, `Microsoft.Sql`) **is itself the
grouping axis** — compute/storage/network/db/identity are grouped by provider
namespace. The full provider→type tree is enumerable via the ARM API.

**Polymorphism**: **`{provider}/{resource-type}` two-level namespace** —
identical structural pattern to AWS, just `/`-delimited instead of `:`.

**Environment**: Azure uses **resource groups + subscriptions + management
groups** as the scoping hierarchy; "environment" is again a convention
(separate subscriptions or resource groups for dev/test/prod), not a field.

### 3.3 cartography (Lyft → CNCF)

cartography is the most directly relevant primary source for Componode because
it stores assets in a graph and models multi-provider inventory. Its schema is
documented at
[docs.cartography.dev/modules/aws/schema.html](https://docs.cartography.dev/modules/aws/schema.html)
and the repo
[github.com/cartography-cncf/cartography](https://github.com/cartography-cncf/cartography).

**Polymorphism**: **provider-prefixed node labels**. Resources are
labeled `AWSEC2Instance`, `AWSRDSInstance`, `AWSLambda`, `AWSS3Bucket`,
`AWSDynamoDBTable`, `AWSEKSCluster`, etc., all hanging off an `AWSAccount` via
`(:AWSAccount)-[:RESOURCE]->(...)` relationships
([AWS schema](https://docs.cartography.dev/modules/aws/schema.html)). The docs
note: "AWS resource labels are provider-prefixed. Labels that were historically
unprefixed remain attached as compatibility aliases until v1.0.0"
([schema.md](https://github.com/cartography-cncf/cartography/blob/master/docs/root/modules/aws/schema.md)).

Supported platforms (each a module with its own label namespace):
AWS, Azure, GCP, Kubernetes, GitHub, GitLab, Cloudflare, Okta, DigitalOcean,
CrowdStrike, Docker Scout, and 30+ more
([schema index](https://docs.cartography.dev/usage/schema.html)). The AWS
module covers ACM, API Gateway, Bedrock, CloudWatch, CodeBuild, Config, Cognito,
EC2, ECS, ECR, EFS, Elasticsearch, EKS, DynamoDB, Glue, GuardDuty, IAM,
Inspector, KMS, Lambda, RDS, Redshift, Route53, S3, SageMaker, Secrets Manager,
Security Hub, SNS, SQS, SSM, STS
([github.com/cartography-cncf/cartography](https://github.com/cartography-cncf/cartography)).

**Key insight for Componode**: cartography proves that a **provider-prefixed
label scheme works at scale** and that a single graph can hold cloud, k8s,
repo, and identity assets simultaneously. This validates the
`category + provider` discriminator design.

**Environment**: cartography does not model environment as a first-class
concept; it relies on account/project/subscription boundaries and tags.

### 3.4 Steampipe

Steampipe maps cloud APIs to Postgres tables, one table per resource type,
grouped by plugin
([hub.steampipe.io/plugins/turbot/aws](https://hub.steampipe.io/plugins/turbot/aws);
[azure](https://hub.steampipe.io/plugins/turbot/azure);
[kubernetes](https://hub.steampipe.io/plugins/turbot/kubernetes);
[github](https://hub.steampipe.io/plugins/turbot/github)). The AWS plugin
alone exposes hundreds of tables (`aws_ec2_instance`, `aws_s3_bucket`,
`aws_rds_db_instance`, …). The naming convention `aws_<service>_<resource>`
is a flat-table reflection of the same `{provider}:{resource-type}` two-level
scheme. Steampipe is a useful **extraction layer** reference for Componode
importers but does not define its own taxonomy — it mirrors each provider's.

---

## 4. Service / API Catalogs and API Management (+ MCP)

### 4.1 Apigee

Apigee's asset model centers on the **API proxy** (the deployable artifact) and
the **API product** (a bundle of proxies + resources + quota, published to
developers)
([organizations.apiproducts REST](https://docs.cloud.google.com/apigee/docs/reference/apis/apigee/rest/v1/organizations.apiproducts)).
An API product has `proxies[]`, `apiResources[]`, `environments[]`, `scopes[]`,
and operation groups (`operationGroup`, `graphqlOperationGroup`,
`grpcOperationGroup`, `llmOperationGroup`).

**Environment**: Apigee models environment as a **first-class deployment
target**. "An Apigee environment is a software environment, within an
organization, for creating and deploying API proxies. You must deploy an API
proxy to an environment before it can be accessed"
([environments-overview](https://cloud.google.com/apigee/docs/api-platform/fundamentals/environments-overview)).
A proxy is deployed to one or more named environments (e.g. `test`, `prod`);
an API product's `environments[]` restricts which deployments it exposes. This
is the **logical-asset-deployed-to-environment-instances** pattern — the API
proxy is the logical asset, each (proxy, environment) deployment is an
instance.

### 4.2 Kong Gateway / Konnect

Kong's object model: **Service** (upstream), **Route** (how requests reach the
Service), **Consumer** (client identity), **Plugin** (policy attached to a
Service/Route/Consumer)
([developer.konghq.com — get-started](https://developer.konghq.com/gateway/get-started/)).
The Konnect CRD equivalents are `KongService`, `KongRoute`, `KongPlugin`,
`KongPluginBinding`
([operator/konnect/crd/gateway/plugin](https://developer.konghq.com/operator/konnect/crd/gateway/plugin/)).
The Kong Konnect MCP server exposes `GetService`, `GetRoute`, `GetConsumer`,
`GetPlugin` tools
([konnect-mcp/tools](https://developer.konghq.com/konnect-platform/konnect-mcp/tools/)).

**Polymorphism**: typed entities (Service/Route/Consumer/Plugin) — not a
single polymorphic "API" node. An "API" in Kong is the Service+Route pair.

**Environment**: Kong uses Control Planes as the scoping/deployment unit; a
Service is configured within a control plane. Environment is again a
deployment-context concept, not a field on the Service.

### 4.3 AWS API Gateway (via cartography)

cartography models API Gateway as distinct node labels:
`AWSAPIGatewayRestAPI`, `AWSAPIGatewayResource`, `AWSAPIGatewayMethod`,
`AWSAPIGatewayStage`, `AWSAPIGatewayDeployment`, `AWSAPIGatewayV2API`
([AWS schema](https://docs.cartography.dev/modules/aws/schema.html)). Note the
**Stage** node — that is API Gateway's environment-equivalent (a named
deployment stage like `prod`/`dev`), modeled as a separate node linked to the
Rest API. This reinforces the **environment-as-separate-instance** pattern.

### 4.4 MCP (Model Context Protocol) — a new asset class

The MCP specification
([spec.modelcontextprotocol.io](https://spec.modelcontextprotocol.io/specification/);
[version 2025-03-26](https://spec.modelcontextprotocol.io/specification/2025-03-26/))
defines a server by **three capability primitives**
([server-concepts](https://modelcontextprotocol.io/docs/learn/server-concepts);
[source: index.mdx](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/draft/server/index.mdx)):

| Primitive | Control | Description |
|---|---|---|
| **Tools** | Model-controlled | Executable functions the LLM can call (API POST, file write) |
| **Resources** | Application-controlled | Read-only contextual data (file contents, git history) |
| **Prompts** | User-controlled | Pre-built instruction templates |

A server identifies itself via `_meta['io.modelcontextprotocol/serverInfo']`
with `name` and `version`, and declares `capabilities: { tools, resources,
prompts }` in the `server/discover` response
([specification/draft/server/discover](https://modelcontextprotocol.io/specification/draft/server/discover)).

**Implication for Componode**: An MCP server is a **distinct asset class** — it is
not a generic HTTP API (it speaks JSON-RPC 2.0, not REST), and its
"interface" is the set of tools/resources/prompts it exposes, not an OpenAPI
spec. Port's protected `_mcp_server` blueprint
([§2.4](#24-port)) is independent confirmation that the industry is already
treating MCP servers as a catalogable asset. **Componode should add an `MCP_SERVER`
component category.**

---

## 5. Application / Endpoint Discovery & CMDB-style Models

### 5.1 OpsLevel / Cortex — environments and endpoints

As noted in §2.3–§2.5, neither OpsLevel nor Cortex models "environment" as a
core field on the service entity. Both instead rely on **integrations**
(Kubernetes namespaces, deployment tools) to surface per-environment
endpoints. Cortex's `x-cortex-link` entries (with `type: RUNBOOK`, etc.) and
OpsLevel's integration-backed "service health" are the closest analogues.
**[Primary docs for per-environment endpoint modeling in OpsLevel/Cortex were
not directly retrieved; this characterization is based on the service-object
schemas cited in §2.3–§2.5.]**

### 5.2 ServiceNow CMDB — CI class hierarchy

ServiceNow CMDB uses a **single base table `cmdb_ci`** with a **deep typed
subclass hierarchy via table extension**
([CMDB tables descriptions](https://www.servicenow.com/docs/r/servicenow-platform/configuration-management-database-cmdb/cmdb-tables-details.html)):

> "cmdb_ci — Base configuration item (CI) table."

Child tables extend `cmdb_ci` (and further extend each other), e.g.
`cmdb_ci_server`, `cmdb_ci_db_instance`, `cmdb_ci_network gear`,
`cmdb_ci_appl` (application), `cmdb_ci_business_app` (business application),
`cmdb_ci_service` (service). The hierarchy is enumerable via
`sys_db_object.super_class` and is browsable in the CI Class Manager
([community: OOB CI Class Hierarchy](https://www.servicenow.com/community/common-service-data-model-forum/can-someone-post-the-oob-ci-class-hierarchy/m-p/3047288)
— community-sourced but the script queries the official `sys_db_object`
table; **the canonical hierarchy is in-product, not a single public page**).

**Application → infrastructure relationship**: The **Service Configuration
Item Association table `svc_ci_assoc`** "binds an application service and a CI
to track which CIs are part of each application service"
([CMDB tables descriptions](https://www.servicenow.com/docs/r/servicenow-platform/configuration-management-database-cmdb/cmdb-tables-details.html)).
This is ServiceNow's analogue of Componode's `DEPENDS_ON` (product → component).

**Polymorphism**: **typed subclasses via table extension** (the deepest
hierarchy pattern in the survey). This is powerful but heavy; it is the
opposite end of the spectrum from Backstage's free-form `spec.type`.

### 5.3 ServiceNow CSDM / APM — Business Application and the instance/deployment split

This is the single most important primary source for **how to model
environment**. ServiceNow's Common Service Data Model defines a **Business
Application** as:

> "A business application represents all software and infrastructure …
> configured to provide business functionality. … They can span multiple
> environments and / or deployed per geography (For example dev, test, prod,
> or Americas, APJ, EMEA)."
> — [community: What is a Business Application?](https://www.servicenow.com/community/enterprise-architure-articles/what-is-a-business-application/ta-p/3071106)
> (quoting the CSDM Whitepaper)

And critically:

> "A Business Application record is the abstract, Design level, parent of each
> and every deployment or instance of the application. These deployments can
> vary widely in environment, locations, versions …"

The `cmdb_ci_business_app` table was introduced specifically for APM and is
distinct from the older `cmdb_ci_appl`
([community: Business Applications vs cmdb_ci_appl](https://www.servicenow.com/community/enterprise-architecture-forum/how-are-business-applications-cmdb-ci-business-app-related-to/td-p/1040406)).
APM sits on CSDM, which "acts as the foundational data model that helps APM
map, categorize, and analyze applications"
([community: CSDM's relationship with APM](https://www.servicenow.com/community/in-other-news/what-is-csdm-s-relationship-with-apm-dpm-and-spm-and-how-they/ba-p/3050464)).

**This is the canonical industry statement of the
"logical asset vs per-environment instance" split** — and it is exactly the
pattern Componode should adopt (see §11).

---

## 6. Repository / Source-Control as an Asset

### 6.1 Backstage — repo is NOT a first-class kind

Backstage deliberately does **not** have a `Repository` kind. A repo is the
**source location** of a Component, recorded in `metadata.annotations` (e.g.
`github.com/project-slug: backstage/backstage`) and as the `Location` that
feeds the catalog — not an entity in its own right
([descriptor-format](https://backstage.io/docs/features/software-catalog/descriptor-format)).
The `Component` is the deployable thing; the repo is where its
`catalog-info.yaml` lives. This encodes the **repo ≠ service** distinction:
a single service may span multiple repos (monorepo paths or multi-repo), and a
single repo may contain multiple services.

### 6.2 cartography — repo IS a first-class node

cartography takes the opposite stance: GitHub repos, branches, users, teams,
and dependency-graph manifests/dependencies are **first-class graph nodes**
([github.com/cartography-cncf/cartography](https://github.com/cartography-cncf/cartography):
"GitHub — repos, branches, users, teams, dependency graph manifests,
dependencies"). This lets cartography answer "which services depend on code
from which repos" as a graph traversal.

### 6.3 Implication for Componode

The two tools disagree, and the disagreement is principled: **IDPs model the
service (logical); asset-inventory tools model the repo (physical).** Componode
needs **both**: a `REPOSITORY` component category (the VCS artifact, imported
from GitHub/GitLab/Bitbucket/Azure DevOps) **and** the ability to link a
`Component` of category `SERVICE`/`LIBRARY` to one or more repositories
(many-to-many), because a service can span repos and a repo can hold many
services. The `REPOSITORY` component type is correct; what matters is that it
is **not** treated as interchangeable with `SERVICE`.

---

## 7. Container / Orchestration

### 7.1 Kubernetes API resource taxonomy

Kubernetes' resource taxonomy is the canonical primary source for
container/orchestration assets. Resources are identified by
**(apiGroup, resourceType, kind)**, with a `namespaced` boolean
([Kubernetes API Concepts](https://kubernetes.io/docs/reference/using-api/api-concepts/)):
"A resource type is the name used in the URL (`pods`, `namespaces`,
`services`); … a kind is the concrete representation (object schema)."

The **`APIResource` meta-type** carries `name`, `singularName`, `kind`,
`group`, `version`, `namespaced`, `categories`, `shortNames`
([APIResource v1 meta](https://kubernetes.io/docs/reference/kubernetes-api/definitions/api-resource-v1-meta/)).
`kubectl api-resources` enumerates them
([kubectl api-resources](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_api-resources/)).

**Core (groupless) resources** ([Core API](https://kubernetes.io/docs/reference/kubernetes-api/core/)):
`Pod`, `Service`, `ConfigMap`, `Secret`, `Namespace`, `Node`, `PersistentVolume`,
`PersistentVolumeClaim`, `ServiceAccount`, `Endpoints`, `Event`.

**Grouped resources** by API group
([API Groups](https://kubernetes.io/docs/reference/kubernetes-api/group-versions/)):
- `apps` — `Deployment`, `ReplicaSet`, `StatefulSet`, `DaemonSet`
- `batch` — `Job`, `CronJob`
- `networking.k8s.io` — `Ingress`, `NetworkPolicy`
- `rbac.authorization.k8s.io` — `Role`, `ClusterRole`, `RoleBinding`, `ClusterRoleBinding`
- `autoscaling` — `HorizontalPodAutoscaler`
- `policy` — `PodDisruptionBudget`
- `storage.k8s.io` — `StorageClass`, `VolumeAttachment`

**`categories`** is a first-class grouping axis — the `all` category includes
pods, services, deployments, replicasets, etc. (the `kubectl get all` set).

**Polymorphism**: `(apiGroup, resourceType/kind)` two-level namespace +
`namespaced` scope discriminator + `categories` tags. This is structurally
identical to the AWS/Azure two-level scheme.

### 7.2 OpenShift Projects

An OpenShift **Project** is "an alternative representation of a Kubernetes
namespace" with added multi-tenancy annotations (quotas, membership, RBAC)
([Project APIs — OCP 4.21](https://docs.redhat.com/en/documentation/openshift_container_platform/4.21/observability/project_apis/project-apis);
[OKD Project APIs](https://docs.okd.io/latest/rest_api/project_apis/project_apis-index.html)).
"Creating a Project also creates a Kubernetes namespace under the covers with
the same name"
([Red Hat Developer: OpenShift with Kubernetes](https://developers.redhat.com/articles/2023/01/11/developers-guide-using-openshift-kubernetes)).
**For Componode, an OpenShift Project should be modeled as a
`CONTAINER_ORCHESTRATION`-category component with provider `OPENSHIFT`, not as
a separate top-level category.**

### 7.3 Docker / Podman containers, images, registries

cartography models ECR (registries + multi-arch images + layers + attestations)
as first-class nodes
([github.com/cartography-cncf/cartography](https://github.com/cartography-cncf/cartography):
"ECR (including multi-arch images, image layers, and attestations)"). At the
Componode level, the relevant trackable assets are: **container image** (the
addressable artifact in a registry), **registry/repository** (the collection),
and **running container/pod** (an instance). A container image is best modeled
as a component of category `CONTAINER` (or a more specific `IMAGE`) with
provider `DOCKER`/`PODMAN`/`ECR`/`GHCR` etc.; a running container is an
**instance** of that image in an environment, consistent with §11.

---

## 8. Composable / Product-Hierarchy Models

### 8.1 SAP LeanIX

LeanIX's meta-model has **12 fact-sheet types**, of which the core three are
**Business Capability, Application, IT Component**
([learning.sap.com — LeanIX fact sheet types](https://learning.sap.com/learning-journeys/learning-to-use-leanix-tool-for-successful-enterprise-architecture/leanix-fact-sheet-types_b9cc5895-090e-466d-adbc-114e2c5947cb)).
The Application is "the center of the SAP LeanIX Meta Model" and "relies on IT
Components to function"
([intro-to-applications](https://learning.sap.com/courses/adding-first-data-to-your-sap-leanix-workspace/intro-to-applications)).
Relations are typed and classified as **hierarchical, generic, or transitive**
([introduction-to-relations](https://learning.sap.com/courses/adding-first-data-to-your-sap-leanix-workspace/introduction-to-relations)).

**This maps cleanly onto Componode's Composable Product Model**: LeanIX
`Application` ≈ Componode `DigitalProduct`; LeanIX `IT Component` ≈ Componode
`Component`; LeanIX `Business Capability` ≈ Componode `BusinessCapability`
(present via the `SUPPORTS` relationship). LeanIX's hierarchical relations
(Business Capability → sub-capability, Application → sub-application) are the
prior art for Componode's `COMPOSES` (product → product) hierarchy.

### 8.2 Ardoq

Ardoq is graph-based with **component types** defined per **metamodel** (one
metamodel per workspace)
([help.ardoq.com — What Are Metamodels?](https://help.ardoq.com/en/articles/44159-what-are-metamodels)).
Component types are customizable; out-of-box templates include "Application
Portfolio" with types `Application`, `Application Group`, `Application Module`,
`Interface`
([manage component types and metamodel](https://help.ardoq.com/en/articles/44068-manage-component-types-and-metamodel)).

**Hierarchy modeling**: Ardoq distinguishes **parent-child (decomposition,
stored directly on the child)** from **references (typed relationships with
their own properties)**
([hierarchies or references](https://help.ardoq.com/en/articles/44032-should-you-model-using-hierarchies-or-references);
[what are references](https://help.ardoq.com/en/articles/44157-what-are-references)).
The guidance is explicit: do **not** put two types with a many:many functional
dependency in the same hierarchy — use references instead. **This directly
validates Componode's separation of `COMPOSES` (hierarchy) from `DEPENDS_ON`
(reference) and warns against over-using `COMPOSES` for things that are really
dependencies.**

Metamodels can be **rigid** (strict hierarchy) or **flexible** (any type can
be a child of any other)
([flexible workspace metamodels](https://help.ardoq.com/en/articles/44184-flexible-workspace-metamodels)).
Componode's Composable Model is closer to "rigid" (LOB → Business Capability
Product → Platform Product).

### 8.3 ServiceNow APM / CSDM (recap)

As in §5.3, ServiceNow APM manages a portfolio of **Business Applications**
aligned to **Business Capabilities** via CSDM
([APM product page](https://www.servicenow.com/products/application-portfolio-management.html);
[CSDM↔APM relationship](https://www.servicenow.com/community/in-other-news/what-is-csdm-s-relationship-with-apm-dpm-and-spm-and-how-they/ba-p/3050464)).
The Business Application is the design-level parent of per-environment
deployments — the same two-tier (logical product → physical instances) model
Componode uses.

### 8.4 Other (Plutora, Planview, ValueBlue)

**Primary-source documentation for Plutora, Planview, and ValueBlue's entity
type taxonomies was not retrieved** (these are closed-source products whose
data-model docs are behind login/gated portals). Their public marketing
confirms they occupy the same "application portfolio / value-stream
management" space as ServiceNow APM and LeanIX, but no citable enum of entity
types could be obtained. **This is an explicit gap — do not assume their
models match LeanIX/ServiceNow without verification.**

---

## 9. Cross-Cutting Analysis

### 9.1 How tools handle polymorphism — three patterns

| Pattern | Examples | Pros | Cons |
|---|---|---|---|
| **A. Controlled top-level enum + free sub-type** | Backstage (`kind`+`spec.type`), Harness IDP | Lightweight, extensible, graph-friendly | Drift/typo risk; needs validation layer |
| **B. Typed subclasses / table extension** | ServiceNow CMDB (`cmdb_ci`→children), LeanIX fact-sheet types | Strong typing, per-type fields | Heavy schema; adding types = migration |
| **C. Fully user-defined blueprints + JSON schema** | Port, Cortex, Ardoq | Maximal flexibility | No cross-org consistency; hard to build generic tooling |
| **D. Provider-prefixed labels / two-level namespace** | cartography (`AWSEC2Instance`), AWS Resource Explorer (`ec2:instance`), Azure (`Microsoft.Compute/virtualMachines`) | Scales across providers; native to cloud APIs | Proliferates labels; needs a registry |
| **E. Type + provider/driver discriminator** | Humanitec (`type=postgres` + `driver_type=humanitec/postgres-cloudsql-static`) | Clean separation of logical vs implementation | Requires driver registry |

**Componode's `Component.category` (enum) + `Component.provider` (enum) is
closest to pattern E** (type + provider discriminator), with elements of A.
The recommendation in §11 is to keep that two-level structure and **add a
free-form `resourceType` string** to carry the provider-native type (pattern D
interoperability), giving the best of A + D + E.

### 9.2 How tools model environment — three patterns

| Pattern | Examples | Description |
|---|---|---|
| **i. Not modeled** | Backstage, cartography, AWS/Azure (at resource level) | Environment is a convention (accounts/subscriptions/tags/namespaces); no field |
| **ii. Field on the entity** | OpsLevel (`lifecycle_alias`), Backstage (`spec.lifecycle` — but this is maturity, not env) | A single enum value on the logical asset |
| **iii. Separate instance/deployment entity** | ServiceNow CSDM (Business App → deployments), Humanitec (Resource → per-env instances), Apigee (proxy → env deployments), AWS API Gateway (RestAPI → Stage) | Logical asset is environment-agnostic; each (asset, environment) is its own record |

**Pattern (iii) is the consensus among tools that take environment seriously**
(ServiceNow CSDM, Humanitec, Apigee). Pattern (ii) conflates environment with
lifecycle and breaks down when an asset exists in dev AND test AND prod
simultaneously (which is the normal case for any real product). **Componode
should use pattern (iii).**

### 9.3 Notable disagreements between tools

1. **Repo as first-class entity?** Backstage says no (repo = location);
   cartography says yes (repo = node). Componode needs both (§6.3).
2. **Is "service" a type or the only entity?** Backstage/Harness treat Service
   as one `spec.type` of Component; OpsLevel makes Service the singular entity
   and expresses type-ness via tier/language/framework. Componode should keep
   Service as one category among many (Backstage's approach), because Componode
   also tracks non-service components (databases, queues, etc.).
3. **Environment on the asset vs on an instance.** IDPs (Backstage) ignore it;
   CMDB/APM tools (ServiceNow) and platform orchestrators (Humanitec) model it
   as a separate instance. Componode should follow the latter.
4. **Fixed enum vs open taxonomy.** Backstage deliberately leaves `spec.type`
   open; ServiceNow ships a huge fixed hierarchy; Port/Cortex let users define
   everything. Componode needs a **controlled-but-extensible** enum (validated
   core set + escape hatch), because it is an open-source tool that must work
   out-of-the-box yet allow adopters to add providers/categories.

---

## 10. Comparison Table — Surveyed Tools' Taxonomies

| Tool | Top-level discriminator | Sub-type mechanism | Provider discriminator? | Environment model | Primary source |
|---|---|---|---|---|---|
| **Backstage** | `kind` (Component/API/Resource/System/Domain/…) | `spec.type` free string (well-known: service/website/library; API: openapi/asyncapi/graphql/grpc/trpc; Resource: database/s3-bucket/kubernetes-cluster) | No (in annotations) | Not modeled (only `lifecycle`: experimental/production/deprecated) | [descriptor-format](https://backstage.io/docs/features/software-catalog/descriptor-format) |
| **Harness IDP** | Same kinds as Backstage | Same `spec.type` | No (annotations) | Not modeled in catalog | [catalog/overview](https://developer.harness.io/docs/internal-developer-portal/catalog/overview/) |
| **OpsLevel** | Single `Service` entity | `tier` + `lifecycle` + `language` + `framework` + Custom Properties + tags | No (integrations) | `lifecycle_alias` field (configurable) | [opslevel_service](https://registry.terraform.io/providers/OpsLevel/opslevel/latest/docs/data-sources/service) |
| **Port** | User-defined `blueprint` | JSON-schema per blueprint | No | Not in core blueprint | [default-blueprints](https://docs.port.io/context-lake/data-model/setup-blueprint/default-blueprints/) |
| **Cortex** | Built-in service/domain/team + custom types | `x-cortex-type` + JSON schema + `groups` (free tags) | No | Not modeled | [entity-types](https://docs.cortex.io/ingesting-data-into-cortex/entities/adding-entities/entity-types) |
| **Humanitec** | `Resource` (typed by `type`) | `type` + `driver_type` (implementation) | Yes (`driver_type`) | **Environment = deployment context; per-env Resource instances** | [resources/overview](https://developer.humanitec.com/app-humanitec-io/docs/platform-orchestrator/resources/overview/) |
| **AWS Resource Explorer** | `{service}:{resource-type}` | resource-type string | Yes (service prefix) | Not modeled (account/region/tags) | [supported-resource-types](https://docs.aws.amazon.com/resource-explorer/latest/userguide/supported-resource-types.html) |
| **Azure Resource Graph** | `{provider}/{resource-type}` | resource-type string | Yes (provider namespace) | Not modeled (sub/RG/MG) | [resource-providers-and-types](https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/resource-providers-and-types) |
| **cartography** | Provider-prefixed labels (`AWSEC2Instance`) | One label per resource type | Yes (label prefix) | Not modeled | [AWS schema](https://docs.cartography.dev/modules/aws/schema.html) |
| **Steampipe** | Plugin → table (`aws_ec2_instance`) | One table per resource type | Yes (plugin/table prefix) | Not modeled | [hub.steampipe.io](https://hub.steampipe.io/plugins/turbot/aws) |
| **Kubernetes API** | `(apiGroup, resourceType, kind)` | `kind` + `categories` | apiGroup as namespace | `Namespace` resource (scope, not env) | [API Concepts](https://kubernetes.io/docs/reference/using-api/api-concepts/) |
| **Apigee** | API proxy / API product | operation groups (REST/GraphQL/gRPC/LLM) | No | **Environment = first-class deployment target** | [environments-overview](https://cloud.google.com/apigee/docs/api-platform/fundamentals/environments-overview) |
| **Kong** | Service / Route / Consumer / Plugin | typed entities | Control Plane as scope | Control Plane scope | [get-started](https://developer.konghq.com/gateway/get-started/) |
| **MCP** | Server (JSON-RPC) | capabilities: tools/resources/prompts | n/a | n/a | [spec](https://spec.modelcontextprotocol.io/specification/) |
| **ServiceNow CMDB** | `cmdb_ci` base table | **typed subclasses (table extension)** | No | **Business App (design) → instance/deployment records per env** | [cmdb-tables](https://www.servicenow.com/docs/r/servicenow-platform/configuration-management-database-cmdb/cmdb-tables-details.html) |
| **ServiceNow APM/CSDM** | Business Application | CSDM class hierarchy | No | **Design parent → per-env deployments** | [CSDM↔APM](https://www.servicenow.com/community/in-other-news/what-is-csdm-s-relationship-with-apm-dpm-and-spm-and-how-they/ba-p/3050464) |
| **LeanIX** | Fact-sheet type (12 types) | typed fact sheets + relations | No | Not in core fact sheet | [fact-sheet-types](https://learning.sap.com/learning-journeys/learning-to-use-leanix-tool-for-successful-enterprise-architecture/leanix-fact-sheet-types_b9cc5895-090e-466d-adbc-114e2c5947cb) |
| **Ardoq** | Component type (per metamodel) | customizable types + references | No | Not in core | [metamodels](https://help.ardoq.com/en/articles/44159-what-are-metamodels) |

---

## 11. Categories the Original List Missed

The original import-source list (repo tools, cloud environments, on-prem/hybrid
k8s/docker, web/API/MCP URLs) maps to component categories `REPOSITORY`, cloud
infra (`COMPUTE`/`STORAGE`/`NETWORK`/…), `CONTAINER`, `API`, `MCP_SERVER`, and
`WEB_ENDPOINT`. The research surfaces **commonly tracked categories that are
not explicit in that list**:

| Missed category | Evidence | Recommended Componode category |
|---|---|---|
| **Databases** (as first-class, not "compute") | Backstage Resource examples (`database`); Humanitec `postgres`/`postgres-instance` resource types; Harness IDP lists "Databases" as a Resource example; cartography `AWSRDSInstance`, `AWSDynamoDBTable` | `DATABASE` (keep, but ensure it is importable standalone, not only as a compute subtype) |
| **Message queues / event buses / topics** | Harness IDP ("message queues"); cartography `AWSSQSQueue`, `AWSSNSTopic`; Backstage Resource ("Pub/Sub topics") | `QUEUE` — ensure SNS/SQS/Kafka/EventBridge/NATS importers |
| **Identity / SSO providers** | cartography `Okta`, `Keycloak`, `AWSPrincipal`/`AWSUser`; Steampipe okta plugin | **`IDENTITY` (NEW)** |
| **Secrets managers / KMS** | cartography `AWSKMSAlias`, "Secrets Manager (Secret Versions)"; Backstage Resource; Humanitec secret resource types | `SECRET` + `KMS_KEY` (consider) |
| **Observability backends** (Datadog/PagerDuty/Sentry services) | cartography `PagerDuty`, `Sentry`; Cortex `x-cortex-oncall` PagerDuty integration | **`OBSERVABILITY` / `MONITORING` (NEW)** |
| **Package / artifact registries** | cartography ECR images; Steampipe github/gitlab registry tables | **`PACKAGE_REGISTRY` / `ARTIFACT` (NEW)** |
| **Documentation sites** | Backstage TechDocs; Cortex RUNBOOK links | **`DOCUMENTATION` (NEW, optional)** |
| **IaC / Terraform state backends** | cartography `CloudFormationStack`; Humanitec Terraform driver | **`IAC` / `STACK` (NEW, optional)** |
| **CDN / DNS / Certificates** | Backstage Resource ("CDNs"); cartography `AWSCloudFrontDistribution`, `AWSDNSZone` | `CDN`/`DNS`/`CERTIFICATE` (keep) |
| **Serverless functions** | cartography `AWSLambda`; Backstage (often modeled as Component type `function`) | `SERVERLESS` (keep) |

**The two highest-priority additions are `IDENTITY` and `OBSERVABILITY`** —
both are first-class in cartography and CSPM contexts because they are central
to blast-radius and security analysis, which is core to Componode's value
proposition.

---

## 12. Proposed Taxonomy for Componode

### 12.1 Recommended discriminator structure: two-level (category + provider) + free `resourceType`

**Recommendation: keep the two-level `Component.category` (category) +
`Component.provider` discriminator, and add a free-form `Component.resourceType`
string carrying the provider-native type.** This is grounded in what the
surveyed tools actually do:

- It matches **AWS Resource Explorer** (`{service}:{resource-type}`) and
  **Azure Resource Graph** (`{provider}/{resource-type}`) — the two largest
  cloud asset inventories both use a two-level (namespace, type) key.
- It matches **cartography**'s provider-prefixed label scheme, which is the
  closest open-source precedent to Componode.
- It matches **Humanitec**'s `type` + `driver_type` (logical type + provider
  discriminator) pattern.
- It improves on **Backstage**'s single free `spec.type` by keeping a
  controlled category enum (so Componode can ship generic UI/query logic per
  category) while still allowing the provider-native type to be preserved
  (so no information is lost on import).

**Alternatives considered and rejected:**

- *Single flat enum (category only, no provider):* Rejected — cannot
  disambiguate an `ec2:instance` from an `azure:virtualMachine` from a
  `k8s:Pod`, all of which are "compute." Cloud inventories universally need
  the provider axis.
- *Typed subclasses / table extension (ServiceNow CMDB style):* Rejected for
  Componode's model — proliferates types and makes generic queries hard. A
  controlled category enum + provider + free `resourceType` is more queryable.
- *Fully user-defined blueprints (Port/Cortex style):* Rejected as the
  *default* — Componode is an open-source tool that must work out-of-the-box
  with a sensible built-in taxonomy. Blueprint-style extensibility can be a
  future feature layered on top (custom properties / labels), not the
  foundation.

### 12.2 Proposed `Component.category` enum (controlled, extensible)

The recommended **core category set** (24 categories, all in v1):

```
COMPUTE          — VMs, EC2, Azure VM, containers-as-compute
SERVERLESS       — Lambda, Azure Functions, Cloud Functions, step functions
CONTAINER        — Kubernetes workloads (Deployment/StatefulSet/DaemonSet/Pod),
                   OpenShift DeploymentConfigs; the orchestrator-scoped workload
CONTAINER_ORCHESTRATION — K8s Cluster, EKS/AKS/GKE/OCP cluster, Namespace/Project
DATABASE         — RDS, DynamoDB, Cosmos DB, Postgres, MongoDB, Redis (data stores)
STORAGE          — S3 buckets, Azure Blob, EBS volumes, object/file/block storage
NETWORK          — VPC, subnets, load balancers, security groups, NSGs, routes
QUEUE            — SQS, SNS, Kafka, EventBridge, NATS, RabbitMQ (messaging/eventing)
CDN              — CloudFront, Azure CDN, Cloudflare distributions
DNS              — Route53 zones/records, Azure DNS, Cloudflare DNS
CERTIFICATE      — ACM certs, Azure Key Vault certs, TLS certs
SECRET           — Secrets Manager, Key Vault secrets, Kubernetes Secrets
KMS_KEY          — KMS keys, encryption keys (separate from SECRET per cartography)
IDENTITY         — IdPs/SSO: Okta, Keycloak, Entra ID, Cognito, IAM principals
OBSERVABILITY    — Datadog/PagerDuty/Sentry/NewRelic services, monitors, alerts
API              — REST/GraphQL/gRPC APIs (Apigee/Kong/API Gateway managed or raw)
MCP_SERVER       — Model Context Protocol servers (tools/resources/prompts)
WEB_ENDPOINT     — web URLs, health endpoints, status pages (env-scoped)
REPOSITORY       — VCS repos (GitHub/GitLab/Bitbucket/Azure DevOps)
PACKAGE_REGISTRY — artifact/package registries (ECR/GHCR/npm/PyPI/NuGet)
DOCUMENTATION    — TechDocs / docs sites / runbooks
IAC              — CloudFormation/Terraform/Pulumi stacks
JOB              — scheduled/batch jobs (K8s CronJob, Airflow DAG, AWS EventBridge Scheduler)
LIBRARY          — software libraries (npm/PyPI/Maven artifacts consumed as deps)
```

**Rationale for the `CONTAINER` / `CONTAINER_ORCHESTRATION` split**: the
Kubernetes API itself distinguishes the workload (Pod/Deployment, namespaced,
in `apps`/`batch`) from the cluster/namespace scope (Node, Namespace,
cluster-scoped). Conflating them loses the "which workloads run in which
cluster/namespace" relationship that Componode needs for blast-radius.

**`LIBRARY` and `JOB`** are added to align with Backstage's well-known
`spec.type` values (service/website/library) and the common community
extension (`job`), so that a `SERVICE`-category Component imported from
Backstage can be mapped without loss.

### 12.3 Proposed `Component.provider` enum (controlled, extensible)

> **Ratification note (2026-10-21)**: `ALIBABA_CLOUD` was ratified and shipped
> under [ADR-115](./adrs/ADR-115-alibaba-cloud-importer.md) / spec
> `024-alibaba-cloud-importer` — it is now a live value in
> `COMPONENT_PROVIDERS`, not just a proposal.

```
AWS, AZURE, GCP, ALIBABA_CLOUD, CLOUDFLARE,
OPENSHIFT, KUBERNETES, DOCKER, PODMAN,
GITHUB, GITLAB, BITBUCKET, AZURE_DEVOPS,
APIGEE, KONG, AWS_API_GATEWAY, GRAVITEE, BOOMI, MULESOFT,
MCP,                      // for MCP_SERVER components
OKTA, KEYCLOAK, ENTRA_ID, // for IDENTITY
DATADOG, PAGERDUTY, SENTRY, NEWRELIC, // for OBSERVABILITY
NPM, PYPI, MAVEN, NUGET, ECR, GHCR,   // for PACKAGE_REGISTRY
ON_PREM, OTHER
```

Keep `OTHER` as the escape hatch so adopters can register a provider not yet
in the enum without a code change (controlled-but-extensible, per §9.3.4).

### 12.4 New field: `Component.resourceType` (free string)

Carry the provider-native type verbatim, so no information is lost and
provider-specific logic can key off it:

- AWS: `ec2:instance`, `s3:bucket`, `rds:db-instance`, `lambda:function`
  (AWS Resource Explorer format
  — [supported-resource-types](https://docs.aws.amazon.com/resource-explorer/latest/userguide/supported-resource-types.html))
- Azure: `Microsoft.Compute/virtualMachines`, `Microsoft.Storage/storageAccounts`
  (Azure Resource Graph format
  — [resource-providers-and-types](https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/resource-providers-and-types))
- Kubernetes: `apps/v1/Deployment`, `v1/Pod`, `networking.k8s.io/v1/Ingress`
  (apiGroup/version/Kind
  — [API Concepts](https://kubernetes.io/docs/reference/using-api/api-concepts/))
- Backstage-imported service: `backstage:component:service` (kind:spec.type)
- MCP server: `mcp:server` (or the declared `serverInfo.name`)

### 12.5 Recommended environment model: separate `ComponentInstance` entity

**Recommendation: do NOT add an `environment` field to `Component`. Introduce a
separate `ComponentInstance` (deployment) entity**, linked to its `Component`
by a `HAS_INSTANCE` relationship.

```
Component {category, provider, resourceType, ...}     // logical asset, env-agnostic
    -[:HAS_INSTANCE]-> ComponentInstance {
        environment: enum[DEV, TEST, STAGING, DEMO, PRODUCTION, OTHER],
        url: string,            // the env-specific URL for WEB_ENDPOINT/API/MCP_SERVER
        region: string,
        status: enum[RUNNING, STOPPED, ERROR, ...],
        version: string,
        deployedAt: datetime,
        rawConfig: json
    }
```

**Grounding:**
- **ServiceNow CSDM**: "A Business Application record is the abstract, Design
  level, parent of each and every deployment or instance of the application …
  vary widely in environment, locations, versions"
  ([What is a Business Application?](https://www.servicenow.com/community/enterprise-architure-articles/what-is-a-business-application/ta-p/3071106)).
- **Humanitec**: per-deployment Resource instances matched by Environment type
  ([resource-management-theory](https://developer.humanitec.com/app-humanitec-io/guides/getting-started/master-your-internal-developer-platform/resource-management-theory/)).
- **Apigee**: API proxy (logical) deployed to named environments
  ([environments-overview](https://cloud.google.com/apigee/docs/api-platform/fundamentals/environments-overview)).
- **AWS API Gateway via cartography**: `AWSAPIGatewayStage` as a separate node
  linked to `AWSAPIGatewayRestAPI`
  ([AWS schema](https://docs.cartography.dev/modules/aws/schema.html)).

**Why not a field on Component:** a single product/component almost always
exists in multiple environments simultaneously (dev + staging + prod). A
single `environment` field forces either (a) duplicating the Component per
env (loses the "one logical asset" identity needed for blast-radius) or (b)
storing a list (unqueryable, loses per-env URL/status/version). The
instance-entity pattern keeps identity stable and lets each env carry its own
URL/status/version — which is exactly what the "Web/API/MCP URLs across
dev/test/staging/demo/production" requirement needs.

**Relationship to Componode lifecycle rules:** keep the
`Component.lifecycle` (`ACTIVE`/`RETIRED`) on the **logical** Component
(is this still in scope), and `ComponentInstance.status` (`RUNNING`/`STOPPED`/`ERROR`)
on the **instance** (is this currently running). This matches the
"lifecycle vs operational state" rule and extends it cleanly to the
environment dimension.

### 12.6 Putting it together — minimal schema

1. **`Component.category`** — enum from §12.2 (24 categories).
2. **`Component.provider`** — enum from §12.3.
3. **`Component.resourceType: string`** — free-form, provider-native.
4. **`Component.lifecycle: 'ACTIVE' | 'RETIRED'`** — logical lifecycle (in scope / not).
5. **`ComponentInstance`** entity (§12.5) with `environment` enum
   `DEV, TEST, STAGING, DEMO, PRODUCTION, OTHER`, plus env-specific `url`,
   `region`, `status`, `version`, `deployedAt`.
6. **`(:DigitalProduct)-[:DEPENDS_ON]->(:Component)`** (logical, env-agnostic).
7. **`(:Component)-[:HAS_INSTANCE]->(:ComponentInstance)`**.
8. **`(:Component)-[:DEPENDS_ON]->(:Component)`** (shared-component runtime deps).
9. **`(:Component)-[:SOURCES_FROM]->(:Component)`** (service → repository provenance).
10. **`(:Component)-[:EXPOSES]->(:Component)`** (service → API it provides).

### 12.7 Importer mapping summary (for the v1 starter set)

| Source | `category` | `provider` | `resourceType` example | Env handling |
|---|---|---|---|---|
| GitHub repo | `REPOSITORY` | `GITHUB` | `github:repo` | n/a (or branch-as-instance) |
| AWS EC2 | `COMPUTE` | `AWS` | `ec2:instance` | `ComponentInstance.environment` from tags/account convention |
| AWS RDS | `DATABASE` | `AWS` | `rds:db-instance` | per-instance |
| AWS S3 | `STORAGE` | `AWS` | `s3:bucket` | per-instance (rarely env-specific) |
| AWS Lambda | `SERVERLESS` | `AWS` | `lambda:function` | per alias/qualifier instance |
| AWS API Gateway | `API` | `AWS_API_GATEWAY` | `apigateway:rest-api` | `ComponentInstance` per Stage |
| Azure VM | `COMPUTE` | `AZURE` | `Microsoft.Compute/virtualMachines` | per-instance |
| Azure SQL | `DATABASE` | `AZURE` | `Microsoft.Sql/servers/databases` | per-instance |
| Azure AKS | `CONTAINER_ORCHESTRATION` | `AZURE` | `Microsoft.ContainerService/managedClusters` | per-instance |
| K8s Deployment | `CONTAINER` | `KUBERNETES` | `apps/v1:Deployment` | `ComponentInstance` per namespace |
| K8s Namespace | `CONTAINER_ORCHESTRATION` | `KUBERNETES` | `v1:Namespace` | namespace-as-env convention |
| K8s Ingress | `NETWORK` | `KUBERNETES` | `networking.k8s.io/v1:Ingress` | per namespace |
| Web URL (dev) | `WEB_ENDPOINT` | `OTHER` | `web:url` | `ComponentInstance.environment=DEV`, `url=…` |
| API URL (prod) | `API` | `OTHER` | `web:api-url` | `ComponentInstance.environment=PRODUCTION`, `url=…` |
| MCP server | `MCP_SERVER` | `MCP` | `mcp:server` | one instance per env URL |

---

## 13. Explicit Gaps and Caveats

1. **Plutora, Planview, ValueBlue entity taxonomies** — no primary source
   retrieved (closed-source, gated docs). Do not assume parity with
   LeanIX/ServiceNow. (§8.4)
2. **OpsLevel / Cortex per-environment endpoint modeling** — characterized from
   the service-object schemas; dedicated "endpoints" primary docs were not
   directly retrieved. (§5.1)
3. **ServiceNow CMDB OOB class hierarchy** — the canonical hierarchy lives
   in-product (CI Class Manager); the community-sourced script output is the
   closest public proxy. The *structure* (table extension from `cmdb_ci`) is
   confirmed by official docs. (§5.2)
4. **Backstage `job` / `cli` / `function` component types** — frequently cited
   but **not** in the official well-known list (which is service/website/library
   only). Treated here as community conventions, not canonical. (§2.1)
5. **AWS Config vs. Resource Explorer** — this research cites Resource Explorer
   as the type-taxonomy source; AWS Config's resource-type coverage is broader
   but uses the same `{service}:{resource-type}` convention. A deeper
   Config-specific enumeration was not separately retrieved.
6. **MCP spec version** — cited against the draft and 2025-03-26 versions; the
   spec is still evolving, so `MCP_SERVER` modeling should track the latest
   `server/discover` shape. (§4.4)

---

## 14. References (primary sources, deduplicated)

- Backstage descriptor format — https://backstage.io/docs/features/software-catalog/descriptor-format
- Backstage descriptor format (repo) — https://github.com/backstage/backstage/blob/master/docs/features/software-catalog/descriptor-format.md
- Backstage ComponentEntity interface — https://backstage.io/api/stable/interfaces/_backstage_catalog-model.index.ComponentEntity.html
- Backstage ResourceEntity interface — https://backstage.io/api/stable/interfaces/_backstage_catalog-model.index.ResourceEntity.html
- Backstage API kind schema — https://github.com/backstage/backstage/blob/master/packages/catalog-model/src/schema/kinds/API.v1alpha1.schema.json
- Backstage system model — https://backstage.io/docs/features/software-catalog/system-model
- Backstage RFC #24362 (spec.type validation) — https://github.com/backstage/backstage/issues/24362
- Harness IDP catalog overview — https://developer.harness.io/docs/internal-developer-portal/catalog/overview/
- Harness IDP register component — https://developer.harness.io/docs/internal-developer-portal/tutorials/register-component-in-catalog/
- OpsLevel service Terraform data source — https://registry.terraform.io/providers/OpsLevel/opslevel/latest/docs/data-sources/service
- OpsLevel custom properties — https://docs.opslevel.com/docs/custom-properties
- Port default blueprints — https://docs.port.io/context-lake/data-model/setup-blueprint/default-blueprints/
- Port blueprints — https://docs.port.io/build-your-software-catalog/customize-integrations/configure-data-model/setup-blueprint/
- Cortex custom entity types — https://docs.cortex.io/ingesting-data-into-cortex/entities/adding-entities/entity-types
- Cortex services — https://docs.cortex.io/ingesting-data-into-cortex/entities-overview/entities/adding-entities/add-services
- Cortex groups — https://docs.cortex.io/ingesting-data-into-cortex/entities-overview/entities/groups
- Humanitec resources overview — https://developer.humanitec.com/app-humanitec-io/docs/platform-orchestrator/resources/overview/
- Humanitec resource definitions — https://developer.humanitec.com/app-humanitec-io/docs/platform-orchestrator/resources/resource-definitions/
- Humanitec resource types — https://developer.humanitec.com/platform-orchestrator/docs/configure/resource-types/
- Humanitec resource-management-theory — https://developer.humanitec.com/app-humanitec-io/guides/getting-started/master-your-internal-developer-platform/resource-management-theory/
- Humanitec Terraform resource_definition — https://registry.terraform.io/providers/humanitec/humanitec/latest/docs/resources/resource_definition
- AWS Resource Explorer supported types — https://docs.aws.amazon.com/resource-explorer/latest/userguide/supported-resource-types.html
- AWS Resource Explorer list-supported-resource-types CLI — https://docs.aws.amazon.com/cli/latest/reference/resource-explorer-2/list-supported-resource-types.html
- AWS Resource Explorer FAQs — https://aws.amazon.com/resourceexplorer/faqs/
- Azure resource providers and types — https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/resource-providers-and-types
- Azure Resource Graph explore-resources — https://learn.microsoft.com/en-us/azure/governance/resource-graph/concepts/explore-resources
- cartography AWS schema — https://docs.cartography.dev/modules/aws/schema.html
- cartography schema (repo) — https://github.com/cartography-cncf/cartography/blob/master/docs/root/modules/aws/schema.md
- cartography schema index — https://docs.cartography.dev/usage/schema.html
- cartography repo — https://github.com/cartography-cncf/cartography
- Steampipe AWS plugin — https://hub.steampipe.io/plugins/turbot/aws
- Steampipe Kubernetes plugin — https://hub.steampipe.io/plugins/turbot/kubernetes
- Kubernetes API Concepts — https://kubernetes.io/docs/reference/using-api/api-concepts/
- Kubernetes API Groups — https://kubernetes.io/docs/reference/kubernetes-api/group-versions/
- Kubernetes Core API — https://kubernetes.io/docs/reference/kubernetes-api/core/
- Kubernetes APIResource meta — https://kubernetes.io/docs/reference/kubernetes-api/definitions/api-resource-v1-meta/
- kubectl api-resources — https://kubernetes.io/docs/reference/kubectl/generated/kubectl_api-resources/
- OpenShift Project APIs (OCP 4.21) — https://docs.redhat.com/en/documentation/openshift_container_platform/4.21/observability/project_apis/project-apis
- OKD Project APIs — https://docs.okd.io/latest/rest_api/project_apis/project_apis-index.html
- Red Hat Developer: OpenShift with Kubernetes — https://developers.redhat.com/articles/2023/01/11/developers-guide-using-openshift-kubernetes
- Apigee API product REST — https://docs.cloud.google.com/apigee/docs/reference/apis/apigee/rest/v1/organizations.apiproducts
- Apigee environments overview — https://cloud.google.com/apigee/docs/api-platform/fundamentals/environments-overview
- Kong get-started — https://developer.konghq.com/gateway/get-started/
- Kong Konnect plugin CRD — https://developer.konghq.com/operator/konnect/crd/gateway/plugin/
- Kong Konnect MCP tools — https://developer.konghq.com/konnect-platform/konnect-mcp/tools/
- MCP specification — https://spec.modelcontextprotocol.io/specification/
- MCP 2025-03-26 — https://spec.modelcontextprotocol.io/specification/2025-03-26/
- MCP server/discover (draft) — https://modelcontextprotocol.io/specification/draft/server/discover
- MCP server-concepts — https://modelcontextprotocol.io/docs/learn/server-concepts
- MCP server index.mdx (repo) — https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/draft/server/index.mdx
- ServiceNow CMDB tables — https://www.servicenow.com/docs/r/servicenow-platform/configuration-management-database-cmdb/cmdb-tables-details.html
- ServiceNow CMDB populating — https://www.servicenow.com/docs/r/servicenow-platform/configuration-management-database-cmdb/c_OptionsToPopulateCMDB.html
- ServiceNow CSDM↔APM — https://www.servicenow.com/community/in-other-news/what-is-csdm-s-relationship-with-apm-dpm-and-spm-and-how-they/ba-p/3050464
- ServiceNow Business Application — https://www.servicenow.com/community/enterprise-architure-articles/what-is-a-business-application/ta-p/3071106
- ServiceNow APM product — https://www.servicenow.com/products/application-portfolio-management.html
- LeanIX fact-sheet types — https://learning.sap.com/learning-journeys/learning-to-use-leanix-tool-for-successful-enterprise-architecture/leanix-fact-sheet-types_b9cc5895-090e-466d-adbc-114e2c5947cb
- LeanIX intro to applications — https://learning.sap.com/courses/adding-first-data-to-your-sap-leanix-workspace/intro-to-applications
- LeanIX introduction to relations — https://learning.sap.com/courses/adding-first-data-to-your-sap-leanix-workspace/introduction-to-relations
- Ardoq metamodels — https://help.ardoq.com/en/articles/44159-what-are-metamodels
- Ardoq component types & metamodel — https://help.ardoq.com/en/articles/44068-manage-component-types-and-metamodel
- Ardoq hierarchies vs references — https://help.ardoq.com/en/articles/44032-should-you-model-using-hierarchies-or-references
- Ardoq references — https://help.ardoq.com/en/articles/44157-what-are-references
- Ardoq flexible metamodels — https://help.ardoq.com/en/articles/44184-flexible-workspace-metamodels
