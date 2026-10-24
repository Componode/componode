import { PlusIcon } from "lucide-react";
import { useAllComponents } from "@/api/hooks/components";
import { mapComponent } from "@/api/mappers/catalog";
import { ComponentsTable } from "@/ux/components/catalog/components-table";
import { PageContainer, PageHeader } from "@/ux/components/patterns/page-header";
import { ErrorState, TableSkeleton } from "@/ux/components/patterns/states";
import { Button } from "@/ux/components/ui/button";
import { Card } from "@/ux/components/ui/card";
import { errorMessage } from "@/ux/lib/api-state";

export function UxComponentsPage() {
  // includeRetired: the table owns the lifecycle facet; retired rows stay
  // reachable through it instead of disappearing server-side.
  const { data, isPending, error, refetch } = useAllComponents({ includeRetired: true });

  return (
    <PageContainer>
      <PageHeader
        title="Components"
        description="Every deployable unit discovered by importers or added by hand. Each component has one or more instances across environments."
        actions={
          <Button variant="outline" disabled title="Manual component creation isn't available yet">
            <PlusIcon data-icon="inline-start" />
            Add manually
          </Button>
        }
      />
      {isPending ? (
        <Card className="py-0">
          <TableSkeleton rows={8} columns={5} />
        </Card>
      ) : error ? (
        <ErrorState
          title="Components unavailable"
          description={errorMessage(error)}
          onRetry={() => void refetch()}
        />
      ) : (
        <ComponentsTable data={(data ?? []).map(mapComponent)} />
      )}
    </PageContainer>
  );
}
