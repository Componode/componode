import * as React from "react"
import { Link } from "react-router-dom"
import {
  CheckIcon,
  ChevronDownIcon,
  HistoryIcon,
  SparklesIcon,
  XIcon,
} from "lucide-react"
import { toast } from "sonner"
import { BOM_SUGGESTION_REASON_META, type BomSuggestionReason } from "@componode/core"
import type {
  DependencySuggestionGroup,
  DependencySuggestionQueueItem,
} from "@/api/types"
import {
  useAcceptDependencySuggestion,
  useBulkDecideDependencies,
  useDependencyGroups,
  useDependencySuggestions,
  useDismissDependencySuggestion,
  type DependencySuggestionsFilters,
} from "@/api/hooks/bom-curation"
import { useSession } from "@/api/hooks/auth"
import { MonoValue, RelativeTime } from "@/ux/components/patterns/primitives"
import { EmptyState, ErrorState } from "@/ux/components/patterns/states"
import { StatusBadge } from "@/ux/components/patterns/status-badge"
import { Badge } from "@/ux/components/ui/badge"
import { Button } from "@/ux/components/ui/button"
import { Card, CardContent } from "@/ux/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ux/components/ui/dialog"
import { Skeleton } from "@/ux/components/ui/skeleton"
import { ListPagination } from "@/ux/components/patterns/list-pagination"
import {
  ListSortSelect,
  type ListSortOption,
} from "@/ux/components/patterns/list-sort-select"
import { useClampPage } from "@/ux/hooks/use-clamp-page"
import { canAccess } from "@/ux/lib/nav"
import { errorMessage } from "@/ux/lib/api-state"
import type { Tone } from "@/ux/lib/domain"
import { ux } from "@/ux/lib/paths"
import { cn } from "@/ux/lib/utils"

/**
 * Spec 075 / UX-SUG-03…08 — the `kind=dependency` segment of /suggestions:
 * pending rows grouped per library (childComponent), per-parent rows on
 * expand, per-row and guarded bulk decisions. Decisions are terminal
 * (ADR-113) — there is no undo, so bulk actions confirm first.
 */

const STATUS_TONE: Record<string, { tone: Tone; label: string }> = {
  ACCEPTED: { tone: "success", label: "Accepted" },
  DISMISSED: { tone: "neutral", label: "Dismissed" },
  SUPERSEDED: { tone: "warning", label: "Superseded" },
};

function ReasonBadge({ reason }: { reason: BomSuggestionReason }) {
  return (
    <Badge variant={reason === "PURL_EXACT" ? "secondary" : "outline"}>
      {BOM_SUGGESTION_REASON_META[reason].label}
    </Badge>
  )
}

/** One pending row inside an expanded group — one decision per row. */
function PendingParentRow({
  item,
  canDecide,
  pending,
}: {
  item: DependencySuggestionQueueItem
  canDecide: boolean
  pending: boolean
}) {
  const accept = useAcceptDependencySuggestion()
  const dismiss = useDismissDependencySuggestion()
  const decide = (accepted: boolean) => {
    const mutation = accepted ? accept : dismiss
    mutation.mutate(item.id, {
      onSuccess: () =>
        toast(accepted ? "Dependency added" : "Suggestion dismissed", {
          description: `${item.parentComponent.name} depends on ${item.childComponent.name}`,
        }),
      onError: (e) => toast.error(errorMessage(e)),
    })
  }
  return (
    <li className="flex flex-col gap-2 rounded-lg border px-3 py-2 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-sm">
        <Link
          to={ux(`/components/${item.parentComponent.slug}`)}
          className="font-medium hover:underline"
        >
          {item.parentComponent.name}
        </Link>
        {item.reason ? <ReasonBadge reason={item.reason} /> : null}
      </div>
      {canDecide ? (
        <div className="flex shrink-0 gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => decide(false)}
          >
            <XIcon data-icon="inline-start" />
            Dismiss
          </Button>
          <Button size="sm" disabled={pending} onClick={() => decide(true)}>
            <CheckIcon data-icon="inline-start" />
            Accept
          </Button>
        </div>
      ) : null}
    </li>
  )
}

