import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import type {
  EdgeSuggestion,
  SuggestionListResult,
  SuggestionRescanReport,
} from "@/api/types";

export type SuggestionView = "PENDING" | "DISMISSED";

/** Read queue — any authenticated role (ADR-113). `offset` pages the list. */
export function useSuggestions(view: SuggestionView = "PENDING", offset = 0) {
  return useQuery({
    queryKey: ["suggestions", view, offset],
    queryFn: () =>
      api<SuggestionListResult>(`/suggestions?status=${view}&offset=${offset}`),
    placeholderData: (prev) => prev,
  });
}

function invalidateSuggestions(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ["suggestions"] });
  // Accepting wires a real edge — refresh product dependency queries too.
  qc.invalidateQueries({ queryKey: ["products"] });
}

export function useAcceptSuggestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<{ suggestion: EdgeSuggestion }>(`/suggestions/${id}/accept`, {
        method: "POST",
      }),
    onSuccess: () => invalidateSuggestions(qc),
  });
}

export function useDismissSuggestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<{ suggestion: EdgeSuggestion }>(`/suggestions/${id}/dismiss`, {
        method: "POST",
      }),
    onSuccess: () => invalidateSuggestions(qc),
  });
}

export function useRescanSuggestions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api<SuggestionRescanReport>("/suggestions/rescan", {
        method: "POST",
      }),
    onSuccess: () => invalidateSuggestions(qc),
  });
}
