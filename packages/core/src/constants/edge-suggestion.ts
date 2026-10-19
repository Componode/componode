export const EDGE_SUGGESTION_REASON = [
  "NAME_MATCH",
  "TOPIC_TAG_MATCH",
  "NAMESPACE_MATCH",
] as const;

export type EdgeSuggestionReason = typeof EDGE_SUGGESTION_REASON[number];

export const EDGE_SUGGESTION_REASON_META: Record<
  EdgeSuggestionReason,
  { label: string; description: string }
> = {
  NAME_MATCH: {
    label: "Name match",
    description: "Product and component names/slugs share tokens",
  },
  TOPIC_TAG_MATCH: {
    label: "Topic/tag match",
    description: "Component tags or topics overlap the product's tags or name",
  },
  NAMESPACE_MATCH: {
    label: "Namespace match",
    description: "Kubernetes namespace tokens overlap the product's name",
  },
};

export const EDGE_SUGGESTION_STATUS = [
  "PENDING",
  "ACCEPTED",
  "DISMISSED",
  "SUPERSEDED",
] as const;

export type EdgeSuggestionStatus = typeof EDGE_SUGGESTION_STATUS[number];

export const EDGE_SUGGESTION_STATUS_META: Record<
  EdgeSuggestionStatus,
  { label: string; description: string }
> = {
  PENDING: {
    label: "Pending",
    description: "Awaiting human review — the only actionable state",
  },
  ACCEPTED: {
    label: "Accepted",
    description: "A human wired the edge through the queue — terminal",
  },
  DISMISSED: {
    label: "Dismissed",
    description: "A human rejected the pairing permanently — terminal",
  },
  SUPERSEDED: {
    label: "Superseded",
    description: "The pair became a real or covered edge by other means — terminal",
  },
};
