import { Link } from "react-router-dom";
import {
  AlertTriangle,
  Download,
  Package,
  Boxes,
  Layers,
  Rocket,
} from "lucide-react";
import { useDashboardSummary } from "@/api/hooks/dashboard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CardGridSkeleton, TableSkeleton } from "@/components/states/skeletons";
import { ErrorState } from "@/components/states/error-state";
import { StatusBadge } from "@/components/states/status-badge";
import { relativeTime, absoluteTime } from "@/lib/format";
import type { AttentionItem } from "@/api/types";

const ATTENTION_LABEL: Record<AttentionItem["kind"], string> = {
  FAILED_RUN: "Importer run failed",
  INSTANCE_ERROR: "Instance in error",
  INSTANCE_GONE: "Instance gone",
};

/**
 * Health-and-attention dashboard per docs/ux.md §10: attention-needed first
 * (hidden when empty), stat cards, per-importer last runs; a getting-started
 * strip replaces everything on an empty install.
 */
export function DashboardPage() {
  const { data, isPending, isFetching, error, refetch } = useDashboardSummary();

  if (isPending) {
    return (
      <main className="p-6 space-y-6">
        <CardGridSkeleton cards={3} />
        <TableSkeleton rows={4} columns={4} />
      </main>
    );
  }

  if (error || !data) {
    return (
      <main className="p-6">
        <ErrorState error={error} onRetry={() => refetch()} />
      </main>
    );
  }

  const { counts, attention, lastRuns, lastImportAt } = data;
  const isEmptyInstall =
    counts.components.total === 0 && lastRuns.length === 0;

  return (
    <main className="p-6 space-y-8">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground">
            Catalog health at a glance{lastImportAt ? ` — last import ${relativeTime(lastImportAt)}` : ""}
          </p>
        </div>
        {isFetching && (
          <span className="text-xs text-muted-foreground" aria-live="polite">
            Updating…
          </span>
        )}
      </div>

      {isEmptyInstall ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-12 text-center">
            <Rocket className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
            <h2 className="text-lg font-semibold">Get started with Componode</h2>
            <p className="text-sm text-muted-foreground max-w-md">
              Your catalog is empty. Configure an importer to pull in components
              from GitHub, AWS, Azure, Kubernetes, or an API endpoint.
            </p>
            <Link
              to="/importers"
              className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              Configure your first importer
            </Link>
          </CardContent>
        </Card>
      ) : (
        <>
          {attention.length > 0 && (
            <section aria-labelledby="attention-heading">
              <h2
                id="attention-heading"
                className="mb-3 flex items-center gap-2 text-lg font-semibold"
              >
                <AlertTriangle className="h-5 w-5 text-warning" aria-hidden="true" />
                Attention needed
              </h2>
              <Card>
                <CardContent className="divide-y p-0">
                  {attention.map((item, i) => (
                    <Link
                      key={`${item.kind}-${item.href}-${i}`}
                      to={item.href}
                      className="flex items-center justify-between px-4 py-2.5 text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="flex items-center gap-3 min-w-0">
                        <StatusBadge
                          status={
                            item.kind === "FAILED_RUN"
                              ? "FAILED"
                              : item.kind === "INSTANCE_ERROR"
                                ? "ERROR"
                                : "GONE"
                          }
                        />
                        <span className="truncate">
                          <span className="text-muted-foreground">
                            {ATTENTION_LABEL[item.kind]}:
                          </span>{" "}
                          {item.label}
                        </span>
                      </span>
                      <span
                        className="text-xs text-muted-foreground shrink-0"
                        title={absoluteTime(item.at)}
                      >
                        {relativeTime(item.at)}
                      </span>
                    </Link>
                  ))}
                </CardContent>
              </Card>
            </section>
          )}

          <section aria-label="Catalog stats" className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <StatCard
              icon={Package}
              label="Products"
              total={counts.products.total}
              detail={Object.entries(counts.products.byType)
                .filter(([, n]) => n > 0)
                .map(([k, n]) => `${n} ${k.toLowerCase().replaceAll("_", " ")}`)
                .join(" · ")}
              to="/products"
            />
            <StatCard
              icon={Boxes}
              label="Components"
              total={counts.components.total}
              detail={`${counts.components.byLifecycle.ACTIVE ?? 0} active · ${counts.components.byLifecycle.RETIRED ?? 0} retired`}
              to="/components"
            />
            <StatCard
              icon={Layers}
              label="Instances"
              total={counts.instances.total}
              detail={`${counts.instances.byStatus.RUNNING ?? 0} running · ${counts.instances.byStatus.ERROR ?? 0} error`}
              to="/components"
            />
          </section>

          <section aria-labelledby="importers-heading">
            <h2 id="importers-heading" className="mb-3 text-lg font-semibold">
              Importer status
            </h2>
            <Card>
              <CardContent className="p-0">
                {lastRuns.length === 0 ? (
                  <p className="p-6 text-sm text-muted-foreground">
                    No importers configured yet.{" "}
                    <Link to="/importers" className="text-primary hover:underline">
                      Configure one
                    </Link>
                  </p>
                ) : (
                  <ul className="divide-y">
                    {lastRuns.map((run) => (
                      <li
                        key={run.configId}
                        className="flex items-center justify-between px-4 py-2.5 text-sm"
                      >
                        <span className="min-w-0 truncate">
                          <Link
                            to="/importers"
                            className="font-medium hover:underline"
                          >
                            {run.configLabel}
                          </Link>
                          <span className="ml-2 hidden text-xs text-muted-foreground md:inline">
                            {run.importerName}
                          </span>
                        </span>
                        <span className="flex items-center gap-3 shrink-0">
                          {run.status ? (
                            <>
                              <StatusBadge status={run.status} />
                              <span className="text-xs text-muted-foreground">
                                {run.assetsProcessed} processed ·{" "}
                                {run.assetsCreated} created ·{" "}
                                {run.assetsUpdated} updated
                              </span>
                              <span
                                className="text-xs text-muted-foreground"
                                title={absoluteTime(run.completedAt)}
                              >
                                {relativeTime(run.completedAt)}
                              </span>
                              {run.runId && (
                                <Link
                                  to={`/importers/${run.configId}/runs/${run.runId}`}
                                  className="text-xs text-primary hover:underline"
                                >
                                  View run
                                </Link>
                              )}
                            </>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              Never run
                            </span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </section>
        </>
      )}
    </main>
  );
}

function StatCard({
  icon: Icon,
  label,
  total,
  detail,
  to,
}: {
  icon: typeof Package;
  label: string;
  total: number;
  detail: string;
  to: string;
}) {
  return (
    <Link to={to} className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg">
      <Card className="h-full transition-colors hover:border-primary">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            {label}
          </CardTitle>
          <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        </CardHeader>
        <CardContent>
          <p className="text-3xl font-bold">{total.toLocaleString()}</p>
          <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
        </CardContent>
      </Card>
    </Link>
  );
}
