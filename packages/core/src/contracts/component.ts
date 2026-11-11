import type { ComponentCategory, ComponentProvider, ComponentLifecycle } from "../constants/index.js";
import type { Link } from "../schemas/metadata.js";

/** Spec 070: a component's group membership ref (multi-valued). */
export interface ComponentGroupRef {
  id: string;
  name: string;
  slug: string;
  /** Auto-group provenance — non-null marks an auto-managed group whose
   *  membership is system-owned (not human-editable). */
  autoSourceId?: string | null;
  autoGroupKey?: string | null;
}

export interface Component {
  id: string;
  name: string;
  slug: string;
  category: ComponentCategory;
  provider: ComponentProvider;
  resourceType: string;
  lifecycle: ComponentLifecycle;
  teamOwnerId?: string | null;
  componentGroups?: ComponentGroupRef[];
  externalId?: string | null;
  details?: Record<string, unknown> | null;
  links?: Link[];
  tags?: string[];
  sunsetAt?: string | null;
  lastSeenAt?: string | null;
  lastSeenInRunId?: string | null;
  createdBy?: string | null;
  updatedBy?: string | null;
  createdAt: string;
  updatedAt: string;
}
