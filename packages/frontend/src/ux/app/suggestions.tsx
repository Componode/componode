import { Link } from "react-router-dom";
import { HistoryIcon } from "lucide-react";
import {
  SUGGESTIONS_SORT_KEYS,
  suggestionsListParams,
  useSuggestions,
  type SuggestionsFilterKey,
  type SuggestionsSortKey,
} from "@/api/hooks/suggestions";
import type { SuggestionQueueItem } from "@/api/types";
import { mapSuggestion } from "@/api/mappers/suggestions";
import { SuggestionQueue } from "@/ux/components/catalog/suggestion-queue";
import { PageContainer, PageHeader } from "@/ux/components/patterns/page-header";
import { ListPagination } from "@/ux/components/patterns/list-pagination";
import { ListSortSelect, type ListSortOption } from "@/ux/components/patterns/list-sort-select";
import { RelativeTime } from "@/ux/components/patterns/primitives";
import { StatusBadge } from "@/ux/components/patterns/status-badge";
import { TitleWithSummary } from "@/ux/components/patterns/title-with-summary";
import { EmptyState, ErrorState } from "@/ux/components/patterns/states";
import { Card, CardContent } from "@/ux/components/ui/card";
import { Skeleton } from "@/ux/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ux/components/ui/tabs";
import { useClampPage } from "@/ux/hooks/use-clamp-page";
import { useListState, type ListFilterConfig } from "@/ux/hooks/use-list-state";
import { errorMessage } from "@/ux/lib/api-state";
import type { Tone } from "@/ux/lib/domain";
import { ux } from "@/ux/lib/paths";

const SUGGESTIONS_FILTERS: { [K in SuggestionsFilterKey]: ListFilterConfig } = {
  // The status filter doubles as the pending/history tab driver —
  // "PENDING" → queue, "DECIDED" → decided history (spec 068).
  status: { default: "PENDING", values: ["PENDING", "DECIDED"] },
};

/** Card lists have no header row — sort is a (sort, order) option list. */
const SUGGESTION_SORT_OPTIONS: ListSortOption<SuggestionsSortKey>[] = [
  { sort: "score", order: "desc", label: "Highest score" },
  { sort: "score", order: "asc", label: "Lowest score" },
  { sort: "createdAt", order: "desc", label: "Newest first" },
  { sort: "createdAt", order: "asc", label: "Oldest first" },
  { sort: "decidedAt", order: "desc", label: "Recently decided" },
  { sort: "decidedAt", order: "asc", label: "Decided longest ago" },
  { sort: "status", order: "asc", label: "Status A–Z" },
  { sort: "status", order: "desc", label: "Status Z–A" },
];

const STATUS_TONE: Record<string, { tone: Tone; label: string }> = {
  ACCEPTED: { tone: "success", label: "Accepted" },
  DISMISSED: { tone: "neutral", label: "Dismissed" },
  SUPERSEDED: { tone: "warning", label: "Superseded" },
};

/** Spec 042 / G32 — read-only row for the decided-history view. */
function HistoryRow({ item }: { item: SuggestionQueueItem }) {
  const status = STATUS_TONE[item.status] ?? { tone: "neutral" as Tone, label: item.status };
  const view = mapSuggestion(item);
  return (
    <Card className="py-4">
      <CardContent className="flex flex-col gap-3 md:flex-row md:items-center">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <TitleWithSummary
              title={
                <Link
                  to={ux(`/products/${item.product.slug}`)}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  {item.product.name}
                </Link>
              }
              titleText={item.product.name}
              summary={{ kind: "edgeSuggestion", row: view }}
            />
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
  // Server-paginated list state lives in the URL (spec 068 / ADR-130); the
  // status filter is the pending/history tab driver.
  const list = useListState<SuggestionsSortKey, SuggestionsFilterKey>({
    sortKeys: SUGGESTIONS_SORT_KEYS,
    defaultSort: "score",
    defaultOrder: "desc",
    filters: SUGGESTIONS_FILTERS,
  });
  const params = suggestionsListParams(list);
  const suggestions = useSuggestions(params.status ?? "PENDING", params);
  useClampPage(list, suggestions.data);

  const data = suggestions.data;
  const rows = data?.items ?? [];
  const tab = list.filters.status === "DECIDED" ? "history" : "pending";

  const loading = (isPending: boolean) =>
    isPending ? (
      <div className="flex flex-col gap-3">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-20 rounded-xl" />
        ))}
      </div>
    ) : null;

  const body = (kind: "pending" | "history") =>
    loading(suggestions.isPending) ??
    (suggestions.error ? (
      <ErrorState
        title={kind === "pending" ? "Suggestions unavailable" : "History unavailable"}
        description={errorMessage(suggestions.error)}
        onRetry={() => void suggestions.refetch()}
      />
    ) : kind === "pending" ? (
      <>
        <SuggestionQueue items={rows.map(mapSuggestion)} />
        {data && data.total > 0 && (
          <ListPagination
            page={list.page}
            pageSize={list.pageSize}
            total={data.total}
            pageCount={data.pageCount}
            onPageChange={list.setPage}
            onPageSizeChange={list.setPageSize}
          />
        )}
      </>
    ) : rows.length === 0 ? (
      <EmptyState
        icon={HistoryIcon}
        title="No decisions yet"
        description="Accepted, dismissed and superseded suggestions appear here with who decided and when."
      />
    ) : (
      <>
        <ul className="flex flex-col gap-3">
          {rows.map((item) => (
            <li key={item.id}>
              <HistoryRow item={item} />
            </li>
          ))}
        </ul>
        {data && data.total > 0 && (
          <ListPagination
            page={list.page}
            pageSize={list.pageSize}
            total={data.total}
            pageCount={data.pageCount}
            onPageChange={list.setPage}
            onPageSizeChange={list.setPageSize}
          />
        )}
      </>
    ));

  return (
    <PageContainer>
      <PageHeader
        title="Suggestions"
        description="Relationships Componode inferred from traces, tags and ownership. Nothing changes in the catalog until you accept."
      />
      <div className="flex justify-end">
        <ListSortSelect
          sort={list.sort}
          order={list.order}
          onSortChange={(sort, order) => list.setSort(sort, order)}
          options={SUGGESTION_SORT_OPTIONS}
        />
      </div>
      <Tabs
        value={tab}
        onValueChange={(v) =>
          list.setFilter("status", v === "history" ? "DECIDED" : "PENDING")
        }
        className="gap-6"
      >
        <TabsList>
          <TabsTrigger value="pending">Pending</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>
        <TabsContent value="pending" className="flex flex-col gap-4">
          {body("pending")}
        </TabsContent>
        <TabsContent value="history" className="flex flex-col gap-4">
          {body("history")}
        </TabsContent>
      </Tabs>
    </PageContainer>
  );
}
