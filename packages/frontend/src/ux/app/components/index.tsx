import { Link } from "react-router-dom";
import { MonitorCheckIcon } from "lucide-react";
import {
  COMPONENTS_SORT_KEYS,
  componentsListParams,
  useComponents,
  type ComponentsFilterKey,
  type ComponentsSortKey,
} from "@/api/hooks/components";
import { useSession } from "@/api/hooks/auth";
import { mapComponent } from "@/api/mappers/catalog";
import { ComponentCreateDialog } from "@/ux/components/catalog/component-create-dialog";
import { ComponentsTable } from "@/ux/components/catalog/components-table";
import { PageContainer, PageHeader } from "@/ux/components/patterns/page-header";
import { ErrorState, TableSkeleton } from "@/ux/components/patterns/states";
import { Button } from "@/ux/components/ui/button";
import { Card } from "@/ux/components/ui/card";
import { useListState, type ListFilterConfig } from "@/ux/hooks/use-list-state";
import { CATEGORY_LABELS, LIFECYCLE_META, PROVIDER_META } from "@/ux/lib/domain";
import { errorMessage } from "@/ux/lib/api-state";
import { canAccess } from "@/ux/lib/nav";
import { ux } from "@/ux/lib/paths";

const COMPONENTS_FILTERS: { [K in ComponentsFilterKey]: ListFilterConfig } = {
  provider: { default: "all", values: ["all", ...Object.keys(PROVIDER_META)] },
  category: { default: "all", values: ["all", ...Object.keys(CATEGORY_LABELS)] },
  lifecycle: { default: "all", values: ["all", ...Object.keys(LIFECYCLE_META)] },
  wired: { default: "all", values: ["all", "wired", "unwired"] },
  // Spec 068 gone-instances fix: domain is hide|show only — no "all".
  gone: { default: "hide", values: ["hide", "show"] },
};

export function UxComponentsPage() {
  // Server-paginated list state lives in the URL (spec 068 / ADR-130).
  const list = useListState<ComponentsSortKey, ComponentsFilterKey>({
    sortKeys: COMPONENTS_SORT_KEYS,
    filters: COMPONENTS_FILTERS,
  });
  // includeRetired stays true inside componentsListParams — retired rows
  // remain reachable through the lifecycle filter/badge.
  const { data, isPending, error, refetch } = useComponents(componentsListParams(list));
  const session = useSession();
  // component:create is EDITOR+ (ADR-054 Amendment 1) — hidden for viewers.
  const canCreate = canAccess(session.data?.role ?? "VIEWER", "EDITOR");

  return (
    <PageContainer>
      <PageHeader
        title="Components"
        description="Every deployable unit discovered by importers or added by hand. Each component has one or more instances across environments."
        actions={
          canCreate ? (
            <>
              <Button variant="outline" asChild>
                <Link to={ux("/components/new")}>
                  <MonitorCheckIcon data-icon="inline-start" />
                  New with URL checks
                </Link>
              </Button>
              <ComponentCreateDialog />
            </>
          ) : undefined
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
        <ComponentsTable
          data={(data?.data ?? []).map(mapComponent)}
          list={list}
          pagination={data?.pagination}
        />
      )}
    </PageContainer>
  );
}
