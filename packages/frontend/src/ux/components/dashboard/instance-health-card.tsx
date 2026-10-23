import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/ux/components/ui/card"
import { HEALTH_META, type InstanceStatus } from "@/ux/lib/domain"
import { formatNumber } from "@/ux/lib/format"
import { cn } from "@/ux/lib/utils"

const BAR: Record<InstanceStatus, string> = {
  RUNNING: "bg-success",
  STOPPED: "bg-warning",
  ERROR: "bg-destructive",
  GONE: "bg-muted-foreground/40",
}

export function InstanceHealthCard({ byStatus }: { byStatus: Record<string, number> }) {
  const entries = (Object.entries(byStatus) as [string, number][]).filter(
    (e): e is [InstanceStatus, number] => e[0] in BAR,
  )
  const total = entries.reduce((a, [, n]) => a + n, 0)
  return (
    <Card>
      <CardHeader>
        <CardTitle>Instance health</CardTitle>
        <CardDescription>As reported by the latest import of each source.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {total === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No instances imported yet.
          </p>
        ) : (
          <>
            <div className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full" role="img" aria-label="Instance status distribution">
              {entries.map(([status, n]) => (
                <span key={status} className={cn("h-full", BAR[status])} style={{ width: `${(n / total) * 100}%` }} />
              ))}
            </div>
            <ul className="grid grid-cols-2 gap-3">
              {entries.map(([status, n]) => (
                <li key={status} className="flex items-center gap-2">
                  <span className={cn("size-2 rounded-full", BAR[status])} aria-hidden="true" />
                  <span className="text-sm text-muted-foreground">{HEALTH_META[status].label}</span>
                  <span className="tabular ml-auto text-sm font-medium">{formatNumber(n)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  )
}
