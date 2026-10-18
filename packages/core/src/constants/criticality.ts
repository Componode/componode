export const CRITICALITIES = [
  "CRITICAL",
  "HIGH",
  "MEDIUM",
  "LOW",
] as const;

export type ProductCriticality = typeof CRITICALITIES[number];

export const CRITICALITY_META: Record<
  ProductCriticality,
  { label: string; description: string }
> = {
  CRITICAL: {
    label: "Critical",
    description: "Highest-priority product — immediate attention in an incident",
  },
  HIGH: {
    label: "High",
    description: "Important product — elevated priority in triage",
  },
  MEDIUM: {
    label: "Medium",
    description: "Standard product — normal priority",
  },
  LOW: {
    label: "Low",
    description: "Low-priority product — least urgent in triage",
  },
};
