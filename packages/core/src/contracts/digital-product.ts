import type {
  ProductType,
  ComponentLifecycle,
  ProductCriticality,
  Environment,
  ComponentCategory,
  ComponentProvider,
} from "../constants/index.js";
import type { Link } from "../schemas/metadata.js";

export interface DigitalProduct {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  type: ProductType;
  lifecycle: ComponentLifecycle;
  lobOwnerId?: string | null;
  teamOwnerId?: string | null;
  links?: Link[];
  tags?: string[];
  criticality?: ProductCriticality | null;
  sunsetAt?: string | null;
  createdBy?: string | null;
  updatedBy?: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Derived product health (ADR-112) — a subset of InstanceStatus; GONE never
 * contributes. Computed per read, never stored.
 */
export type ProductHealthStatus = "RUNNING" | "STOPPED" | "ERROR";

export interface ProductHealth {
  status: ProductHealthStatus;
  perEnv: Partial<Record<Environment, ProductHealthStatus>>;
  sourceCount: number;
}

/** How a dependency-listed component is reachable from the product (ADR-110 §2). */
export type DepSource =
  | { kind: "DIRECT" }
  | { kind: "GROUP"; group: { id: string; name: string; slug: string } }
  | {
      kind: "INHERITED";
      product: { id: string; name: string; slug: string };
    };

/** A raw product→group DEPENDS_ON edge as returned on product detail. */
export interface ProductGroupEdge {
  id: string;
  name: string;
  slug: string;
  memberCount: number;
}

/** A non-RETIRED product holding a direct DEPENDS_ON edge on a component (spec 020). */
export interface ComponentDependent {
  id: string;
  name: string;
  slug: string;
  type: ProductType;
}

/**
 * Platform candidate (ADR-017 detection): an ACTIVE component with direct
 * DEPENDS_ON edges from ≥2 distinct non-RETIRED products. Derived per read,
 * never stored.
 */
export interface PlatformCandidate {
  component: {
    id: string;
    name: string;
    slug: string;
    category: ComponentCategory;
    provider: ComponentProvider;
  };
  dependerCount: number;
  dependents: ComponentDependent[];
}

/** Result of `promoteComponentToPlatform` — the created product + rewritten consumers. */
export interface PromoteToPlatformResult {
  product: DigitalProduct;
  consumers: ComponentDependent[];
}
