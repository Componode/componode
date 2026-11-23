import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  usePackageConsumers,
  CONSUMERS_PAGE_SIZE,
} from "@/api/hooks/packages";
import { ListPagination } from "@/ux/components/patterns/list-pagination";
import { BomScopeBadge } from "@/ux/components/patterns/status-badge";
import { RelativeTime } from "@/ux/components/patterns/primitives";
import { ErrorState } from "@/ux/components/patterns/states";
import { Badge } from "@/ux/components/ui/badge";
import { Skeleton } from "@/ux/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/ux/components/ui/table";
import type { BomDependencyScope, Paginated } from "@componode/core";
import { errorMessage } from "@/ux/lib/api-state";
import { CATEGORY_LABELS } from "@/ux/lib/domain";
import { flags } from "@/ux/lib/flags";
import { ux } from "@/ux/lib/paths";

/**
 * Shared consumers-table row — the common shape of `PackageConsumerListItem`
 * and `ProductPackageConsumerListItem` (spec 080): one row per (component,
 * version, scope) reporting a package.
 */
export interface ConsumerTableRow {
  component: { id: string; slug: string; name: string; category: string };
  version: string | null;
  scope: BomDependencyScope;
  direct: boolean;
  lastReportedAt: string;
}

/**
 * Shared consumers readout (spec 074 US2, parameterized for spec 080): the
 * loading/error/empty states, version-filter line, (component, version,
 * scope) table with the component deep-link into `?tab=bom&q={purl}`, and
 * fixed-size inner pagination. Callers own the query and may add columns:
 * `attributionOf` renders a reachability cell (product roll-up) and
 * `renderExtras` appends badges after Direct/Transitive (edge provenance).
 */
