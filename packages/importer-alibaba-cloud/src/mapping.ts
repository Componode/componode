import type { ComponentCategory, InstanceStatus } from "@componode/core";

// ACS::<Service>::<Type> → ComponentCategory. Codes are the provider-native
// resource types returned by Resource Center SearchResources. Anything not
// listed is skipped + reported in coverage — never guessed.
const CATEGORY_MAP: Record<string, ComponentCategory> = {
  // Compute
  "ACS::ECS::Instance": "COMPUTE",
  "ACS::ECS::DedicatedHost": "COMPUTE",
  "ACS::ECS::Snapshot": "STORAGE",
  "ACS::ECS::Image": "PACKAGE_REGISTRY",
  "ACS::ECS::AutoProvisioningGroup": "COMPUTE",
  "ACS::EHPC::Cluster": "COMPUTE",
  "ACS::ECI::ContainerGroup": "CONTAINER",
  // Serverless
  "ACS::FC::Function": "SERVERLESS",
  "ACS::FC::Service": "SERVERLESS",
  "ACS::SAE::Application": "CONTAINER_ORCHESTRATION",
  // Containers & orchestration
  "ACS::CS::Cluster": "CONTAINER_ORCHESTRATION",
  "ACS::CS::KubernetesCluster": "CONTAINER_ORCHESTRATION",
  "ACS::CR::Instance": "PACKAGE_REGISTRY",
  "ACS::CR::Repository": "PACKAGE_REGISTRY",
  // Databases
  "ACS::RDS::DBInstance": "DATABASE",
  "ACS::KVStore::Instance": "DATABASE",
  "ACS::DDS::DBInstance": "DATABASE",
  "ACS::PolarDB::DBCluster": "DATABASE",
  "ACS::SelectDB::DBInstance": "DATABASE",
  "ACS::OTS::Instance": "DATABASE",
  "ACS::Lindorm::Instance": "DATABASE",
  "ACS::HBase::Cluster": "DATABASE",
  "ACS::ClickHouse::DBCluster": "DATABASE",
  "ACS::GPDB::DBInstance": "DATABASE",
  "ACS::Memcache::Instance": "DATABASE",
  "ACS::MongoDB::DBInstance": "DATABASE",
  "ACS::Elasticsearch::Instance": "DATABASE",
  "ACS::OpenSearch::Instance": "DATABASE",
  // Storage
  "ACS::OSS::Bucket": "STORAGE",
  "ACS::NAS::FileSystem": "STORAGE",
  "ACS::EBS::Disk": "STORAGE",
  "ACS::EBS::Snapshot": "STORAGE",
  // Network
  "ACS::VPC::VPC": "NETWORK",
  "ACS::VPC::VSwitch": "NETWORK",
  "ACS::VPC::RouteTable": "NETWORK",
  "ACS::VPC::EIP": "NETWORK",
  "ACS::VPC::NatGateway": "NETWORK",
  "ACS::VPC::VpnGateway": "NETWORK",
  "ACS::SLB::LoadBalancer": "NETWORK",
  "ACS::ALB::LoadBalancer": "NETWORK",
  "ACS::NLB::LoadBalancer": "NETWORK",
  "ACS::CEN::CenInstance": "NETWORK",
  "ACS::ExpressConnect::PhysicalConnection": "NETWORK",
  "ACS::ExpressConnect::VBR": "NETWORK",
  // Messaging / queues
  "ACS::MNS::Queue": "QUEUE",
  "ACS::MNS::Topic": "QUEUE",
  "ACS::Kafka::Instance": "QUEUE",
  "ACS::RocketMQ::Instance": "QUEUE",
  "ACS::RocketMQ5::Instance": "QUEUE",
  "ACS::RabbitMQ::Instance": "QUEUE",
  "ACS::EventBridge::EventBus": "QUEUE",
  "ACS::MSE::Cluster": "QUEUE",
  // CDN / DNS / TLS
  "ACS::CDN::Domain": "CDN",
  "ACS::DCDN::Domain": "CDN",
  "ACS::DNS::Domain": "DNS",
  "ACS::PVTZ::Zone": "DNS",
  "ACS::SSL::Certificate": "CERTIFICATE",
  "ACS::CAS::Certificate": "CERTIFICATE",
  // Security / identity
  "ACS::KMS::Key": "KMS_KEY",
  "ACS::KMS::Instance": "KMS_KEY",
  "ACS::KMS::Secret": "SECRET",
  "ACS::RAM::User": "IDENTITY",
  "ACS::RAM::Role": "IDENTITY",
  "ACS::RAM::Group": "IDENTITY",
  "ACS::RAM::Policy": "IDENTITY",
  "ACS::IM::Application": "IDENTITY",
  "ACS::CloudFirewall::Instance": "NETWORK",
  "ACS::WAF::Instance": "NETWORK",
  // Observability
  "ACS::SLS::Project": "OBSERVABILITY",
  "ACS::SLS::Logstore": "OBSERVABILITY",
  "ACS::CMS::ContactGroup": "OBSERVABILITY",
  "ACS::ARMS::Prometheus": "OBSERVABILITY",
  // APIs
  "ACS::ApiGateway::Instance": "API",
  "ACS::ApiGateway::App": "API",
  "ACS::ApiGateway::Api": "API",
  // Jobs
  "ACS::SchedulerX::AppGroup": "JOB",
  "ACS::BatchCompute::Job": "JOB",
};

export function mapResourceType(resourceType: string): ComponentCategory | null {
  return CATEGORY_MAP[resourceType] ?? null;
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// DiscoveredAsset caps slug at 100 chars; reserve 9 for "-"+8-char id suffix.
const SLUG_BASE_MAX = 91;

export function componentSlug(name: string, resourceId: string): string {
  const base = (slugify(name) || "resource").slice(0, SLUG_BASE_MAX).replace(/-+$/g, "");
  const suffix = resourceId.slice(-8).toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return `${base}-${suffix}`;
}

// Stable across renames: prefer the provider ARN when present, else
// type + resourceId (both immutable identifiers).
export function externalIdFor(record: {
  arn?: string;
  resourceType?: string;
  resourceId?: string;
}): string {
  if (record.arn) return record.arn;
  return `${record.resourceType ?? "ACS::Unknown"}:${record.resourceId ?? "unknown"}`;
}

// Best-effort provider status → InstanceStatus. Unknown strings map to null
// (unset) rather than a wrong guess — status fidelity only when enrichment
// supplies a real configuration blob.
export function mapStatus(status: string | undefined | null): InstanceStatus | null {
  if (!status) return null;
  const s = status.toLowerCase();
  // Per data-model: Running|InUse|Available|Active → RUNNING, Stopped* →
  // STOPPED, *Error*|*Fail* → ERROR, Deleted|Released → GONE, unknown → null.
  if (/^(running|inuse|in_use|available|active)/.test(s)) return "RUNNING";
  if (/^stopped/.test(s)) return "STOPPED";
  if (/(error|fail)/.test(s)) return "ERROR";
  if (/(deleted|released)/.test(s)) return "GONE";
  return null;
}

// Pulls a plausible status string out of a GetResourceConfiguration blob —
// Alibaba services name their status field inconsistently.
export function statusFromConfiguration(configuration: unknown): string | null {
  if (!configuration || typeof configuration !== "object") return null;
  const cfg = configuration as Record<string, unknown>;
  for (const key of ["Status", "status", "InstanceStatus", "DBInstanceStatus", "State", "state"]) {
    const v = cfg[key];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
}
