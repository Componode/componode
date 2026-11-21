import type { ComponentCategory } from "../constants/component-categories.js";
import type { ComponentProvider } from "../constants/component-providers.js";
import type { ComponentProviderGroup } from "../constants/component-providers.js";

// Spec 075 / ADR-132 — the Add-to-catalog / Link curation contract. The
// dialog renders the preview verbatim; writes are atomic (UX-ADD-05).

/** GET /packages/add-to-catalog/preview response. */
export interface AddToCatalogPreview {
  /** Package display name. */
  name: string;
  /** Normalized version-free purl — the component's externalId. */
  identity: string;
  category: ComponentCategory;
  provider: ComponentProvider;
  providerGroup: ComponentProviderGroup;
  /** purl type verbatim (`npm:package`). */
  resourceType: string;
  /** Distinct ACTIVE components reporting this identity. */
  consumerCount: number;
  /** Every reported version with its consumer count. */
  versions: { version: string; componentCount: number }[];
  /** Non-null on lossy inference — renders the "Mapped from" note (UX-ADD-07). */
  mappedFrom: { cdxType: string | null; ecosystem: string } | null;
  /** Non-null switches the dialog to Link mode — never create a duplicate. */
  existingComponent: {
    id: string;
    slug: string;
    name: string;
    category: ComponentCategory;
    provider: ComponentProvider;
  } | null;
}

/** POST /packages/add-to-catalog and /packages/link response. */
export interface CurationResult {
  component: {
    id: string;
    slug: string;
    name: string;
    category: ComponentCategory;
    provider: ComponentProvider;
    externalId: string | null;
  };
  /** Dependency edges created this call. */
  linked: number;
  /** Pre-existing edges preserved. */
  alreadyLinked: number;
  /** Suggestions staged (linkConsumers=false path). */
  suggestionsStaged: number;
}

/** GET /packages/versions row — every version for one identity. */
export interface PackageVersionListItem {
  version: string;
  componentCount: number;
}
