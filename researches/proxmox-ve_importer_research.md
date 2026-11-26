# Proxmox VE Importer Research

**Purpose:** Assess the Proxmox VE REST API as a source for a read-only Componode
Importer, identify useful inventory and operational data, and outline a design
for a future specification.

**Scope:** API-supported inventory, likely Component mappings, provider
taxonomy coverage, identity, security, reconciliation, and implementation
questions. This is research, not an approved design or implementation
specification. Reviewed 2026-11-25.

## Executive view

Proxmox VE is a promising importer source: its REST API exposes cluster-wide
inventory and per-node configuration/status for QEMU virtual machines, LXC
containers, nodes, and storage. A useful first version can be read-only and
snapshot-based, with `/cluster/resources` as the inventory index and targeted
GETs for details. The API also provides cluster, pool, HA, and SDN-related
surfaces that could inform later enrichment.

The strongest catalog value is the relationship between a physical/virtual
compute host, its guests, and storage: guest identity, placement, power state,
capacity/configuration, and host/storage observations. These facts should
enrich Components and Component Instances, not create a second Digital Product
hierarchy or claim to provide continuous monitoring.

The main design risks to settle before specification are: how a cluster is
identified durably; how target endpoints and credentials are provisioned
safely for private networks; whether environment means a PVE cluster or an
operator-defined label; which sources of inventory are authoritative when API
permissions filter results; and the exact data-minimization boundary for VM
configuration.

## Repository comparison

There is no dedicated VMware/vSphere or Hyper-V importer/research document in
the checked-in `researches/`, `docs/`, or `specs/` material as of this review.
Accordingly, this research does not claim parity with a documented
hypervisor-specific design.

The closest in-repository precedent is the Docker importer:

- It separates source identity from the route used to reach that source, uses
  an Import Agent for restricted/private endpoints, and distinguishes durable
  Components from operational Instances. See [Docker importer guide](../docs/importers/docker.md)
  and [ADR-121](./adrs/ADR-121-docker-importer.md).
- Docker's importer research treats collection as a bounded observation, not
  live monitoring, and explicitly allowlists persisted configuration rather
  than storing complete provider responses. This is directly applicable to
  Proxmox guest configuration and API responses.
- The Alibaba Cloud importer is a closer cloud-inventory comparison for
  account/source identity and provider-resource identifiers. See
  [Alibaba Cloud research](./alibaba-cloud-importer_research.md).

The shared catalog contract already models discovered assets by `category`,
`provider`, and provider-native `resourceType`; each asset may contain
Component Instances with environment, status, external identity, and
allowlisted `rawConfig` data. The taxonomy includes `COMPUTE`, `CONTAINER`,
and `STORAGE`, but does not currently list `PROXMOX` as a provider. See
[ADR-013](./adrs/ADR-013-component-taxonomy-24-categories-provider-resourcetype.md)
and the [discovered asset contract](../packages/core/src/contracts/discovered-asset.ts).

## Provider taxonomy expansion

**Conclusion:** An expansion of the provider taxonomy is needed to represent
Proxmox and the related infrastructure platforms discussed here without
falling back to `OTHER`. The expansion should distinguish provider identity
from both Component category and provider family:

- `category` describes the discovered kind of Component: for example, PVE
  nodes and QEMU VMs are `COMPUTE`; LXC containers are `CONTAINER`.
- `provider` names the concrete product/platform from which the Component was
  discovered: for example, a Proxmox-reported QEMU VM would have provider
  `PROXMOX`.
- A provider family is a useful grouping for selection/filter UX, not a new
  Component category. “Hypervisor” is too narrow for Docker, Kubernetes,
  OpenShift, Podman, and Rancher.

The current `COMPONENT_PROVIDERS` enum includes `KUBERNETES` and `DOCKER`, but
does not include `PROXMOX`, VMware, Hyper-V, Citrix XenServer, Nutanix AHV,
XCP-ng, Rancher, OpenShift, or Podman. The current provider UI groups are
`Platforms` and `Package registries`. ADR-013's provider list includes
`OPENSHIFT` and `PODMAN`, but those values are absent from the current core
constant, so a taxonomy change should reconcile the ratified ADR, runtime enum,
database constraint/migrations, and provider filters rather than only adding a
single value.

### Representative provider landscape

