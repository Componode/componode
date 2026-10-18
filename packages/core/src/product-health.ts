import type { Environment } from "./constants/environments.js";
import type { InstanceStatus } from "./constants/instance-status.js";
import type { ComponentLifecycle } from "./constants/lifecycle.js";
import type {
  ProductHealth,
  ProductHealthStatus,
} from "./contracts/digital-product.js";

const RANK: Record<ProductHealthStatus, number> = {
  RUNNING: 0,
  STOPPED: 1,
  ERROR: 2,
};

const worstOf = (a: ProductHealthStatus, b: ProductHealthStatus) =>
  RANK[b] > RANK[a] ? b : a;

export interface ProductHealthInput {
  instances: {
    componentId: string;
    environment: Environment;
    status: InstanceStatus;
  }[];
  /** componentId → lifecycle; components missing here are treated as RETIRED. */
  componentLifecycle: Record<string, ComponentLifecycle>;
}

/**
 * Derived product health (ADR-112). Input must already be scoped to the
 * product's own declared DEPENDS_ON sources (direct + group-expanded) —
 * COMPOSES-inherited and CONSUMES_FROM components never reach this function.
 *
 * Rules: GONE instances and instances on RETIRED components never
 * contribute; perEnv = worst-of per environment; headline = worst-of
 * PRODUCTION when any PRODUCTION instance contributes, else worst-of all;
 * zero contributing instances → null (absence is not health).
 */
export function computeProductHealth(
  input: ProductHealthInput,
): ProductHealth | null {
  const perEnv = new Map<Environment, ProductHealthStatus>();
  const sources = new Set<string>();

  for (const i of input.instances) {
    if (i.status === "GONE") continue;
    if (input.componentLifecycle[i.componentId] !== "ACTIVE") continue;
    // InstanceStatus minus GONE is exactly ProductHealthStatus.
    const status = i.status as ProductHealthStatus;
    sources.add(i.componentId);
    const prev = perEnv.get(i.environment);
    perEnv.set(i.environment, prev ? worstOf(prev, status) : status);
  }

  if (sources.size === 0) return null;

  const status =
    perEnv.get("PRODUCTION") ?? [...perEnv.values()].reduce(worstOf);
  return {
    status,
    perEnv: Object.fromEntries(perEnv),
    sourceCount: sources.size,
  };
}
