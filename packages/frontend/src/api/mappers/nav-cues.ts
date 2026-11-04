import type { ImportAgent, SuggestionListResult } from "@/api/types";

/** Count-only nav cue view models: raw API payloads stay behind mappers. */
export function mapPendingSuggestionCount(result: Pick<SuggestionListResult, "total"> | undefined): number {
  return result?.total ?? 0;
}

export function mapAgentAttentionCount(agents: Pick<ImportAgent, "status">[] | undefined): number {
  return (agents ?? []).filter((a) => a.status === "OFFLINE" || a.status === "NEVER_CONNECTED").length;
}
