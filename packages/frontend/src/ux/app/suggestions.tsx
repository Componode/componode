import { useSuggestions } from "@/api/hooks/suggestions";
import { mapSuggestion } from "@/api/mappers/suggestions";
import { SuggestionQueue } from "@/ux/components/catalog/suggestion-queue";
import { PageContainer, PageHeader } from "@/ux/components/patterns/page-header";
import { ErrorState } from "@/ux/components/patterns/states";
import { Skeleton } from "@/ux/components/ui/skeleton";
import { errorMessage } from "@/ux/lib/api-state";

export function UxSuggestionsPage() {
  const { data, isPending, error, refetch } = useSuggestions("PENDING", 0, 100);

  return (
    <PageContainer>
      <PageHeader
        title="Suggestions"
        description="Relationships Componode inferred from traces, tags and ownership. Nothing changes in the catalog until you accept."
      />
      {isPending ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
      ) : error ? (
        <ErrorState
          title="Suggestions unavailable"
          description={errorMessage(error)}
          onRetry={() => void refetch()}
        />
      ) : (
        <SuggestionQueue items={data.items.map(mapSuggestion)} />
      )}
    </PageContainer>
  );
}
