import type { ComponentCategory, ComponentProvider, ComponentLifecycle } from "../constants/index.js";
import type { Link } from "../schemas/metadata.js";

export interface Component {
  id: string;
  name: string;
  slug: string;
  category: ComponentCategory;
  provider: ComponentProvider;
  resourceType: string;
  lifecycle: ComponentLifecycle;
  teamOwnerId?: string | null;
  componentGroupId?: string | null;
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
