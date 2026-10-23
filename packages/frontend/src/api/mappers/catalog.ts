import type { DepSource } from "@componode/core";
import type { InstanceDepRef } from "@/api/types";
import type {
  ComponentDepRef,
  Component as ApiComponent,
  ComponentGroup as ApiComponentGroup,
  ComponentInstance as ApiInstance,
  DigitalProduct,
} from "@/api/types";
import type {
  Component,
  ComponentGroupView,
  ComponentInstance,
  Product,
  ProductComponentRow,
} from "@/ux/lib/view-types";
import type {
  Environment,
  HealthStatus,
  InstanceStatus,
  Lifecycle,
  Provider,
  ProductType,
  Criticality,
} from "@/ux/lib/domain";

const PRODUCT_TYPES: readonly string[] = [
  "BUSINESS_CAPABILITY",
  "PLATFORM",
  "CUSTOMER_FACING",
];
const LIFECYCLES: readonly string[] = ["ACTIVE", "RETIRED"];
const HEALTH: readonly string[] = ["RUNNING", "STOPPED", "ERROR"];
const INSTANCE_STATUSES: readonly string[] = ["RUNNING", "STOPPED", "ERROR", "GONE"];
const ENVIRONMENTS: readonly string[] = [
  "DEV",
  "TEST",
  "STAGING",
  "DEMO",
  "PRODUCTION",
  "OTHER",
];
const PROVIDERS: readonly string[] = [
  "GITHUB",
  "AWS",
  "AZURE",
  "GOOGLE_CLOUD",
  "ALIBABA_CLOUD",
  "KUBERNETES",
  "DOCKER",
  "WEB_URL",
  "API_URL",
  "MCP_SERVER",
  "OTHER",
];
const CRITICALITIES: readonly string[] = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];

/** Narrows an API string into a closed view union, with a neutral fallback. */
function narrow<T extends string>(
  value: string | null | undefined,
  allowed: readonly string[],
  fallback: T,
): T {
  return value != null && allowed.includes(value) ? (value as T) : fallback;
}

function narrowOrNull<T extends string>(
  value: string | null | undefined,
  allowed: readonly string[],
): T | null {
  return value != null && allowed.includes(value) ? (value as T) : null;
}

export function mapProduct(
  p: DigitalProduct,
  detail?: { componentCount?: number },
): Product {
  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    type: narrow<ProductType>(p.type, PRODUCT_TYPES, "CUSTOMER_FACING"),
    lifecycle: narrow<Lifecycle>(p.lifecycle, LIFECYCLES, "ACTIVE"),
    status: narrowOrNull<HealthStatus>(p.status, HEALTH),
    criticality: narrowOrNull<Criticality>(p.criticality, CRITICALITIES),
    description: p.description ?? null,
    lobOwnerName: p.lobOwnerName ?? null,
    teamOwnerName: p.teamOwnerName ?? null,
    tags: p.tags ?? [],
    links: p.links ?? [],
    sunsetAt: p.sunsetAt ?? null,
    consumedByCount: p.consumedByCount,
    componentCount: detail?.componentCount ?? 0,
    completeness: p.completeness ?? {
      owner: false,
      description: false,
      dependencies: false,
    },
    updatedAt: p.updatedAt,
  };
}

export function mapComponentInstance(i: ApiInstance): ComponentInstance {
  return {
    id: i.id,
    environment: narrow<Environment>(i.environment, ENVIRONMENTS, "OTHER"),
    region: i.region ?? null,
    status: narrow<InstanceStatus>(i.status, INSTANCE_STATUSES, "GONE"),
    version: i.version ?? null,
    url: i.url ?? null,
    externalId: i.externalId,
    lastSeenAt: i.lastSeenAt ?? null,
  };
}

export function mapComponent(
  c: ApiComponent | (ApiComponent & { instances?: ApiInstance[]; lastSeenAt?: string | null }),
): Component {
  const detail = c as ApiComponent & { instances?: ApiInstance[]; lastSeenAt?: string | null };
  return {
    id: c.id,
    name: c.name,
    slug: c.slug,
    category: c.category,
    provider: narrow<Provider>(c.provider, PROVIDERS, "OTHER"),
    resourceType: c.resourceType,
    lifecycle: narrow<Lifecycle>(c.lifecycle, LIFECYCLES, "ACTIVE"),
    componentGroupName: c.componentGroupName ?? null,
    teamOwnerName: c.teamOwnerName ?? null,
    tags: c.tags ?? [],
    sunsetAt: c.sunsetAt ?? null,
    instanceCount: c.instanceCount,
    instances: (detail.instances ?? []).map(mapComponentInstance),
    lastSeenAt: detail.lastSeenAt ?? null,
  };
}

const depSourceLabel = (s: DepSource): string => {
  switch (s.kind) {
    case "DIRECT":
      return "Direct";
    case "GROUP":
      return `Group: ${s.group.name}`;
    case "INHERITED":
      return `Inherited: ${s.product.name}`;
  }
};

/** ComponentDepRef joined with the catalog component (when found) for display fields. */
const RANK: Record<InstanceStatus, number> = { ERROR: 0, STOPPED: 1, RUNNING: 2, GONE: 3 };

function worstInstanceStatus(instances: InstanceDepRef[] | undefined, componentId: string): InstanceStatus | null {
  const statuses = (instances ?? [])
    .filter((i) => i.componentId === componentId)
    .map((i) => narrowOrNull<InstanceStatus>(i.status, INSTANCE_STATUSES))
    .filter((s): s is InstanceStatus => s !== null);
  if (!statuses.length) return null;
  return statuses.reduce((a, b) => (RANK[b] < RANK[a] ? b : a));
}

export function mapDepComponent(
  ref: ComponentDepRef,
  catalog: ApiComponent[],
  instances?: InstanceDepRef[],
): ProductComponentRow {
  const full = catalog.find((c) => c.id === ref.id);
  return {
    id: ref.id,
    name: ref.name,
    slug: ref.slug,
    category: ref.category,
    lifecycle: narrow<Lifecycle>(ref.lifecycle, LIFECYCLES, "ACTIVE"),
    provider: full ? narrow<Provider>(full.provider, PROVIDERS, "OTHER") : null,
    resourceType: full?.resourceType ?? null,
    instanceCount: full?.instanceCount ?? null,
    componentGroupName: full?.componentGroupName ?? null,
    lastSeenAt: null,
    sources: ref.sources.map(depSourceLabel),
    worstStatus: worstInstanceStatus(instances, ref.id),
  };
}

export function mapComponentGroup(g: ApiComponentGroup): ComponentGroupView {
  return {
    id: g.id,
    name: g.name,
    slug: g.slug,
    description: g.description ?? null,
    lifecycle: narrow<Lifecycle>(g.lifecycle, LIFECYCLES, "ACTIVE"),
    team: g.teamOwnerName ?? null,
    members: g.memberCount ?? 0,
  };
}
