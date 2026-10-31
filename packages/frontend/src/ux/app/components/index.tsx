import * as React from "react";
import { useAllComponents } from "@/api/hooks/components";
import { useSession } from "@/api/hooks/auth";
import { mapComponent } from "@/api/mappers/catalog";
import { ComponentCreateDialog } from "@/ux/components/catalog/component-create-dialog";
import { ComponentsTable } from "@/ux/components/catalog/components-table";
import { PageContainer, PageHeader } from "@/ux/components/patterns/page-header";
import { ErrorState, TableSkeleton } from "@/ux/components/patterns/states";
import { Card } from "@/ux/components/ui/card";
import { errorMessage } from "@/ux/lib/api-state";
import { canAccess } from "@/ux/lib/nav";

export function UxComponentsPage() {
  // includeRetired: retired rows stay reachable through the lifecycle badge
  // instead of disappearing server-side. includeGone is an opt-in — spec 023
  // hides gone-only components from coverage surfaces by default.
  const [includeGone, setIncludeGone] = React.useState(false);
  const { data, isPending, error, refetch } = useAllComponents({ includeRetired: true, includeGone });
  const session = useSession();
  // component:create is EDITOR+ (ADR-054 Amendment 1) — hidden for viewers.
  const canCreate = canAccess(session.data?.role ?? "VIEWER", "EDITOR");

  return (
    <PageContainer>
      <PageHeader
        title="Components"
        description="Every deployable unit discovered by importers or added by hand. Each component has one or more instances across environments."
        actions={canCreate ? <ComponentCreateDialog /> : undefined}
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
        <ComponentsTable data={(data ?? []).map(mapComponent)} includeGone={includeGone} onIncludeGoneChange={setIncludeGone} />
      )}
    </PageContainer>
  );
}
