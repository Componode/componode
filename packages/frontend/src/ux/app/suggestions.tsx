import { Link } from "react-router-dom";
import { HistoryIcon } from "lucide-react";
import { useSuggestions } from "@/api/hooks/suggestions";
import type { SuggestionQueueItem } from "@/api/types";
import { mapSuggestion } from "@/api/mappers/suggestions";
import { SuggestionQueue } from "@/ux/components/catalog/suggestion-queue";
import { PageContainer, PageHeader } from "@/ux/components/patterns/page-header";
import { EmptyState, ErrorState } from "@/ux/components/patterns/states";
import { RelativeTime } from "@/ux/components/patterns/primitives";
import { StatusBadge } from "@/ux/components/patterns/status-badge";
import { Card, CardContent } from "@/ux/components/ui/card";
import { Skeleton } from "@/ux/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ux/components/ui/tabs";
import { errorMessage } from "@/ux/lib/api-state";
import type { Tone } from "@/ux/lib/domain";
import { ux } from "@/ux/lib/paths";

const STATUS_TONE: Record<string, { tone: Tone; label: string }> = {
  ACCEPTED: { tone: "success", label: "Accepted" },
  DISMISSED: { tone: "neutral", label: "Dismissed" },
  SUPERSEDED: { tone: "warning", label: "Superseded" },
};

/** Spec 042 / G32 — read-only row for the decided-history view. */
function HistoryRow({ item }: { item: SuggestionQueueItem }) {
  const status = STATUS_TONE[item.status] ?? { tone: "neutral" as Tone, label: item.status };
  return (
    <Card className="py-4">
      <CardContent className="flex flex-col gap-3 md:flex-row md:items-center">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <Link
              to={ux(`/products/${item.product.slug}`)}
              className="font-medium underline-offset-4 hover:underline"
            >
              {item.product.name}
            </Link>
            <span className="text-muted-foreground">depends on</span>
            <Link
              to={ux(`/components/${item.component.slug}`)}
              className="font-medium underline-offset-4 hover:underline"
            >
              {item.component.name}
            </Link>
          </p>
          <p className="text-sm text-muted-foreground">
            {item.decidedByName ? `Decided by ${item.decidedByName}` : "Decided by the system"}
            {" · "}
            <RelativeTime iso={item.decidedAt} />
          </p>
        </div>
        <StatusBadge {...status} />
      </CardContent>
    </Card>
  );
}

export function UxSuggestionsPage() {
  const pending = useSuggestions("PENDING", 0, 100);
  const history = useSuggestions("DECIDED", 0, 100);

  const loading = (isPending: boolean) =>
    isPending ? (
      <div className="flex flex-col gap-3">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-20 rounded-xl" />
        ))}
      </div>
    ) : null;

  return (
    <PageContainer>
      <PageHeader
        title="Suggestions"
        description="Relationships Componode inferred from traces, tags and ownership. Nothing changes in the catalog until you accept."
      />
      <Tabs defaultValue="pending" className="gap-6">
        <TabsList>
          <TabsTrigger value="pending">Pending</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>
        <TabsContent value="pending">
          {loading(pending.isPending) ??
            (pending.error ? (
              <ErrorState
                title="Suggestions unavailable"
                description={errorMessage(pending.error)}
                onRetry={() => void pending.refetch()}
              />
            ) : (
              <SuggestionQueue items={(pending.data?.items ?? []).map(mapSuggestion)} />
            ))}
        </TabsContent>
        <TabsContent value="history">
          {loading(history.isPending) ??
            (history.error ? (
              <ErrorState
                title="History unavailable"
                description={errorMessage(history.error)}
                onRetry={() => void history.refetch()}
              />
            ) : (history.data?.items ?? []).length === 0 ? (
              <EmptyState
                icon={HistoryIcon}
                title="No decisions yet"
                description="Accepted, dismissed and superseded suggestions appear here with who decided and when."
              />
            ) : (
              <ul className="flex flex-col gap-3">
                {(history.data?.items ?? []).map((item) => (
                  <li key={item.id}>
                    <HistoryRow item={item} />
                  </li>
                ))}
              </ul>
            ))}
        </TabsContent>
      </Tabs>
    </PageContainer>
  );
}