This is a sourced, non-exhaustive shortlist of established products and
platforms relevant to Componode's infrastructure catalog. Product names below
are labels for candidate provider values; exact enum spellings remain open.

| Provider family | Representative products | Modeling boundary |
| --- | --- | --- |
| Hypervisor / VM platforms | Proxmox VE; VMware vSphere / ESXi; Microsoft Hyper-V; XenServer (formerly Citrix Hypervisor); Nutanix AHV; XCP-ng | Hosts and guest VMs are generally `COMPUTE`; provider identifies the management/API platform. |
| Container engines | Docker Engine; Podman | Engine/host is `COMPUTE`; containers are `CONTAINER`. Keep engine providers distinct. |
| Container orchestration / platform | Kubernetes; Red Hat OpenShift | Cluster/control-plane and worker inventory differ from workloads; OpenShift Virtualization also manages VMs, which remain `COMPUTE` Components. |
| Kubernetes fleet management | Rancher Manager | Rancher manages/provisions/imports Kubernetes clusters; it is a management plane, not a hypervisor. Decide whether a Rancher importer reports Rancher-owned management objects, Kubernetes-native workloads, or both before assigning providers to avoid duplicate representations. |
| Private-cloud control plane | OpenStack | OpenStack Nova is a compute/control plane supporting multiple hypervisors; do not treat `OPENSTACK` as synonymous with a specific underlying hypervisor. |

These distinctions matter for source attribution. For example, a VM on Proxmox
and a VM on OpenShift Virtualization are both `COMPUTE`, but have different
provider and provider-native `resourceType` values. A Kubernetes workload
imported through Rancher should not automatically become a `RANCHER` workload
if the durable resource identity and API semantics are Kubernetes-native.
Where two importers can report the same real-world object, define canonical
identity and deduplication behavior rather than assuming provider labels alone
will merge them.

### Taxonomy recommendation

1. Add provider values incrementally as an importer or a real catalog source
   requires them. The near-term virtualization candidates are `PROXMOX`,
   `VMWARE`, `HYPER_V`, `XENSERVER`, `NUTANIX_AHV`, and `XCP_NG`; consider
   `OPENSTACK` for its distinct IaaS control-plane API.
2. Reconcile the existing list and implementation before broadening it:
   confirm the intended status of `OPENSHIFT` and `PODMAN` from ADR-013, and
   add `RANCHER` only if Componode intends to integrate with Rancher's
   management API rather than only the Kubernetes API.
3. Keep provider values product/integration-specific. Use a separate provider
   family grouping for “Virtualization,” “Container engines,”
   “Orchestration/platforms,” and “Cloud/control planes,” if users need those
   distinctions in filters or importer setup.
4. Do not add a `HYPERVISOR` Component category. Hypervisor- and
   platform-specific resources map to existing categories (`COMPUTE`,
   `CONTAINER`, `CONTAINER_ORCHESTRATION`, `STORAGE`, `NETWORK`, etc.) with
   provider-native `resourceType` values.

### Primary references for provider landscape

- [Broadcom: vSphere Web Services API](https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere-sdks-tools/8-0/an-introduction-getting-started-with-vsphere-apis-and-sdks-8-0/core-vsphere-apis/web-services-vim-api.html)
  describes API inventory for VMs, ESXi hosts, clusters, datastores, and
  networks.
