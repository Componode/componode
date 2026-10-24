import { Link } from "react-router-dom"
import { ActivityFeed } from "@/ux/components/patterns/activity-feed"
import { Button } from "@/ux/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/ux/components/ui/card"
import { ux } from "@/ux/lib/paths"
import type { AuditEvent } from "@/ux/lib/view-types"

export function RecentActivity({ events }: { events: AuditEvent[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent activity</CardTitle>
        <CardDescription>Changes by people and importers.</CardDescription>
        <CardAction>
          <Button variant="ghost" size="sm" asChild>
            <Link to={ux("/activity")}>View all</Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {events.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No activity yet.</p>
        ) : (
          <ActivityFeed events={events.slice(0, 5)} />
        )}
      </CardContent>
    </Card>
  )
}
