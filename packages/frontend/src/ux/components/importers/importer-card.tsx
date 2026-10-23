
import { KeyRoundIcon, PlayIcon, TimerIcon } from "lucide-react"
import { Link } from "react-router-dom"
import { toast } from "sonner"
import { RelativeTime } from "@/ux/components/patterns/primitives"
import { ProviderMark } from "@/ux/components/patterns/provider-mark"
import { RunStatusBadge, StatusBadge } from "@/ux/components/patterns/status-badge"
import { Button } from "@/ux/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/ux/components/ui/card"
import { Switch } from "@/ux/components/ui/switch"
import { PROVIDER_META } from "@/ux/lib/domain"
import { formatNumber } from "@/ux/lib/format"
import { useTriggerImportRun, useUpdateImporterConfig } from "@/api/hooks/importers"
import { flags } from "@/ux/lib/flags"
import { ux } from "@/ux/lib/paths"
import type { ImporterConfig } from "@/ux/lib/view-types"
import { cn } from "@/ux/lib/utils"

/** 14-day sparkline of run outcomes. One bar per day; red bar = a failed run that day. */
function RunHistory({ history }: { history: ImporterConfig["history"] }) {
  const max = Math.max(1, ...history.map((h) => h.created + h.updated))
  return (
    <div className="flex h-8 items-end gap-0.5" role="img" aria-label="Run history, last 14 days">
      {history.map((h) => (
        <span
          key={h.day}
          className={cn("flex-1 rounded-sm", h.failed ? "bg-destructive" : "bg-primary/60")}
          style={{ height: `${h.failed ? 100 : Math.max(12, ((h.created + h.updated) / max) * 100)}%` }}
        />
      ))}
    </div>
  )
}

export function ImporterCard({ importer: i }: { importer: ImporterConfig }) {
  const trigger = useTriggerImportRun()
  const update = useUpdateImporterConfig()
  const enabled = i.enabled
  return (
    <Card className={cn("h-full", !enabled && "opacity-70")}>
      <CardHeader>
        <div className="mb-1 flex items-center gap-3">
          <ProviderMark provider={i.importerName} />
          <div className="flex min-w-0 flex-col">
            <CardTitle className="truncate">
              <Link to={ux(`/importers/${i.id}`)} className="underline-offset-4 hover:underline">
                {i.label}
              </Link>
            </CardTitle>
            <CardDescription>{PROVIDER_META[i.importerName].label}</CardDescription>
          </div>
        </div>
        <CardAction>
          <Switch
            checked={enabled}
            disabled={update.isPending}
            onCheckedChange={(v) =>
              update.mutate(
                { id: i.id, enabled: v },
                {
                  onSuccess: () => toast.success(v ? `${i.label} enabled` : `${i.label} paused`),
                  onError: (e) => toast.error(e.message),
                },
              )
            }
            aria-label={enabled ? "Pause importer" : "Enable importer"}
          />
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          {i.lastRun ? <RunStatusBadge value={i.lastRun.status} /> : <StatusBadge tone="neutral" label="Never run" />}
          {i.lastRun && (
            <span className="tabular text-xs text-muted-foreground">
              {formatNumber(i.lastRun.processed)} assets · <RelativeTime iso={i.lastRun.at} />
            </span>
          )}
        </div>
        {flags.historyAggregates ? (
          <RunHistory history={i.history} />
        ) : (
          <div className="flex h-8 items-center text-xs text-muted-foreground" role="img" aria-label="Run history unavailable">
            Per-day run history lands with the aggregates endpoint.
          </div>
        )}
        <ul className="flex flex-col gap-1.5 text-sm text-muted-foreground">
          <li className="flex items-center gap-2">
            <TimerIcon className="size-4" aria-hidden="true" />
            {i.scheduleLabel}
          </li>
          <li className="flex items-center gap-2">
            <KeyRoundIcon className="size-4" aria-hidden="true" />
            <span className="truncate">{i.credentialLabel}</span>
          </li>
        </ul>
      </CardContent>
      <CardFooter className="mt-auto gap-2">
        <Button variant="outline" size="sm" className="flex-1" asChild>
          <Link to={ux(`/importers/${i.id}`)}>View runs</Link>
        </Button>
        <Button
          size="sm"
          className="flex-1"
          disabled={!enabled || trigger.isPending}
          onClick={() =>
            trigger.mutate(i.id, {
              onSuccess: () => toast.success(`Run queued for ${i.label}`),
              onError: (e) => toast.error(e.message),
            })
          }
        >
          <PlayIcon data-icon="inline-start" />
          Run now
        </Button>
      </CardFooter>
    </Card>
  )
}
