import {
  EDGE_SUGGESTION_REASON_META,
  type SuggestionQueueItem,
} from "@componode/core";
import type { Suggestion } from "@/ux/lib/view-types";

const confidence = (score: number | null): Suggestion["confidence"] => {
  if (score === null) return "LOW";
  if (score >= 1.5) return "HIGH";
  if (score >= 0.75) return "MEDIUM";
  return "LOW";
};

/** Queue row → view suggestion. All staged pairs are DEPENDS_ON (ADR-113). */
export function mapSuggestion(s: SuggestionQueueItem): Suggestion {
  return {
    id: s.id,
    kind: "DEPENDS_ON",
    from: s.product.name,
    to: s.component.name,
    reason: s.reason ? EDGE_SUGGESTION_REASON_META[s.reason].label : "Staged candidate",
    confidence: confidence(s.score),
  };
}
