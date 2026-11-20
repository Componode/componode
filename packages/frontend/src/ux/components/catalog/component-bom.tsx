import * as React from "react"
import { CopyIcon, EllipsisIcon, PackageIcon, SettingsIcon } from "lucide-react"
import { Link } from "react-router-dom"
import { useSession } from "@/api/hooks/auth"
import {
  fetchBomChildren,
  useBomList,
  useBomSummary,
  type BomListParams,
} from "@/api/hooks/bom"
import { toBomEntryView, toBomSummaryView } from "@/api/mappers/bom"
import { facetParam } from "@/api/list-query"
import { useListState } from "@/ux/hooks/use-list-state"
import { ListToolbar, type FilterDef } from "@/ux/components/patterns/list-toolbar"
import { ListPagination } from "@/ux/components/patterns/list-pagination"
import { EmptyState, ErrorState, ForbiddenState, TableSkeleton } from "@/ux/components/patterns/states"
import { MonoValue, RelativeTime } from "@/ux/components/patterns/primitives"
import { BomEvidenceBadge, BomScopeBadge } from "@/ux/components/patterns/status-badge"
import { TreeDisclosure, TreeGrid, type TreeGridRowCtx } from "@/ux/components/patterns/tree-grid"
import { Badge } from "@/ux/components/ui/badge"
import { Button } from "@/ux/components/ui/button"
import { Alert, AlertDescription } from "@/ux/components/ui/alert"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/ux/components/ui/dropdown-menu"
import { Popover, PopoverContent, PopoverTrigger } from "@/ux/components/ui/popover"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/ux/components/ui/select"
import { ToggleGroup, ToggleGroupItem } from "@/ux/components/ui/toggle-group"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ux/components/ui/tooltip"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/ux/components/ui/table"
import { errorMessage, isForbidden } from "@/ux/lib/api-state"
import { BOM_EVIDENCE_META, BOM_SCOPE_META, type BomEvidenceSource, type BomScope } from "@/ux/lib/domain"
import { formatDate, formatNumber } from "@/ux/lib/format"
import { ux } from "@/ux/lib/paths"
import { cn } from "@/ux/lib/utils"
import type { BomEntryView } from "@/ux/lib/view-types"
import type { Component } from "@/ux/lib/view-types"

/**
 * Bill of Materials tab (spec 073, UX-BOM-01…16). Read-only factual
 * inventory: URL-driven filters via useListState, server pagination,
 * merged/tree views, lazy children, freshness + provenance treatments.
 * No advisories column is rendered — not even disabled (UX-BOM-16).
 */

const BOM_SORT_KEYS = ["name", "version", "scope", "ecosystem", "lastReportedAt"] as const
type BomSortKey = (typeof BOM_SORT_KEYS)[number]
type BomFilterKey = "ecosystem" | "scope" | "found" | "depth" | "instance" | "view" | "catalog"

const SCOPE_OPTIONS = (Object.keys(BOM_SCOPE_META) as BomScope[]).map((v) => ({
  value: v,
  label: BOM_SCOPE_META[v].label,
}))
const EVIDENCE_OPTIONS = (Object.keys(BOM_EVIDENCE_META) as BomEvidenceSource[]).map((v) => ({
  value: v,
  label: BOM_EVIDENCE_META[v].label,
}))

function isStale(iso: string | null, thresholdDays: number): boolean {
  if (!iso) return false
  return Date.now() - new Date(iso).getTime() > thresholdDays * 86_400_000
}

function capabilityMarker(details: Component["details"]): { status: string; message?: string } | null {
  const caps = (details as Record<string, unknown> | null)?.capabilities as
    | Record<string, { status?: string; message?: string }>
    | undefined
  const marker = caps?.bomInventory
  return marker && marker.status && marker.status !== "OK" ? (marker as { status: string; message?: string }) : null
}

function LicenseCell({ licenses }: { licenses: string[] }) {
  if (!licenses.length) return <span className="text-sm text-muted-foreground">Unknown</span>
  const [first, ...rest] = licenses
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="font-mono text-xs">{first}</span>
      {rest.length > 0 ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="secondary" className="text-[10px]">+{rest.length}</Badge>
          </TooltipTrigger>
          <TooltipContent>{licenses.join(", ")}</TooltipContent>
        </Tooltip>
      ) : null}
    </span>
  )
}

