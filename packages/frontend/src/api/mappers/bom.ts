import type { BomEntryListItem, BomSummary } from "@componode/core";
import type { BomEntryView, BomSummaryView } from "@/ux/lib/view-types";
import type { BomEvidenceSource, BomScope, Environment } from "@/ux/lib/domain";

/**
 * API row → view model for the BOM tab (spec 073). The shapes mirror 1:1
 * today; the seam keeps enum narrowing and any view-only derivations out
 * of the component.
 */
export function toBomEntryView(row: BomEntryListItem): BomEntryView {
  return {
    id: row.id,
    purl: row.purl,
    name: row.name,
    version: row.version,
    ecosystem: row.ecosystem,
    scope: row.scope as BomScope,
    direct: row.direct,
    evidenceSource: row.evidenceSource as BomEvidenceSource,
    evidenceDetail: row.evidenceDetail,
    licenses: row.licenses,
    supplier: row.supplier,
    cdxType: row.cdxType,
    source: row.source,
    lastReportedAt: row.lastReportedAt,
    parentId: row.parentId,
    parentName: row.parentName,
    hasChildren: row.hasChildren,
    childCount: row.childCount,
    instanceCount: row.instanceCount,
    instanceTotal: row.instanceTotal,
    resolvedComponent: row.resolvedComponent,
    pendingSuggestionId: row.pendingSuggestionId,
    pendingSuggestionChildId: row.pendingSuggestionChildId,
  };
}

export function toBomSummaryView(s: BomSummary): BomSummaryView {
  return {
    total: s.total,
    direct: s.direct,
    ecosystems: s.ecosystems,
    licenseCount: s.licenseCount,
    hasNesting: s.hasNesting,
    lastReportedAt: s.lastReportedAt,
    staleThresholdDays: s.staleThresholdDays,
    sources: s.sources,
    instances: s.instances.map((i) => ({
      id: i.id,
      name: i.name,
      environment: i.environment as Environment,
      entryCount: i.entryCount,
    })),
  };
}
