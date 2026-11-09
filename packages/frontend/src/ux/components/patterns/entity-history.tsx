
import { HistoryIcon } from "lucide-react"
import * as React from "react"
import { ActivityFeed } from "@/ux/components/patterns/activity-feed"
import { ListPagination, type ListPaginationProps } from "@/ux/components/patterns/list-pagination"
import { EmptyState } from "@/ux/components/patterns/states"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ux/components/ui/select"
import { formatNumber } from "@/ux/lib/format"
import type { AuditEvent } from "@/ux/lib/view-types"

const ALL = "all"

/**
 * Full change history for one entity, filterable by action. Newest first.
 *
 * `events` is the CURRENT server page (spec 068 review T065) — pass
 * `pagination` (the `usePagedEntityHistory` result) to render the standard
 * pager. The action filter stays client-side over the loaded page: the
 * audit `action` column is open-domain while the feed maps it to display
 * buckets, so a server-side filter can't reproduce these options.
 */
export function EntityHistory({
  events,
  entityLabel,
  pagination,
}: {
  events: AuditEvent[]
  entityLabel: string
  /** Server pagination for the feed — renders ListPagination when total > 0. */
  pagination?: ListPaginationProps
}) {
  const [action, setAction] = React.useState<string>(ALL)
  const actions = Array.from(new Set(events.map((e) => e.action)))
  const sorted = [...events].sort((a, b) => b.at.localeCompare(a.at))
  const visible = action === ALL ? sorted : sorted.filter((e) => e.action === action)
  const hasPager = pagination !== undefined && pagination.total > 0

  if (events.length === 0 && !hasPager) {
    return (
      <EmptyState
        icon={HistoryIcon}
        title="No recorded changes"
        description={`Changes to this ${entityLabel} will appear here once someone edits it or an importer updates it.`}
      />
    )
  }

  // The count line stays honest under pagination: unfiltered it reports
  // page rows of the server total (same convention as ListToolbar); with
  // the client-side action filter it reports matches within this page.
  const countText =
    action === ALL && pagination
      ? `${events.length} of ${formatNumber(pagination.total)} ${pagination.total === 1 ? "event" : "events"}`
      : action === ALL
        ? `${events.length} ${events.length === 1 ? "event" : "events"}`
        : pagination
          ? `${visible.length} of ${events.length} ${events.length === 1 ? "event" : "events"} on this page`
          : `${visible.length} of ${events.length} ${events.length === 1 ? "event" : "events"}`

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {countText}
        </p>
        <Select value={action} onValueChange={setAction}>
          <SelectTrigger className="w-44" aria-label="Filter by action">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All actions</SelectItem>
            {actions.map((a) => (
              <SelectItem key={a} value={a} className="capitalize">
                {a.replace("_", " ")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <ActivityFeed events={visible} />
      {hasPager && pagination && <ListPagination {...pagination} />}
    </div>
  )
}
