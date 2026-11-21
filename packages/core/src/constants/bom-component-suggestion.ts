// Spec 075 / ADR-132 — dependency suggestions: staged "component X depends
// on library Y" candidates. Lifecycle mirrors edge_suggestions (ADR-113):
// only PENDING is actionable, decisions are terminal.

export const BOM_SUGGESTION_REASONS = [
  "PURL_EXACT",
  "PURL_NAME_MATCH",
  "CATALOG_SLUG_MATCH",
] as const;

export type BomSuggestionReason = (typeof BOM_SUGGESTION_REASONS)[number];

export const BOM_SUGGESTION_STATUSES = [
  "PENDING",
  "ACCEPTED",
  "DISMISSED",
  "SUPERSEDED",
] as const;

export type BomSuggestionStatus = (typeof BOM_SUGGESTION_STATUSES)[number];

/** Badge labels for the dependency segment (UX-SUG-04). */
export const BOM_SUGGESTION_REASON_META: Record<
  BomSuggestionReason,
  { label: string; score: number }
> = {
  PURL_EXACT: { label: "Exact package match", score: 1.0 },
  PURL_NAME_MATCH: { label: "Name match", score: 0.5 },
  CATALOG_SLUG_MATCH: { label: "Catalog name match", score: 0.7 },
};