function PackageCell({ row, ctx }: { row: BomEntryView; ctx?: TreeGridRowCtx }) {
  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      <span className="inline-flex items-center gap-1.5">
        {ctx ? <TreeDisclosure ctx={ctx} /> : null}
        <span
          className="truncate font-medium"
          title={
            row.instanceCount > 0 && row.instanceTotal > 0
              ? `In ${row.instanceCount} of ${row.instanceTotal} instances`
              : row.source
                ? `Reported by ${row.source.name}`
                : undefined
          }
        >
          {row.name}
        </span>
        {!row.direct ? (
          <Badge variant="outline" className="text-[10px] text-muted-foreground">
            Transitive
          </Badge>
        ) : null}
      </span>
      <span className="max-w-72 truncate">
        <MonoValue value={row.purl} copy={false} className="text-xs" />
      </span>
      {row.parentName ? (
        <span className="text-xs text-muted-foreground">in {row.parentName}</span>
      ) : null}
    </span>
  )
}

function RowMenu({ row }: { row: BomEntryView }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-xs" aria-label={`Actions for ${row.name}`}>
          <EllipsisIcon aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => void navigator.clipboard?.writeText(row.purl)}>
          <CopyIcon data-icon="inline-start" /> Copy purl
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const COLS = 6

function BomTableHead() {
  return (
    <TableHeader>
      <TableRow className="bg-muted/40 hover:bg-muted/40">
        <TableHead className="pl-4">Package</TableHead>
        <TableHead>Version</TableHead>
        <TableHead>Scope</TableHead>
        <TableHead>Licenses</TableHead>
        <TableHead>Found in</TableHead>
        <TableHead className="w-10 pr-4"><span className="sr-only">Actions</span></TableHead>
      </TableRow>
    </TableHeader>
  )
}

function bomCells(row: BomEntryView, ctx?: TreeGridRowCtx) {
  return (
    <>
      <TableCell className="pl-4"><PackageCell row={row} ctx={ctx} /></TableCell>
      <TableCell className="font-mono text-xs">{row.version ?? "—"}</TableCell>
      <TableCell><BomScopeBadge value={row.scope} /></TableCell>
      <TableCell><LicenseCell licenses={row.licenses} /></TableCell>
      <TableCell><BomEvidenceBadge value={row.evidenceSource} detail={row.evidenceDetail} /></TableCell>
      <TableCell className="pr-4 text-right"><RowMenu row={row} /></TableCell>
    </>
  )
}

