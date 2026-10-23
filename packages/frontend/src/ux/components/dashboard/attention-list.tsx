import { AlertTriangleIcon, CircleAlertIcon, ChevronRightIcon } from "lucide-react"
import { Link } from "react-router-dom"
import { RelativeTime } from "@/ux/components/patterns/primitives"
import { Badge } from "@/ux/components/ui/badge"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/ux/components/ui/card"
import { ux } from "@/ux/lib/paths"
import type { AttentionEntry } from "@/ux/lib/view-types"
import { cn } from "@/ux/lib/utils"

/** "Needs attention" queue: sorted by severity, each row is one click from the fix. */
export function AttentionList({ items }: { items: AttentionEntry[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Needs attention</CardTitle>
        <CardDescription>Failures, expiring secrets and overdue sunsets.</CardDescription>
        <CardAction>
          <Badge variant="secondary" className="tabular">
            {items.length}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="px-0">
        {items.length === 0 ? (
          <p className="border-t px-6 py-8 text-center text-sm text-muted-foreground">
            Nothing needs attention right now.
          </p>
        ) : (
          <ul className="flex flex-col divide-y border-t">
            {items.map((item) => {
              const Icon = item.tone === "destructive" ? CircleAlertIcon : AlertTriangleIcon
              return (
                <li key={item.label}>
                  <Link
                    to={ux(item.href)}
                    className="flex items-center gap-3 px-6 py-3 outline-none transition-colors hover:bg-muted/50 focus-visible:bg-muted/50"
                  >
                    <span
                      className={cn(
                        "flex size-8 shrink-0 items-center justify-center rounded-md",
                        item.tone === "destructive" ? "bg-destructive/10 text-destructive" : "bg-warning/15 text-warning",
                      )}
                    >
                      <Icon className="size-4" aria-hidden="true" />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm font-medium">{item.label}</span>
                      {item.detail ? (
                        <span className="truncate text-xs text-muted-foreground">{item.detail}</span>
                      ) : null}
                    </span>
                    <RelativeTime iso={item.at} className="hidden text-xs text-muted-foreground sm:block" />
                    <ChevronRightIcon className="size-4 text-muted-foreground" aria-hidden="true" />
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
