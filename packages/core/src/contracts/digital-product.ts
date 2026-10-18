import type {
  ProductType,
  ComponentLifecycle,
  ProductCriticality,
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
