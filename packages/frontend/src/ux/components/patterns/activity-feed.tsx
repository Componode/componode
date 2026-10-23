import { BotIcon } from "lucide-react"
import { RelativeTime } from "@/ux/components/patterns/primitives"
import { Avatar, AvatarFallback } from "@/ux/components/ui/avatar"
import { Badge } from "@/ux/components/ui/badge"
import { initials } from "@/ux/lib/format"
import type { AuditEvent } from "@/ux/lib/view-types"

const ACTION_LABEL: Record<AuditEvent["action"], string> = {
  created: "created",
  updated: "updated",
  deleted: "deleted",
  revoked: "revoked",
  rotated: "rotated",
  enrolled: "enrolled",
  signed_in: "signed in via",
  ran: "ran",
  other: "changed",
}

/** Sentence-style audit line: "<actor> <verb> <entity kind> <entity>" + summary. */
export function ActivityFeed({ events }: { events: AuditEvent[] }) {
  return (
    <ol className="flex flex-col gap-4">
      {events.map((e) => (
        <li key={e.id} className="flex gap-3">
          <Avatar className="size-7">
            <AvatarFallback className="text-[10px]">
              {e.actor === "system" ? <BotIcon className="size-3.5" aria-label="System" /> : initials(e.actor)}
            </AvatarFallback>
          </Avatar>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <p className="text-sm leading-relaxed">
              <span className="font-medium">{e.actor}</span> <span className="text-muted-foreground">{ACTION_LABEL[e.action]}</span>{" "}
              <Badge variant="outline" className="mx-0.5 align-middle capitalize">
                {e.entityKind}
              </Badge>{" "}
              <span className="font-medium">{e.entityName}</span>
            </p>
            <p className="truncate text-xs text-muted-foreground">{e.summary}</p>
          </div>
          <RelativeTime iso={e.at} className="shrink-0 text-xs text-muted-foreground" />
        </li>
      ))}
    </ol>
  )
}
