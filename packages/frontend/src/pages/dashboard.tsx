import { useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  Download,
  FileText,
  Link2,
  Package,
  Boxes,
  Layers,
  Rocket,
  Unlink,
  UserX,
} from "lucide-react";
import { useDashboardSummary } from "@/api/hooks/dashboard";
import { useSession } from "@/api/hooks/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CardGridSkeleton, TableSkeleton } from "@/components/states/skeletons";
import { ErrorState } from "@/components/states/error-state";
import { StatusBadge } from "@/components/states/status-badge";
import { SunsetBadge } from "@/components/metadata/sunset-badge";
import { ImporterRunChart } from "@/components/importer-run-chart";
import { PlatformCandidatesSection } from "@/components/platform-candidates";
import { PromoteToPlatformDialog } from "@/components/products/promote-to-platform-dialog";
import { relativeTime, absoluteTime } from "@/lib/format";
import type { AttentionItem, PlatformCandidate } from "@/api/types";

const ATTENTION_LABEL: Record<AttentionItem["kind"], string> = {
  FAILED_RUN: "Importer run failed",
  INSTANCE_ERROR: "Instance in error",
  INSTANCE_GONE: "Instance gone",
  PRODUCT_ERROR: "Product affected by error",
  SUNSET_OVERDUE_PRODUCT: "Product sunset overdue",
  SUNSET_OVERDUE_COMPONENT: "Component sunset overdue",
  OFFLINE_AGENT: "Import Agent offline with bound configs",
};

function attentionBadge(item: AttentionItem) {
  if (item.kind.startsWith("SUNSET_OVERDUE_")) {
    // The SunsetBadge derivation renders "Sunset overdue" for a past date —
    // same semantic, no new status color (spec 023, docs/ux.md §6).
    return <SunsetBadge sunsetAt={item.at} lifecycle="ACTIVE" />;
  }
  return (
    <StatusBadge
      status={
        item.kind === "FAILED_RUN"
          ? "FAILED"
          : item.kind === "INSTANCE_ERROR" || item.kind === "PRODUCT_ERROR"
            ? "ERROR"
            : item.kind === "OFFLINE_AGENT"
              ? "OFFLINE"
              : "GONE"
      }
    />
  );
}

/**
 * Health-and-attention dashboard per docs/ux.md §10: attention-needed first
 * (hidden when empty), stat cards, per-importer last runs; a getting-started
 * strip replaces everything on an empty install.
 */
export function DashboardPage() {
  const { data, isPending, isFetching, error, refetch } = useDashboardSummary();
  const { data: user } = useSession();
  const [promoting, setPromoting] = useState<PlatformCandidate | null>(null);

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

  const { counts, attention, lastRuns, lastImportAt, coverage } = data;
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
                  {attention.map((item, i) => {
                    // Agent surfaces are agent:read (ADMIN) — non-admins get
                    // the attention row as plain text per FR-023.
                    const linkable =
                      item.kind !== "OFFLINE_AGENT" || user?.role === "ADMIN";
                    const row = (
                      <>
                        <span className="flex items-center gap-3 min-w-0">
                          {attentionBadge(item)}
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
                      </>
                    );
                    const cls =
                      "flex items-center justify-between px-4 py-2.5 text-sm";
                    return linkable ? (
                      <Link
                        key={`${item.kind}-${item.href}-${i}`}
                        to={item.href}
                        className={`${cls} hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
                      >
                        {row}
                      </Link>
                    ) : (
                      <div key={`${item.kind}-${item.href}-${i}`} className={cls}>
                        {row}
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            </section>
          )}

          <PlatformCandidatesSection onPromote={setPromoting} />

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

          {/* Spec 023 US1: catalog coverage — every figure links to its
              filtered worklist (US2); "—" renders on zero denominator. */}
          <section aria-labelledby="coverage-heading">
            <h2 id="coverage-heading" className="mb-3 text-lg font-semibold">
              Catalog coverage
            </h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
              <StatCard
                icon={Link2}
                label="Components wired"
                total={
                  coverage.components.wiredPct === null
                    ? "—"
                    : `${coverage.components.wiredPct}%`
                }
                detail={`${coverage.components.wired} wired · ${
                  coverage.components.active - coverage.components.wired
                } unwired of ${coverage.components.active}`}
                to="/components?wired=unwired"
              />
              <StatCard
                icon={UserX}
                label="Missing owner"
                total={coverage.products.missingOwner}
                detail={`of ${coverage.products.total} products`}
                to="/products?missing=owner"
              />
              <StatCard
                icon={Unlink}
                label="Missing dependencies"
                total={coverage.products.missingDependencies}
                detail={`of ${coverage.products.total} products`}
                to="/products?missing=dependencies"
              />
              <StatCard
                icon={FileText}
                label="Missing description"
                total={coverage.products.missingDescription}
                detail={`of ${coverage.products.total} products`}
                to="/products?missing=description"
              />
            </div>
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
                  <>
                    <ImporterRunChart
                      configIds={lastRuns.map((r) => r.configId)}
                    />
                    <ul className="divide-y border-t">
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
                  </>
                )}
              </CardContent>
            </Card>
          </section>
        </>
      )}

      {promoting && (
        <PromoteToPlatformDialog
          open
          onClose={() => setPromoting(null)}
          component={{
            id: promoting.component.id,
            name: promoting.component.name,
          }}
        />
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
  total: number | string;
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
          <span className="icon-well">
            <Icon className="h-4 w-4" aria-hidden="true" />
          </span>
        </CardHeader>
        <CardContent>
          <p className="text-3xl font-bold">
            {typeof total === "number" ? total.toLocaleString() : total}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
        </CardContent>
      </Card>
    </Link>
  );
}
