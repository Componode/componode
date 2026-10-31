import { PlusIcon, UploadCloudIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { useSession } from "@/api/hooks/auth";
import { useDashboardSummary } from "@/api/hooks/dashboard";
import { useImporterConfigs } from "@/api/hooks/importers";
import { useActivityFeed } from "@/api/hooks/audit";
import { mapActivityItem, mapAttentionItem, mapCoverage } from "@/api/mappers/dashboard";
import { AttentionList } from "@/ux/components/dashboard/attention-list";
import { CoverageCard } from "@/ux/components/dashboard/coverage-card";
import { InstanceHealthCard } from "@/ux/components/dashboard/instance-health-card";
import { RecentActivity } from "@/ux/components/dashboard/recent-activity";
import { StatGrid } from "@/ux/components/dashboard/stat-grid";
import { PageContainer, PageHeader } from "@/ux/components/patterns/page-header";
import { ErrorState } from "@/ux/components/patterns/states";
import { Button } from "@/ux/components/ui/button";
import { Skeleton } from "@/ux/components/ui/skeleton";
import { ux } from "@/ux/lib/paths";

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export function UxIndexPage() {
  const session = useSession();
  const summary = useDashboardSummary();
  const configs = useImporterConfigs();
  const activity = useActivityFeed({ limit: 5 });

  const firstName = session.data?.displayName?.split(" ")[0] ?? session.data?.username ?? null;

  return (
    <PageContainer>
      <PageHeader
        title={firstName ? `${greeting()}, ${firstName}` : greeting()}
        description="What changed across your catalog since your last visit, and what needs a decision."
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to={ux("/importers")}>
                <UploadCloudIcon data-icon="inline-start" />
                Run import
              </Link>
            </Button>
            <Button asChild>
              <Link to={ux("/products/new")}>
                <PlusIcon data-icon="inline-start" />
                New product
              </Link>
            </Button>
          </>
        }
      />

      {summary.isPending || configs.isPending ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
      ) : summary.error || configs.error ? (
        <ErrorState
          title="Dashboard unavailable"
          description={(summary.error ?? configs.error)?.message}
          onRetry={() => {
            void summary.refetch();
            void configs.refetch();
          }}
        />
      ) : (
        <>
          <StatGrid
            counts={{
              products: summary.data.counts.products.total,
              components: summary.data.counts.components.total,
              instances: summary.data.counts.instances.total,
              importers: configs.data.configs.filter((c) => c.enabled).length,
            }}
            deltas={summary.data.deltas}
            importerIssues={summary.data.importerIssues}
          />
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="flex flex-col gap-6 lg:col-span-2">
              <AttentionList items={summary.data.attention.map(mapAttentionItem)} />
              {activity.isPending ? (
                <Skeleton className="h-64 rounded-xl" />
              ) : (
                <RecentActivity events={(activity.data?.items ?? []).map(mapActivityItem)} />
              )}
            </div>
            <div className="flex flex-col gap-6">
              <InstanceHealthCard byStatus={summary.data.counts.instances.byStatus} />
              <CoverageCard coverage={mapCoverage(summary.data.coverage)} />
            </div>
          </div>
        </>
      )}
    </PageContainer>
  );
}
