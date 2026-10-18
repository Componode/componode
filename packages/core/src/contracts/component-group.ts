import type { ComponentLifecycle } from "../constants/lifecycle.js";

export interface ComponentGroup {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  lifecycle: ComponentLifecycle;
  teamOwnerId?: string | null;
  createdBy?: string | null;
  updatedBy?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** List response item — includes the current member count (spec 019, FR-010). */
export interface ComponentGroupListItem extends ComponentGroup {
  memberCount: number;
}
