import type {
  ComponentCategory,
  ComponentLifecycle,
  ComponentProvider,
  ProductType,
} from "../constants/index.js";
import type { ComponentInstance } from "./component-instance.js";

/**
 * Spec 060 / ADR-128 — read-only one-hop Component relationships.
 *
 * Every lane preserves its stored relation type and direction; the read
 * never infers edges and never mutates catalog state.
 */

/** Typed related-Component ref shared by every Component relation lane. */
export interface RelatedComponent {
  id: string;
  name: string;
  slug: string;
  category: ComponentCategory;
  provider: ComponentProvider;
  resourceType: string;
  lifecycle: ComponentLifecycle;
}

/** Non-RETIRED product holding a direct DEPENDS_ON edge on the component. */
export interface ComponentProductDependent {
  id: string;
  name: string;
  slug: string;
  type: ProductType;
  lifecycle: ComponentLifecycle;
}

export interface ComponentGroupRef {
  id: string;
  name: string;
  slug: string;
  lifecycle: ComponentLifecycle;
}

/**
 * A Product dependency that reaches the focused Component through a
 * ComponentGroup — attributed via `viaGroup`, never presented as a direct
 * Product-to-Component edge (ADR-110, spec 060 FR-004).
 */
export interface GroupMediatedDependent extends ComponentProductDependent {
  viaGroup: ComponentGroupRef;
}

/** Relation groups the read may report as independently unavailable. */
export const COMPONENT_RELATION_KINDS = [
  "dependsOn",
  "dependedOnBy",
  "sourcesFrom",
  "sourcedBy",
  "exposes",
  "exposedBy",
  "productDependents",
  "instances",
] as const;

export type ComponentRelationKind = (typeof COMPONENT_RELATION_KINDS)[number];

export interface ComponentRelationships {
  component: RelatedComponent;
  relationships: {
    /** Focused Component → Component DEPENDS_ON targets. */
    dependsOn: RelatedComponent[];
    /** Components whose DEPENDS_ON targets the focused Component. */
    dependedOnBy: RelatedComponent[];
    /** Focused service Component → repository Component SOURCES_FROM. */
    sourcesFrom: RelatedComponent[];
    /** Service Components that SOURCES_FROM the focused repository. */
    sourcedBy: RelatedComponent[];
    /** Focused service Component → API Component EXPOSES. */
    exposes: RelatedComponent[];
    /** Service Components that EXPOSES the focused API Component. */
    exposedBy: RelatedComponent[];
    productDependents: {
      direct: ComponentProductDependent[];
      viaGroups: GroupMediatedDependent[];
    };
    /** Nested operational occurrences; GONE excluded unless requested. */
    instances: ComponentInstance[];
  };
  /** Groups that could not be read — never silently omitted. */
  unavailableKinds: ComponentRelationKind[];
}
