import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Check, RefreshCw, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { EDGE_SUGGESTION_REASON_META } from "@componode/core";
import { useSession } from "@/api/hooks/auth";
import {
  useSuggestions,
  useAcceptSuggestion,
  useDismissSuggestion,
  useRescanSuggestions,
  type SuggestionView,
} from "@/api/hooks/suggestions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TableSkeleton } from "@/components/states/skeletons";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { relativeTime, absoluteTime, MONO_CLASS } from "@/lib/format";
import { roleAtLeast } from "@/lib/roles";
import type { SuggestionQueueItem } from "@/api/types";
import type { ApiError } from "@/api/client";

const PAGE_SIZE = 50;

function reasonLabel(reason: SuggestionQueueItem["reason"]): string {
  return reason ? EDGE_SUGGESTION_REASON_META[reason].label : "Coverage";
}

/**
 * ADR-113 staged DEPENDS_ON queue: server-generated product→component
 * candidates, reviewed by humans. Pending rows are sorted by score
 * server-side; the dismissed view is a permanent decision history.
 */
export function SuggestionsPage() {
  const { data: user } = useSession();
  const canEdit = roleAtLeast(user?.role);

  // URL-filter convention — the view and page offset are shareable.
  const [params, setParams] = useSearchParams();
  const view: SuggestionView =
    params.get("status") === "DISMISSED" ? "DISMISSED" : "PENDING";
  const offset = Math.max(
    0,
    Math.trunc(Number(params.get("offset") ?? "0")) || 0,
  );
  const setView = (v: SuggestionView) => {
    setParams(v === "DISMISSED" ? { status: "DISMISSED" } : {});
  };
  const setOffset = (o: number) => {
    setParams({
      ...(view === "DISMISSED" ? { status: "DISMISSED" } : {}),
      ...(o > 0 ? { offset: String(o) } : {}),
    });
  };
  const [dismissing, setDismissing] = useState<SuggestionQueueItem | null>(null);

  const { data, isPending, error } = useSuggestions(view, offset);
  const accept = useAcceptSuggestion();
  const dismiss = useDismissSuggestion();
  const rescan = useRescanSuggestions();

  async function handleRescan() {
    try {
      const report = await rescan.mutateAsync();
      toast.success(
        `Rescan complete — ${report.staged} staged, ${report.superseded} superseded across ${report.productsScanned} products`,
      );
    } catch (err) {
      toast.error((err as ApiError).message ?? "Rescan failed");
    }
  }

  async function handleAccept(item: SuggestionQueueItem) {
    try {
      await accept.mutateAsync(item.id);
      toast.success(
        `${item.product.name} now depends on ${item.component.name}`,
      );
    } catch (err) {
      toast.error((err as ApiError).message ?? "Accept failed");
    }
  }

  async function handleDismiss() {
    if (!dismissing) return;
    try {
      await dismiss.mutateAsync(dismissing.id);
      setDismissing(null);
    } catch (err) {
      toast.error((err as ApiError).message ?? "Dismiss failed");
    }
  }

  return (
    <div className="bg-background p-6">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">Suggestions</h1>
          {data && (
            <span className="text-sm text-muted-foreground">
              {data.total} {view === "PENDING" ? "pending" : "dismissed"}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <select
            aria-label="Suggestion status"
            value={view}
            onChange={(e) => setView(e.target.value as SuggestionView)}
            className="h-10 w-40 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="PENDING">Pending</option>
            <option value="DISMISSED">Dismissed</option>
          </select>
          {canEdit && (
            <Button
              variant="outline"
              onClick={handleRescan}
              disabled={rescan.isPending}
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              {rescan.isPending ? "Rescanning…" : "Rescan"}
            </Button>
          )}
        </div>
      </div>

      {isPending && <TableSkeleton columns={5} rows={6} />}
      {error && (
        <ErrorState title="Failed to load suggestions" error={error} />
      )}
      {!isPending && !error && data?.items.length === 0 && (
        <EmptyState
          icon={Sparkles}
          title={
            view === "PENDING"
              ? "No pending suggestions"
              : "No dismissed suggestions"
          }
          description={
            view === "PENDING"
              ? "New candidates appear after imports, catalog writes, or a rescan."
              : "Dismissed candidates never return to the queue."
          }
        />
      )}

      {!isPending && !error && data && data.items.length > 0 && (
        <Card>
          <CardContent className="divide-y p-0">
            {data.items.map((item) => (
              <div key={item.id} className="px-4 py-2.5">
                <div className="flex items-center justify-between gap-3">
                  <span className="flex min-w-0 items-baseline gap-2 text-sm">
                    <Link
                      to={`/products/${item.product.slug}`}
                      className="truncate font-medium hover:underline"
                    >
                      {item.product.name}
                    </Link>
                    <span className="shrink-0 text-muted-foreground">
                      depends on
                    </span>
                    <Link
                      to={`/components/${item.component.id}`}
                      className="truncate font-medium hover:underline"
                    >
                      {item.component.name}
                    </Link>
                    <Badge
                      variant="outline"
                      className="bg-muted text-muted-foreground"
                    >
                      {item.component.category}
                    </Badge>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <Badge variant="secondary">{reasonLabel(item.reason)}</Badge>
                    {item.score !== null && (
                      <span className={MONO_CLASS}>
                        {item.score.toFixed(2)}
                      </span>
                    )}
                    {view === "DISMISSED" && (
                      <span
                        className="text-xs text-muted-foreground"
                        title={absoluteTime(item.decidedAt)}
                      >
                        dismissed by {item.decidedByName ?? "system"}{" "}
                        {relativeTime(item.decidedAt)}
                      </span>
                    )}
                    {canEdit && view === "PENDING" && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          aria-label={`Accept ${item.component.name}`}
                          onClick={() => handleAccept(item)}
                          disabled={accept.isPending}
                        >
                          <Check className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          aria-label={`Dismiss ${item.component.name}`}
                          onClick={() => setDismissing(item)}
                          disabled={dismiss.isPending}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                  </span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {!isPending && !error && data && data.items.length > 0 && (
        <div className="mt-3 flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            {offset + 1}–{offset + data.items.length} of {data.total}
          </span>
          {(offset > 0 || offset + data.items.length < data.total) && (
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={offset + PAGE_SIZE >= data.total}
                onClick={() => setOffset(offset + PAGE_SIZE)}
              >
                Next
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Permanent action — confirm per docs/ux.md §7. */}
      <Dialog open={!!dismissing} onOpenChange={() => setDismissing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Dismiss suggestion?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {dismissing?.product.name} → {dismissing?.component.name} will be
            permanently dismissed and never suggested again.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDismissing(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDismiss}
              disabled={dismiss.isPending}
            >
              Dismiss
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