export function ComponentBomTab({ component }: { component: Component }) {
  const { data: user } = useSession()
  const list = useListState<BomSortKey, BomFilterKey>({
    sortKeys: BOM_SORT_KEYS,
    defaultSort: "name",
    filters: {
      ecosystem: { default: "all" },
      scope: { default: "all", values: SCOPE_OPTIONS.map((o) => o.value) },
      found: { default: "all", values: EVIDENCE_OPTIONS.map((o) => o.value) },
      depth: { default: "all", values: ["all", "direct", "transitive"] },
      instance: { default: "all" },
      view: { default: "flat", values: ["flat", "tree"] },
      // Accepted for URL round-trip; the filter UI lands with catalog
      // curation (Phase 2) — the API ignores it in Phase 1.
      catalog: { default: "all", values: ["all", "linked", "suggested", "none"] },
    },
  })

  const instanceId = list.filters.instance === "all" ? undefined : list.filters.instance
  const summaryQ = useBomSummary(component.id, instanceId)
  const summary = summaryQ.data ? toBomSummaryView(summaryQ.data) : null

  const filtersActive =
    list.search !== "" ||
    (["ecosystem", "scope", "found", "depth", "catalog"] as const).some(
      (k) => list.filters[k] !== "all",
    )
  // UX-BOM-11: filters force flat — announced, and the user can switch back.
  const treeRequested = list.filters.view === "tree"
  const effectiveTree = treeRequested && !filtersActive && !instanceId

  const apiParams: BomListParams = {
    page: list.page,
    pageSize: list.pageSize,
    sort: list.sort ?? "name",
    order: list.order,
    search: list.search || undefined,
    ecosystem: facetParam(list, "ecosystem"),
    scope: facetParam(list, "scope"),
    found: facetParam(list, "found"),
    direct:
      list.filters.depth === "direct"
        ? true
        : list.filters.depth === "transitive"
          ? false
          : undefined,
    instanceId,
    view: effectiveTree ? "tree" : "flat",
  }
  const listQ = useBomList(component.id, apiParams)
  const page = listQ.data
  const rows = React.useMemo(() => (page?.data ?? []).map(toBomEntryView), [page])

  const stale = isStale(summary?.lastReportedAt ?? null, summary?.staleThresholdDays ?? 7)
  const soleSource = summary && summary.sources.length === 1 ? summary.sources[0] : null
  const degraded = capabilityMarker(component.details)
  const showInstancePicker = (summary?.instances.length ?? 0) > 1
  const showTreeToggle = summary?.hasNesting === true

  const filters: FilterDef[] = [
    {
      id: "ecosystem",
      label: "Ecosystem",
      value: list.filters.ecosystem,
      onChange: (v) => list.setFilter("ecosystem", v),
      options: (summary?.ecosystems ?? []).map((e) => ({ value: e, label: e })),
    },
    {
      id: "scope",
      label: "Scope",
      value: list.filters.scope,
      onChange: (v) => list.setFilter("scope", v),
      options: SCOPE_OPTIONS,
    },
    {
      id: "found",
      label: "Found in",
      value: list.filters.found,
      onChange: (v) => list.setFilter("found", v),
      options: EVIDENCE_OPTIONS,
    },
    {
      id: "depth",
      label: "Depth",
      value: list.filters.depth,
      onChange: (v) => list.setFilter("depth", v),
      options: [
        { value: "all", label: "All" },
        { value: "direct", label: "Direct" },
        { value: "transitive", label: "Transitive" },
      ],
    },
  ]

  const loadChildren = React.useCallback(
    (parentId: string, childPage: number) =>
      fetchBomChildren(component.id, parentId, childPage).then((res) => ({
        ...res,
        data: res.data.map(toBomEntryView),
      })),
    [component.id],
  )

  if (listQ.isError) {
    if (isForbidden(listQ.error)) return <ForbiddenState />
    return <ErrorState description={errorMessage(listQ.error)} onRetry={() => void listQ.refetch()} />
  }

  const toolbarEnd = (
    <>
      {showInstancePicker ? (
        <Select value={list.filters.instance} onValueChange={(v) => list.setFilter("instance", v)}>
          <SelectTrigger aria-label="Instance" className="w-auto min-w-40">
            <span className="text-muted-foreground">Instance:</span>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="all">All (merged)</SelectItem>
              {summary!.instances.map((i) => (
                <SelectItem key={i.id} value={i.id}>
                  {i.name}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      ) : null}
      {showTreeToggle ? (
        <ToggleGroup
          type="single"
          value={effectiveTree ? "tree" : "flat"}
          onValueChange={(v) => {
            if (v === "flat" || v === "tree") list.setFilter("view", v)
          }}
          aria-label="View"
        >
          <ToggleGroupItem value="flat" aria-label="Flat view">Flat</ToggleGroupItem>
          <ToggleGroupItem value="tree" aria-label="Tree view">Tree</ToggleGroupItem>
        </ToggleGroup>
      ) : null}
      {/* Export menu slot — lands with US4 (streamed export endpoint). */}
    </>
  )

  return (
    <div className="flex flex-col gap-4">
      {/* Summary strip — five facts (UX-BOM layout step 2). */}
      {summary ? (
        <dl className="flex flex-wrap items-center gap-x-8 gap-y-2 text-sm">
          <div className="flex items-baseline gap-1.5">
            <dt className="text-muted-foreground">Packages</dt>
            <dd className="tabular font-medium">{formatNumber(summary.total)}</dd>
          </div>
          <div className="flex items-baseline gap-1.5">
            <dt className="text-muted-foreground">Direct</dt>
            <dd className="tabular font-medium">{formatNumber(summary.direct)}</dd>
          </div>
          <div className="flex items-baseline gap-1.5">
            <dt className="text-muted-foreground">Ecosystems</dt>
            <dd className="font-medium">{summary.ecosystems.length ? summary.ecosystems.join(", ") : "—"}</dd>
          </div>
          <div className="flex items-baseline gap-1.5">
            <dt className="text-muted-foreground">Licenses</dt>
            <dd className="tabular font-medium">{summary.licenseCount}</dd>
          </div>
          <div className="flex items-baseline gap-1.5">
            <dt className="text-muted-foreground">Last reported</dt>
            <dd>
              {summary.sources.length > 1 ? (
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className={cn(
                        "font-medium underline decoration-dotted underline-offset-2",
                        stale && "text-warning",
                      )}
                      title={
                        stale && summary.lastReportedAt
                          ? `No import run has reported this inventory since ${formatDate(summary.lastReportedAt)}.`
                          : undefined
                      }
                    >
                      <RelativeTime iso={summary.lastReportedAt} />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-72 p-0">
                    <ul className="divide-y">
                      {summary.sources.map((s) => (
                        <li key={s.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                          <Link to={ux(`/sources/${s.id}`)} className="truncate text-primary hover:underline">
                            {s.name}
                          </Link>
                          <RelativeTime iso={s.lastReportedAt} className="text-muted-foreground" />
                        </li>
                      ))}
                    </ul>
                  </PopoverContent>
                </Popover>
              ) : soleSource ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Link
                      to={ux(`/sources/${soleSource.id}`)}
                      className={cn("font-medium hover:underline", stale && "text-warning")}
                    >
                      <RelativeTime iso={summary.lastReportedAt} />
                    </Link>
                  </TooltipTrigger>
                  <TooltipContent>
                    {stale && summary.lastReportedAt
                      ? `No import run has reported this inventory since ${formatDate(summary.lastReportedAt)}.`
                      : `by ${soleSource.name}`}
                  </TooltipContent>
                </Tooltip>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </dd>
          </div>
        </dl>
      ) : null}

      {degraded ? (
        <Alert>
          <AlertDescription>
            Dependency inventory is degraded on this component's source
            {degraded.message ? `: ${degraded.message}` : "."} Entries shown
            may be incomplete.
          </AlertDescription>
        </Alert>
      ) : null}

      {treeRequested && filtersActive ? (
        <p className="text-sm text-muted-foreground" aria-live="polite">
          Switched to flat view: filters apply to all packages.
        </p>
      ) : null}

      <ListToolbar
        query={list.search}
        onQueryChange={list.setSearch}
        placeholder="Search packages…"
        filters={filters}
        end={toolbarEnd}
        resultCount={rows.length}
        total={page?.pagination.total ?? 0}
      />

      {listQ.isPending ? (
        <TableSkeleton rows={8} columns={COLS} />
      ) : rows.length === 0 ? (
        filtersActive || instanceId ? (
          <EmptyState
            icon={PackageIcon}
            title="No packages match the current filters"
            description="Adjust the search or clear filters to see the full inventory."
            action={
              <Button variant="outline" onClick={list.reset}>
                Clear filters
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={PackageIcon}
            title="No bill of materials reported"
            description="Inventory appears here when an importer reports this component's packages — enable dependency collection on its importer or ingest an SBOM file."
            action={
              user?.role === "ADMIN" ? (
                <Button variant="outline" asChild>
                  <Link to={ux("/importers")}>
                    <SettingsIcon data-icon="inline-start" /> Configure importer
                  </Link>
                </Button>
              ) : undefined
            }
          />
        )
      ) : effectiveTree ? (
        <div className={cn("rounded-md border", listQ.isFetching && "opacity-70")}>
          <TreeGrid
            ariaLabel="Bill of materials"
            head={<BomTableHead />}
            rows={rows}
            colSpan={COLS}
            loadChildren={loadChildren}
            renderRow={(row, ctx) => bomCells(row, ctx)}
          />
        </div>
      ) : (
        <div className={cn("rounded-md border", listQ.isFetching && "opacity-70")}>
          <Table>
            <BomTableHead />
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>{bomCells(row)}</TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {page && rows.length > 0 ? (
        <>
          <ListPagination
            page={list.page}
            pageSize={list.pageSize}
            total={page.pagination.total}
            pageCount={page.pagination.pageCount}
            onPageChange={list.setPage}
            onPageSizeChange={list.setPageSize}
          />
          <p className="text-xs text-muted-foreground">
            Inventory only. Componode does not scan for vulnerabilities.
          </p>
        </>
      ) : null}
    </div>
  )
}
