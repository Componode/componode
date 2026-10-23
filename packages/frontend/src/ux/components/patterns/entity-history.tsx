
import { HistoryIcon } from "lucide-react"
import * as React from "react"
import { ActivityFeed } from "@/ux/components/patterns/activity-feed"
import { EmptyState } from "@/ux/components/patterns/states"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ux/components/ui/select"
import type { AuditEvent } from "@/ux/lib/mock-data"

const ALL = "all"

/** Full change history for one entity, filterable by action. Newest first. */
export function EntityHistory({ events, entityLabel }: { events: AuditEvent[]; entityLabel: string }) {
  const [action, setAction] = React.useState<string>(ALL)
  const actions = Array.from(new Set(events.map((e) => e.action)))
  const sorted = [...events].sort((a, b) => b.at.localeCompare(a.at))
  const visible = action === ALL ? sorted : sorted.filter((e) => e.action === action)

  if (events.length === 0) {
    return (
      <EmptyState
        icon={HistoryIcon}
        title="No recorded changes"
        description={`Changes to this ${entityLabel} will appear here once someone edits it or an importer updates it.`}
      />
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {visible.length} of {events.length} {events.length === 1 ? "event" : "events"}
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
    </div>
  )
}