function DependencyGroupCard({
  group,
  canDecide,
}: {
  group: DependencySuggestionGroup
  canDecide: boolean
}) {
  const [open, setOpen] = React.useState(false)
  const [confirm, setConfirm] = React.useState<"accept" | "dismiss" | null>(null)
  const bulk = useBulkDecideDependencies()
  // Per-group paged fetch on expand — correct at any queue depth (T066), and
  // every row stays reachable for per-row decisions via pagination (T071).
  const [rowPage, setRowPage] = React.useState(1)
  const [rowPageSize, setRowPageSize] = React.useState(100)
  const pendingRows = useDependencySuggestions(
    {
      status: "PENDING",
      childComponentId: group.childComponent.id,
      page: rowPage,
      pageSize: rowPageSize,
    },
    { enabled: open },
  )
  const rows = pendingRows.data?.data ?? []
  useClampPage(
    { page: rowPage, setPage: setRowPage },
    pendingRows.data?.pagination,
  )
  const [announcement, setAnnouncement] = React.useState("")
  const name = group.childComponent.name
  const busy = bulk.isPending

  const runBulk = (action: "accept" | "dismiss") => {
    bulk.mutate(
      { childComponentId: group.childComponent.id, action },
      {
        onSuccess: (res) => {
          const label = action === "accept" ? "accepted" : "dismissed"
          toast(`${res.decided} dependencies ${label}`, {
            description:
              res.failed > 0
                ? `${res.failed} could not be completed — they stay pending; expand the group to retry them.`
                : undefined,
          })
          setAnnouncement(`${res.decided} dependencies ${label}.`)
          setConfirm(null)
        },
        onError: (e) => {
          toast.error(errorMessage(e))
          setConfirm(null)
        },
      },
    )
  }

  return (
    <Card className="py-4">
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <p className="flex flex-wrap items-center gap-2 text-sm">
              <Link
                to={ux(`/components/${group.childComponent.slug}`)}
                className="font-medium underline-offset-4 hover:underline"
              >
                {name}
              </Link>
              <span className="text-muted-foreground">
                is used by {group.pendingCount} components
              </span>
            </p>
            <p className="flex flex-wrap items-center gap-1.5">
              {group.reasons.map((r) => (
                <ReasonBadge key={r} reason={r} />
              ))}
              <span className="text-xs text-muted-foreground">
                {group.versions} {group.versions === 1 ? "version" : "versions"}
              </span>
            </p>
            {group.purl ? (
              <MonoValue value={group.purl} copy={false} className="text-xs" />
            ) : null}
          </div>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={open ? `Collapse ${name}` : `Expand ${name}`}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            <ChevronDownIcon
              className={cn("size-4 transition-transform", open && "rotate-180")}
              aria-hidden="true"
            />
          </Button>
        </div>

        {canDecide ? (
          <div className="flex flex-wrap items-center gap-2">
            {group.bulkAcceptable ? (
              <Button size="sm" onClick={() => setConfirm("accept")} disabled={busy}>
                <CheckIcon data-icon="inline-start" />
                Accept all {group.pendingCount}
              </Button>
            ) : (
              <p className="text-xs text-muted-foreground">
                Accept all requires exact package matches — review name/slug
                matches one by one.
              </p>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirm("dismiss")}
              disabled={busy}
            >
              <XIcon data-icon="inline-start" />
              Dismiss all {group.pendingCount}
            </Button>
          </div>
        ) : null}

        <div aria-live="polite" role="status" className="sr-only">
          {announcement}
        </div>

        {open ? (
          rows.length > 0 ? (
            <>
              <ul className="flex flex-col gap-2">
                {rows.map((item) => (
                  <PendingParentRow
                    key={item.id}
                    item={item}
                    canDecide={canDecide}
                    pending={busy}
                  />
                ))}
              </ul>
              {pendingRows.data &&
              pendingRows.data.pagination.total > rowPageSize ? (
                <ListPagination
                  page={rowPage}
                  pageSize={rowPageSize}
                  total={pendingRows.data.pagination.total}
                  pageCount={pendingRows.data.pagination.pageCount}
                  onPageChange={setRowPage}
                  onPageSizeChange={setRowPageSize}
                />
              ) : null}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Individual rows could not be listed for this group.
            </p>
          )
        ) : null}

        <Dialog open={confirm !== null} onOpenChange={(v) => !v && setConfirm(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {confirm === "accept"
                  ? `Accept all ${group.pendingCount} suggestions`
                  : `Dismiss all ${group.pendingCount} suggestions`}
              </DialogTitle>
              <DialogDescription>
                {confirm === "accept"
                  ? `This creates ${group.pendingCount} dependency edges on ${name}.`
                  : `This dismisses ${group.pendingCount} pending suggestions for ${name}.`}{" "}
                This is permanent — decided suggestions never come back.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant={confirm === "dismiss" ? "outline" : "default"}
                onClick={() => confirm && runBulk(confirm)}
                disabled={busy}
                data-testid="dependency-bulk-confirm"
              >
                {confirm === "accept"
                  ? `Accept all ${group.pendingCount}`
                  : `Dismiss all ${group.pendingCount}`}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  )
}

/**
 * Query-owning grouped pending view — one card per library group; each
 * card fetches its own paged PENDING rows on expand (T066/T071).
 */
const GROUP_SORT_OPTIONS: ListSortOption<"score" | "components" | "name">[] = [
  { sort: "score", order: "desc", label: "Highest score" },
  { sort: "components", order: "desc", label: "Most components" },
  { sort: "name", order: "asc", label: "Name" },
]

export function DependencyGroupsPanel({
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
  childComponentId,
}: {
  page: number
  pageSize: number
  onPageChange: (page: number) => void
  onPageSizeChange: (size: number) => void
  childComponentId?: string
}) {
  const session = useSession()
  const canDecide = canAccess(session.data?.role ?? "VIEWER", "EDITOR")
  const [sort, setSort] = React.useState<"score" | "components" | "name">("score")
  const [order, setOrder] = React.useState<"asc" | "desc">("desc")
  const groups = useDependencyGroups({
    sort,
    order,
    page,
    pageSize,
    childComponentId,
  })
  useClampPage({ page, setPage: onPageChange }, groups.data?.pagination)
  if (groups.isPending) {
    return (
      <div className="flex flex-col gap-3">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
    )
  }
  if (groups.error) {
    return (
      <ErrorState
        title="Suggestions unavailable"
        description={errorMessage(groups.error)}
        onRetry={() => void groups.refetch()}
      />
    )
  }

  const data = groups.data
  if (!data || data.data.length === 0) {
    return (
      <EmptyState
        icon={SparklesIcon}
        title="You're all caught up"
        description="Dependency suggestions appear after import runs match packages to catalog components."
      />
    )
  }

  return (
    <>
      {/* UX-SUG-04 — grouped view sort: the offered (sort, order) pairs are
          the whitelist in dependencyGroupsQuerySchema (T106). */}
      <div className="mb-3 flex justify-end">
        <ListSortSelect
          sort={sort}
          order={order}
          options={GROUP_SORT_OPTIONS}
          onSortChange={(s, o) => {
            setSort(s)
            setOrder(o)
            onPageChange(1)
          }}
        />
      </div>
      <ul className="flex flex-col gap-3">
        {data.data.map((g) => (
          <li key={g.childComponent.id}>
            <DependencyGroupCard
              group={g}
              canDecide={canDecide}
            />
          </li>
        ))}
      </ul>
      {data.pagination.total > 0 && (
        <ListPagination
          page={page}
          pageSize={pageSize}
          total={data.pagination.total}
          pageCount={data.pagination.pageCount}
          onPageChange={onPageChange}
          onPageSizeChange={onPageSizeChange}
        />
      )}
    </>
  )
}

/** Spec 042/075 — read-only decided row for the dependency segment. */
function DependencyHistoryRow({ item }: { item: DependencySuggestionQueueItem }) {
  const status = STATUS_TONE[item.status] ?? {
    tone: "neutral" as Tone,
    label: item.status,
  }
  return (
    <Card className="py-4">
      <CardContent className="flex flex-col gap-3 md:flex-row md:items-center">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <Link
              to={ux(`/components/${item.parentComponent.slug}`)}
              className="font-medium underline-offset-4 hover:underline"
            >
              {item.parentComponent.name}
            </Link>
            <span className="text-muted-foreground">depends on</span>
            <Link
              to={ux(`/components/${item.childComponent.slug}`)}
              className="font-medium underline-offset-4 hover:underline"
            >
              {item.childComponent.name}
            </Link>
            {item.reason ? <ReasonBadge reason={item.reason} /> : null}
          </p>
          <p className="text-sm text-muted-foreground">
            {item.decidedByName
              ? `Decided by ${item.decidedByName}`
              : "Decided by the system"}
            {" · "}
            <RelativeTime iso={item.decidedAt} />
          </p>
        </div>
        <StatusBadge {...status} />
      </CardContent>
    </Card>
  )
}

/** Decided history for `kind=dependency` — same status views as the edge queue. */
export function DependencyDecidedList({
  params,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
}: {
  params: DependencySuggestionsFilters
  page: number
  pageSize: number
  onPageChange: (page: number) => void
  onPageSizeChange: (size: number) => void
}) {
  const decided = useDependencySuggestions({
    ...params,
    status: "DECIDED",
    page,
    pageSize,
  })
  useClampPage({ page, setPage: onPageChange }, decided.data?.pagination)

  if (decided.isPending) {
    return (
      <div className="flex flex-col gap-3">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-20 rounded-xl" />
        ))}
      </div>
    )
  }
  if (decided.error) {
    return (
      <ErrorState
        title="History unavailable"
        description={errorMessage(decided.error)}
        onRetry={() => void decided.refetch()}
      />
    )
  }
  const rows = decided.data?.data ?? []
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={HistoryIcon}
        title="No decisions yet"
        description="Accepted, dismissed and superseded suggestions appear here with who decided and when."
      />
    )
  }
  return (
    <>
      <ul className="flex flex-col gap-3">
        {rows.map((item) => (
          <li key={item.id}>
            <DependencyHistoryRow item={item} />
          </li>
        ))}
      </ul>
      {decided.data && decided.data.pagination.total > 0 && (
        <ListPagination
          page={page}
          pageSize={pageSize}
          total={decided.data.pagination.total}
          pageCount={decided.data.pagination.pageCount}
          onPageChange={onPageChange}
          onPageSizeChange={onPageSizeChange}
        />
      )}
    </>
  )
}
