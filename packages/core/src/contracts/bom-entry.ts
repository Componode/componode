import type { BomDependencyScope, BomEvidenceSource, BomCdxType } from "../constants/bom-entry.js";

// Stored BOM entry — one importer-reported package fact on a component (or a
// specific instance). Written exclusively by importers (ADR-131); never
// user-edited in v1.
export interface BomEntry {
  id: string;
  componentId: string;
  componentInstanceId: string | null;
  parentBomEntryId: string | null;
  purl: string;
  name: string;
  version: string | null;
  ecosystem: string;
  scope: BomDependencyScope;
  evidenceSource: BomEvidenceSource;
  evidenceDetail: string | null;
  supplier: string | null;
  licenses: string[];
  direct: boolean;
  lastReportedAt: string;
  cdxType: BomCdxType | null;
  cdxBomRef: string | null;
  importRunId: string | null;
  sourceId: string | null;
  resolvedComponentId: string | null; // Phase 2 only — always null in Phase 1
  details: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

// List item returned by GET /components/:id/bom (contracts/bom-api.md).
export interface BomEntryListItem {
  id: string;
  purl: string;
  name: string;
  version: string | null;
  ecosystem: string;
  scope: BomDependencyScope;
  direct: boolean;
  evidenceSource: BomEvidenceSource;
  evidenceDetail: string | null;
  licenses: string[];
  supplier: string | null;
  cdxType: BomCdxType | null;
  source: { id: string; name: string } | null;
  lastReportedAt: string;
  parentId: string | null;
  hasChildren: boolean;
  childCount: number;
  instanceCount: number;
  instanceTotal: number;
  resolvedComponent: { id: string; slug: string; name: string } | null;
  pendingSuggestionId: string | null;
}

// GET /components/:id/bom/summary — single call backing the summary strip,
// instance picker, tree toggle and stale state.
export interface BomSummary {
  total: number;
  direct: number;
  ecosystems: string[];
  licenseCount: number;
  hasNesting: boolean;
  lastReportedAt: string | null;
  staleThresholdDays: number;
  sources: {
    id: string;
    name: string;
    importerKind: string | null;
    lastReportedAt: string;
  }[];
  instances: {
    id: string;
    name: string;
    environment: string;
    entryCount: number;
  }[];
}
