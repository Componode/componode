import { useActivityFeed } from "@/api/hooks/audit";
import { mapActivityItem } from "@/api/mappers/dashboard";
import { ActivityFeed } from "@/ux/components/patterns/activity-feed";
import { PageContainer, PageHeader } from "@/ux/components/patterns/page-header";
import { EmptyState, ErrorState, TableSkeleton } from "@/ux/components/patterns/states";
import { Card, CardContent } from "@/ux/components/ui/card";
import { errorMessage } from "@/ux/lib/api-state";

export function UxActivityPage() {
  const { data, isPending, error, refetch } = useActivityFeed({ limit: 50 });

  return (
    <PageContainer className="max-w-4xl">
      <PageHeader
        title="Activity"
        description="An immutable audit log of every change, sign-in and import. Retained for 1 year."
      />
      <Card>
        <CardContent>
          {isPending ? (
            <TableSkeleton rows={8} columns={3} />
          ) : error ? (
            <ErrorState
              title="Activity unavailable"
              description={errorMessage(error)}
              onRetry={() => void refetch()}
              className="border-0"
            />
          ) : data.items.length === 0 ? (
            <EmptyState title="No activity yet" className="border-0" />
          ) : (
            <ActivityFeed events={data.items.map(mapActivityItem)} />
          )}
        </CardContent>
      </Card>
    </PageContainer>
  );
}