export function ConsumersReadout<T extends ConsumerTableRow>({
  data,
  isPending,
  error,
  refetch,
  page,
  onPageChange,
  pageSize = CONSUMERS_PAGE_SIZE,
  purl,
  version,
  onVersionFilter,
  emptyText,
  attributionOf,
  renderExtras,
}: {
  data?: Paginated<T>;
  isPending: boolean;
  error: unknown;
  refetch: () => void;
  page: number;
  onPageChange: (page: number) => void;
  /** Inner panel page size — callers pass their own constant (spec 080). */
  pageSize?: number;
  purl: string;
  version?: string;
  onVersionFilter?: (version: string | undefined) => void;
  emptyText?: string;
  attributionOf?: (row: T) => ReactNode;
  renderExtras?: (row: T) => ReactNode;
}) {
  if (isPending) {
    return (
      <div className="flex flex-col gap-2 p-4">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-8 rounded-md" />
        ))}
      </div>
    );
  }
  if (error) {
    return (
      <div className="p-4">
        <ErrorState
          title="Consumers unavailable"
          description={errorMessage(error)}
          onRetry={refetch}
        />
      </div>
    );
  }

  const rows = data?.data ?? [];
  if (rows.length === 0) {
    return (
      <p className="p-4 text-sm text-muted-foreground">
        {emptyText ??
          `No components report this package${version ? ` at version ${version}` : ""}`}
      </p>
    );
  }

  return (
    <div className="p-4">
      {version && (
        <p className="mb-2 text-sm text-muted-foreground" data-testid="consumers-version-filter">
          Filtered to version <code className="font-mono">{version}</code>
        </p>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Component</TableHead>
            <TableHead>Category</TableHead>
            {attributionOf && <TableHead>Reachable via</TableHead>}
            <TableHead>Version</TableHead>
            <TableHead>Scope</TableHead>
            <TableHead>Dependency</TableHead>
            <TableHead>Last reported</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((c) => {
            const v = c.version;
            return (
            <TableRow key={`${c.component.id}-${c.version}-${c.scope}`}>
              <TableCell>
                <Link
                  to={ux(
                    `/components/${c.component.slug}?tab=bom&q=${encodeURIComponent(purl)}`,
                  )}
                  className="font-medium hover:underline"
                >
                  {c.component.name}
                </Link>
              </TableCell>
              <TableCell className="text-muted-foreground">
                {CATEGORY_LABELS[c.component.category] ?? c.component.category}
              </TableCell>
              {attributionOf && (
                <TableCell className="text-muted-foreground">
                  {attributionOf(c)}
                </TableCell>
              )}
              <TableCell>
                {onVersionFilter && v ? (
                  <button
                    type="button"
                    className="hover:underline"
                    onClick={() =>
                      onVersionFilter(version === v ? undefined : v)
                    }
                    data-testid={`consumer-version-${v}`}
                  >
                    <code className="font-mono text-xs">{v}</code>
                  </button>
                ) : (
                  <code className="font-mono text-xs">{v ?? "—"}</code>
                )}
              </TableCell>
              <TableCell><BomScopeBadge value={c.scope} /></TableCell>
              <TableCell>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant={c.direct ? "default" : "outline"}>
                    {c.direct ? "Direct" : "Transitive"}
                  </Badge>
                  {renderExtras?.(c)}
                </div>
              </TableCell>
              <TableCell className="tabular text-muted-foreground">
                <RelativeTime iso={c.lastReportedAt} />
              </TableCell>
            </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {data && data.pagination.total > pageSize && (
        <div className="mt-2">
          <ListPagination
            page={page}
            pageSize={pageSize}
            total={data.pagination.total}
            pageCount={data.pagination.pageCount}
            onPageChange={onPageChange}
            // Fixed-size inner panel — no page-size picker.
            onPageSizeChange={() => {}}
          />
        </div>
      )}
    </div>
  );
}

/**
 * Spec 074 US2 — expanded consumers panel inside a /packages row: one row
 * per (component, version, scope) reporting the package, paginated via
 * `GET /packages/consumers`. The component cell deep-links into that
 * component's BOM tab with the package purl as its search (`?tab=bom&q=`),
 * so the user lands on the matching inventory rows.
 */
export function PackageConsumersPanel({
  purl,
  version,
  onVersionFilter,
}: {
  purl: string;
  version?: string;
  onVersionFilter?: (version: string | undefined) => void;
}) {
  const [page, setPage] = useState(1);
  // A chip re-filter starts the inner list back on page 1.
  useEffect(() => setPage(1), [purl, version]);
  const { data, isPending, error, refetch } = usePackageConsumers(purl, {
    version,
    page,
    pageSize: CONSUMERS_PAGE_SIZE,
  });

  return (
    <ConsumersReadout
      data={data}
      isPending={isPending}
      error={error}
      refetch={() => void refetch()}
      page={page}
      onPageChange={setPage}
      purl={purl}
      version={version}
      onVersionFilter={onVersionFilter}
      renderExtras={(c) => (
        <>
          {/* Spec 076 / UX-EDGE-01 — provenance badge on the
              consumer→library edge when one exists, with the
              same Source/run links the relationships panel shows
              (SC-001). */}
          {flags.bomImporterEdges && c.edge && (
            <Badge
              variant={c.edge.provenance === "IMPORTER" ? "default" : "outline"}
              data-testid={`consumer-edge-${c.component.id}`}
            >
              {c.edge.provenance === "IMPORTER" ? "Added by importer" : "Curated"}
            </Badge>
          )}
          {flags.bomImporterEdges &&
            c.edge?.provenance === "IMPORTER" &&
            c.edge.importerSourceId && (
              <Link
                to={ux(`/sources/${c.edge.importerSourceId}`)}
                className="text-xs font-medium text-primary hover:underline"
              >
                Source
              </Link>
            )}
          {flags.bomImporterEdges &&
            c.edge?.provenance === "IMPORTER" &&
            c.edge.importerConfigId &&
            c.edge.importRunId && (
              <Link
                to={ux(
                  `/importers/${c.edge.importerConfigId}/runs/${c.edge.importRunId}`,
                )}
                className="text-xs font-medium text-primary hover:underline"
              >
                Import run
              </Link>
            )}
        </>
      )}
    />
  );
}