- [Microsoft: Hyper-V documentation](https://learn.microsoft.com/en-us/windows-server/virtualization/hyper-v/)
  covers Hyper-V virtual machines on Windows and Windows Server.
- [XenServer: Technical overview](https://docs.xenserver.com/us/en/xenserver/8/technical-overview.html)
  identifies XenServer as formerly Citrix Hypervisor and describes host/VM
  virtualization.
- [Nutanix: AHV](https://www.nutanix.com/products/ahv) describes AHV as its
  native hypervisor integrated with the Nutanix Cloud Infrastructure platform.
- [XCP-ng documentation](https://docs.xcp-ng.org/) describes its host, pool,
  storage, networking, and VM management surfaces.
- [Docker Engine API](https://docs.docker.com/reference/api/engine/) and
  [Podman documentation](https://docs.podman.io/en/stable/) describe distinct
  container engines and their APIs.
- [Kubernetes API concepts](https://kubernetes.io/docs/concepts/overview/kubernetes-api/)
  describes the Kubernetes cluster API and resource model.
- [Rancher Manager overview](https://ranchermanager.docs.rancher.com/rancher-manager)
  describes Rancher as a Kubernetes management platform that provisions and
  imports clusters.
- [Red Hat OpenShift Virtualization](https://www.redhat.com/en/technologies/cloud-computing/openshift/virtualization)
  describes VMs running alongside container workloads on OpenShift, built on
  KVM.
- [OpenStack Nova hypervisor configuration](https://docs.openstack.org/nova/latest/admin/configuration/hypervisors.html)
  documents multiple supported hypervisor backends and separates Nova's
  compute control plane from the selected virtualization backend.

## API surface relevant to collection

Proxmox documents a REST API with JSON responses and a formal API schema. The
API viewer is the endpoint-level source of truth for parameters, return fields,
and permission requirements. The API is exposed by each PVE installation over
HTTPS; the API wiki describes authentication and the `/api2/json` path prefix.

| Surface | What it can contribute | Candidate use |
| --- | --- | --- |
| `GET /version` | PVE version/release information | Compatibility and source metadata |
| `GET /cluster/status` | Cluster status, node count, quorum/status facts | Source identification candidate and cluster health context; confirm stable identity fields |
| `GET /cluster/resources` | Cluster-wide resource index, including nodes, storage, QEMU VMs, and LXC containers; optional type filtering | First inventory pass and current placement/status |
| `GET /nodes` and `GET /nodes/{node}/status` | Node inventory and host-level operational/capacity observations | Host Components and Instances |
| `GET /nodes/{node}/qemu` and per-VM `config`, `status/current` | QEMU guest identity, configuration, and current status | VM Components and Instances |
| `GET /nodes/{node}/lxc` and per-container `config`, `status/current` | LXC guest identity, configuration, and current status | Container Components and Instances |
| `GET /storage` and node/storage status endpoints | Storage definitions and node-local status/capacity | Storage Components and Instances |
| `GET /pools` and pool membership endpoints | Named pools and assigned VM/container IDs | Bounded membership metadata; consider later tag suggestions |
| HA, replication, task, SDN, and node-network endpoints | HA state, replication configuration, recent tasks, software-defined networks, and interfaces | Optional later enrichment; not necessary for baseline inventory |

References: [Proxmox VE API wiki](https://pve.proxmox.com/wiki/Proxmox_VE_API),
[official API viewer](https://pve.proxmox.com/pve-docs/api-viewer/),
[API viewer: cluster resources](https://pve.proxmox.com/pve-docs/api-viewer/index.html#/cluster/resources),
[API viewer: node index](https://pve.proxmox.com/pve-docs/api-viewer/index.html#/nodes),
[API viewer: node status](https://pve.proxmox.com/pve-docs/api-viewer/index.html#/nodes/{node}/status),
[API viewer: QEMU](https://pve.proxmox.com/pve-docs/api-viewer/index.html#/nodes/{node}/qemu),
[API viewer: QEMU config](https://pve.proxmox.com/pve-docs/api-viewer/index.html#/nodes/{node}/qemu/{vmid}/config),
[API viewer: QEMU current status](https://pve.proxmox.com/pve-docs/api-viewer/index.html#/nodes/{node}/qemu/{vmid}/status/current),
[API viewer: LXC](https://pve.proxmox.com/pve-docs/api-viewer/index.html#/nodes/{node}/lxc),
[API viewer: LXC config](https://pve.proxmox.com/pve-docs/api-viewer/index.html#/nodes/{node}/lxc/{vmid}/config),
[API viewer: LXC current status](https://pve.proxmox.com/pve-docs/api-viewer/index.html#/nodes/{node}/lxc/{vmid}/status/current),
[API viewer: storage](https://pve.proxmox.com/pve-docs/api-viewer/index.html#/storage),
[API viewer: pools](https://pve.proxmox.com/pve-docs/api-viewer/index.html#/pools).

The cluster-wide resource endpoint is particularly useful because it can
provide the current node associated with a guest and can filter by resource
type. The per-node guest endpoints expose richer per-guest configuration and
status. The importer should avoid walking every management endpoint just
because it exists: first prove the inventory/resource index gives a complete
enough inventory for a least-privilege account, then request detail endpoints
only for discovered resources.

## Valuable information and candidate asset model

The mapping below is a proposal for discussion, not a decision. A key
distinction is between a provider resource (a Component) and a particular
operational placement/observation (a Component Instance).

| Proxmox object | Candidate Componode mapping | Useful facts |
| --- | --- | --- |
| PVE node | `COMPUTE` Component, with one Instance per configured environment/source | Node name/ID, online state, uptime, CPU count/utilization, memory and disk capacity/use, version/kernel where available |
| QEMU VM | `COMPUTE` Component, with one Instance per PVE environment | VMID, configured name, current node, running/stopped state, vCPU and memory allocation, OS type, disks/storage references, NIC/bridge references, tags, pool, HA/replication facts when explicitly selected |
| LXC container | `CONTAINER` Component, with one Instance per PVE environment | VMID, configured hostname/name, node, running/stopped state, CPU/memory limits, root filesystem/storage reference, network interface metadata, tags, pool |
| PVE storage | `STORAGE` Component; Instances represent node-specific status when available | Storage ID/type, shared/enabled state, content types, capacity/use, node availability |
| PVE cluster | Candidate cluster-level `COMPUTE` Component or source-only metadata; decide whether it adds value beyond `ImporterSource` and node Components | Cluster name/identity candidate, quorum, node count, PVE version |
| PVE pool | Prefer bounded pool-name/ID membership metadata on member Components; consider user-confirmed tag suggestions rather than an automatic catalog entity | Pool membership and labels |
| SDN networks / node bridges | Candidate `NETWORK` Components only if the API provides stable identity and useful consumers; otherwise keep safe network references in guest/node details | Network/bridge names, IDs, selected addressing facts |
| VM/container disks, snapshots, backup files, templates | Initially references/metadata only; do not create Components per disk, snapshot, or content file without a separate value case | Disk bus/size/storage, snapshot names/count, backup/template inventory |

The API has data that could be operationally valuable, especially node and
guest CPU, memory, disk, uptime, state, and placement. These are point-in-time
observations collected during a run. They are not a time series, alert, or
continuous health check. The catalog's operational status should reflect
source state observed in that run; the UI should make freshness visible and
must not suggest that imported metrics are live.

### Candidate identity rules

- A Source should represent one PVE cluster/system, not a mutable config,
  access token, display label, individual node, or target route. Prefer a
  canonical provider-native cluster identifier if a supported endpoint exposes
  one and its stability is verified; otherwise require an explicit stable
  operator-supplied identity. Do not key a Source by display name.
- Candidate guest Component identity is cluster identity plus VMID. VMID is
  unique in the PVE cluster namespace, while the node is mutable during
  migration. Do not include the current node in the guest Component identity.
- Candidate Instance identity is also stable across node migration; node
  placement belongs in the current observation, not in the identity key.
- Candidate node identity is cluster identity plus node name/ID. Candidate
  storage identity is cluster identity plus storage ID. Verify behavior for
  shared storage, renamed objects, node replacement, and cluster recreation
  before ratifying these formats.
- A Component ID should not include an importer config ID, endpoint hostname,
  credential, or PVE display label. Changing routes/credentials must not split
  durable source membership.

These rules follow the durable ImporterSource/source-membership model in
[ADR-119](./adrs/ADR-119-importer-source-identity-and-lifecycle.md) and the
source-specific migration requirements in ADR-120.

### Candidate status handling

Use only observed provider state and documented mappings. A starting point for
discussion is:

- PVE node online → `RUNNING`; offline/unavailable → `ERROR`.
- QEMU/LXC running → `RUNNING`; stopped → `STOPPED`.
- Explicitly paused/suspended or transitional statuses require a deliberate
  mapping after confirming the API's exact status values for supported
  versions. Unknown returned values should be preserved as bounded source
  facts and mapped conservatively rather than silently treated as healthy.
- Missing from a successfully completed, authoritative inventory → source
  reconciliation may mark its Instance `GONE`. A failed/partial request must
  not be treated as an empty inventory.

`GONE` is reconciliation state, not the same as a provider-reported stopped
state. Reconciliation must remain scoped to the Proxmox ImporterSource so a
different Source reporting the same Component/Instance is not retired.

## Authentication, execution, and safe collection

Proxmox supports tickets and API tokens. API tokens can be given separate
privileges; in privilege-separated mode, the token's effective permissions
are constrained by both token and user permissions. A dedicated read-only
account/token is preferable to administrator credentials. Validate the
minimum permission set by exercising every proposed endpoint against the
supported PVE versions: likely audit privileges include `VM.Audit`,
`Sys.Audit`, and `Datastore.Audit` on the relevant paths. `GET
/cluster/resources` being callable by an authenticated user does not guarantee
that all resource rows or fields are visible; permissions can filter results.

The importer must make GET-only calls and never invoke task-producing or
mutating endpoints. It should verify TLS certificates and avoid accepting an
arbitrary private URL through a generic importer config field. Since PVE
instances are commonly reachable only on private networks, a future design
likely needs an Agent-bound target reference with a validated, immutable
target profile and Agent-managed credential keys. The existing Agent target
machinery is generic at the contract layer, but Docker's concrete target
registry/profile is provider-specific; it should not be reused by pretending
it is a generic PVE target.

Persist a field allowlist, not the full API response or full guest config.
Explicitly exclude passwords, cloud-init credentials, SSH keys, free-form
arguments, hooks/scripts, environment-like data, and arbitrary descriptions
unless a specific field is proven safe and useful. Do not log API responses,
tokens, endpoint credentials, or secret-bearing configuration. Avoid
collecting console access, task logs, guest-agent data, or backup contents in
the baseline.

Proxmox API tokens are sent with an Authorization header in the documented
token form. Credentials belong in Componode's encrypted credential store and
remain write-only over the API; target endpoint and transport metadata belong
in a validated target profile, not in secrets. Use the existing importer
credential-test pattern to make a minimal authenticated read request and
return sanitized failure details.

References: [Proxmox API wiki — authentication](https://pve.proxmox.com/wiki/Proxmox_VE_API#Authentication),
[Proxmox VE User Management guide — API tokens and privilege separation](https://pve.proxmox.com/pve-docs/chapter-pveum.html),
[API viewer](https://pve.proxmox.com/pve-docs/api-viewer/),
[Componode ADR-107](./adrs/ADR-107-credential-store.md),
[Componode ADR-116](./adrs/ADR-116-remote-import-agents.md).

## Proposed implementation sequence

This is a suggested work breakdown for a later spec-kit feature; it is not
authorization to implement directly from this document.

1. **Resolve the design questions.** Confirm stable cluster identity,
   environment mapping, provider taxonomy, target profile ownership, supported
   PVE versions, and minimum permissions with a representative cluster.
2. **Ratify architecture decisions.** Decide Component/Instance identity,
   resource mappings, data allowlists, status mapping, and source-scoped
   reconciliation. Record any cross-cutting contract changes as ADRs before
   specification.
3. **Define the read-only API boundary.** Select a small endpoint set; define
   timeouts, cancellation, pagination/limits if relevant, version checks,
   partial-failure behavior, and how an inventory is considered complete.
   Start from cluster resource inventory, then retrieve only necessary node,
   guest, and storage details.
4. **Implement target and credential plumbing.** Define a typed PVE target
   profile for endpoint/TLS validation and Agent-local resolution, with
   credentials referenced by declared secret keys. Keep routing metadata
   separate from Source identity and credential bytes.
5. **Implement the importer package.** Use only `packages/core` plus a
   maintained Proxmox client or narrowly scoped HTTP client after reviewing
   dependency health and API coverage. Report Source identity before the first
   yield, including empty inventories; emit only validated `DiscoveredAsset`
   values; make every request cancellable and read-only.
6. **Add contract and importer tests.** Use fixtures from supported PVE API
   schemas/responses, test secret redaction, identities across migration and
   rename, token privilege filtering, unknown status values, empty inventory,
   and partial failures. Every importer unit test must pass each emitted asset
   through `validateDiscoveredAsset`.
7. **Integrate packages and user-facing setup docs.** Register the package in
   the backend and Agent importer sets in lockstep, generate its manifest docs,
   add the mandatory `docs/importers/proxmox-ve.md` guide, and update any
   credential, Agent, or deployment docs that the final design changes.
8. **Add Playwright coverage and converge.** Exercise importer setup,
   credential testing, execution, catalog detail, and source reconciliation in
   `playwright/tests/`. Run the required workload and spec-kit analysis/
   convergence before merge.

## Open questions for design review

1. **Source identity:** Does the supported PVE API expose a canonical cluster
   identity stable through node replacement and endpoint changes? If not, what
   exact admin-supplied key is required, and how should cluster rebuilds be
   distinguished?
2. **Provider taxonomy:** Which concrete providers should be ratified now
   (`PROXMOX`, VMware, Hyper-V, XenServer/Citrix, Nutanix AHV, XCP-ng,
   OpenStack, Rancher, OpenShift, Podman), and which should be added only with
   an importer? Should the UI add provider-family groupings? Reconcile the
   current constants with ADR-013's `OPENSHIFT`/`PODMAN` values before deciding.
3. **Component boundary:** Is the cluster itself a `COMPUTE` Component, or
   should the ImporterSource plus imported node Components fully represent it?
   Do nodes, VMs, and storage provide distinct catalog value in a first
   release?
4. **Environment semantics:** Is one PVE cluster one environment, or should
   the config require an environment label/mapping? How should same VMID
   values in separate clusters map to shared logical Components without
   merging unrelated guests?
5. **Guest identity:** Should VMID alone (qualified by Source) survive rename
   and node migration? What should happen when a guest is deleted and the
   same VMID is later reused for a different guest?
6. **Inventory completeness:** Which permission-filtered endpoints are
   authoritative? How will the importer distinguish a legitimately empty
   cluster from insufficient ACL visibility or a failed detail request before
   source-scoped retirement?
7. **Permission baseline:** Can a dedicated privilege-separated API token
   enumerate all required inventory with only `VM.Audit`, `Sys.Audit`, and
   `Datastore.Audit` on appropriate paths? Are storage or cluster endpoints
   filtered in ways that require further privilege?
8. **Execution boundary:** Should this importer be `requiresAgent: true` from
   its first release? Who provisions PVE target profiles and TLS trust, and
   can the existing Agent target preflight be extended without creating a
   provider-specific parallel mechanism?
9. **Initial scope:** Should v1 include PVE cluster, node, QEMU VM, LXC, and
   storage only? Are pools, HA state, replication, SDN networks, snapshots,
   backup metadata, or guest-agent enrichment deferred?
10. **Sensitive fields:** Which VM/container config fields may be persisted?
    Should description, tags, IP addresses, disk references, and network
    details be excluded by default or selectively allowlisted?
11. **Status mapping:** Which precise PVE statuses map to `RUNNING`,
    `STOPPED`, and `ERROR`? How should paused, suspended, unknown, or
    temporarily unreachable resources be surfaced?
12. **Version support:** What minimum/current PVE major versions are in scope,
    and which API schema changes must the importer tolerate without either
    failing closed or silently dropping essential inventory?

## Primary sources

- [Proxmox VE API wiki](https://pve.proxmox.com/wiki/Proxmox_VE_API) — API
  access, authentication, and request conventions.
- [Proxmox VE API viewer](https://pve.proxmox.com/pve-docs/api-viewer/) —
  endpoint schemas, permissions, parameters, and return types.
- [Proxmox VE Administration Guide](https://pve.proxmox.com/pve-docs/pve-admin-guide.html)
  — product/API overview and administration concepts.
- [Proxmox VE User Management guide](https://pve.proxmox.com/pve-docs/chapter-pveum.html)
  — users, roles, permissions, and API tokens.
- [QEMU/KVM Virtual Machines guide](https://pve.proxmox.com/pve-docs/chapter-qm.html)
  — VM configuration and operational concepts.
- [LXC Containers guide](https://pve.proxmox.com/pve-docs/chapter-pct.html)
  — container configuration and operational concepts.

## Componode references

- [CONTEXT.md](../CONTEXT.md) — canonical domain vocabulary and avoid-list.
- [ADR-013](./adrs/ADR-013-component-taxonomy-24-categories-provider-resourcetype.md)
  — Component category/provider/resource type model.
- [ADR-056](./adrs/ADR-056-importer-interface-signature.md) and
  [ADR-057](./adrs/ADR-057-discoveredasset-final-shape.md) — importer contract
  and discovered data shape.
- [ADR-065](./adrs/ADR-065-package-dependency-graph.md) — package boundaries
  and lockstep importer registration.
- [ADR-119](./adrs/ADR-119-importer-source-identity-and-lifecycle.md) and
  [ADR-120](./adrs/ADR-120-importer-source-migration-rules.md) — durable
  Source identity and source-scoped reconciliation.
- [ADR-121](./adrs/ADR-121-docker-importer.md) and
  [ADR-116](./adrs/ADR-116-remote-import-agents.md) — private-target and
  Agent-execution precedents.
