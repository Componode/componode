import * as React from "react"
import { RadioTowerIcon, Settings2Icon } from "lucide-react"
import { toast } from "sonner"
import {
  URL_CHECK_DEFAULT_CADENCE_SECONDS,
  URL_CHECK_MAX_CADENCE_SECONDS,
  URL_CHECK_MIN_CADENCE_SECONDS,
} from "@componode/core"
import { describeApiError, type ApiError } from "@/api/client"
import { useAllAgents } from "@/api/hooks/agents"
import { useUpdateMonitoringSetup } from "@/api/hooks/url-checks"
import { Button } from "@/ux/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/ux/components/ui/dialog"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/ux/components/ui/field"
import { Input } from "@/ux/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ux/components/ui/select"
import type { UrlCheckVantage } from "@/ux/lib/domain"
import type { MonitoringSetupView } from "@/ux/lib/view-types"

/** Rendered inside DialogContent — mounts only while the dialog is open. */
function SetupForm({
  componentId,
  setup,
  onDone,
}: {
  componentId: string
  setup: MonitoringSetupView | null
  onDone: () => void
}) {
  const update = useUpdateMonitoringSetup(componentId)
  // Agent picker needs the full set — fetch-all sweep (spec 068 exempt).
  const agents = useAllAgents()
  // GET /agents is ADMIN-gated — non-admin editors keep the Hub vantage.
  const agentsUnavailable = agents.isError
  const agentList = agents.data ?? []

  const [cadenceInput, setCadenceInput] = React.useState(
    String(setup?.cadenceSeconds ?? URL_CHECK_DEFAULT_CADENCE_SECONDS),
  )
  const [vantage, setVantage] = React.useState<UrlCheckVantage>(setup?.vantage ?? "HUB")
  const [agentId, setAgentId] = React.useState(setup?.agentId ?? "")
  const [error, setError] = React.useState<string | null>(null)

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const cadence = Number(cadenceInput)
    if (!Number.isInteger(cadence) || cadence < URL_CHECK_MIN_CADENCE_SECONDS || cadence > URL_CHECK_MAX_CADENCE_SECONDS) {
      return setError(`Cadence must be ${URL_CHECK_MIN_CADENCE_SECONDS}–${URL_CHECK_MAX_CADENCE_SECONDS} seconds.`)
    }
    if (vantage === "AGENT" && !agentId) {
      return setError("Select the Import Agent probes run from.")
    }
    setError(null)
    update.mutate(
      {
        cadenceSeconds: cadence,
        vantage,
        agentId: vantage === "AGENT" ? agentId : null,
      },
      {
        onSuccess: () => {
          toast.success(
            vantage === "AGENT"
              ? "Monitoring defaults saved — probes run from an Import Agent"
              : "Monitoring defaults saved — probes run from the Hub",
          )
          onDone()
        },
        onError: (err) => setError(describeApiError(err as unknown as ApiError)),
      },
    )
  }

  return (
    <form className="flex flex-col gap-6" onSubmit={onSubmit}>
      <DialogHeader>
        <DialogTitle>Monitoring defaults</DialogTitle>
        <DialogDescription>
          Shared by every check on this component — how often probes run and where they run from.
        </DialogDescription>
      </DialogHeader>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="mse-cadence">Probe cadence (seconds)</FieldLabel>
          <Input
            id="mse-cadence"
            value={cadenceInput}
            onChange={(e) => setCadenceInput(e.target.value)}
            inputMode="numeric"
            autoComplete="off"
          />
          <FieldDescription>
            {URL_CHECK_MIN_CADENCE_SECONDS}–{URL_CHECK_MAX_CADENCE_SECONDS} seconds; checks may override it individually.
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="mse-vantage">Execution vantage</FieldLabel>
          <Select value={vantage} onValueChange={(v) => setVantage(v as UrlCheckVantage)}>
            <SelectTrigger id="mse-vantage" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="HUB">Hub — probes run on this server</SelectItem>
              <SelectItem value="AGENT" disabled={agentsUnavailable}>
                Import Agent — probes run on a remote agent
              </SelectItem>
            </SelectContent>
          </Select>
          {agentsUnavailable ? (
            <FieldDescription>Picking an Import Agent requires the Admin role.</FieldDescription>
          ) : (
            <FieldDescription>Metrics are phrased as “reachable from” this vantage.</FieldDescription>
          )}
        </Field>
        {vantage === "AGENT" && !agentsUnavailable && (
          <Field>
            <FieldLabel htmlFor="mse-agent">Import Agent</FieldLabel>
            <Select value={agentId} onValueChange={setAgentId}>
              <SelectTrigger id="mse-agent" className="w-full">
                <SelectValue placeholder="Select an agent" />
              </SelectTrigger>
              <SelectContent>
                {agentList.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldDescription className="flex items-center gap-1.5">
              <RadioTowerIcon className="size-3.5" aria-hidden="true" />
              When the agent is offline, scheduled probes are recorded as missed — shown as a coverage gap.
            </FieldDescription>
          </Field>
        )}
        {error && <FieldError>{error}</FieldError>}
      </FieldGroup>
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="outline" type="button">
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" disabled={update.isPending}>
          Save defaults
        </Button>
      </DialogFooter>
    </form>
  )
}

/**
 * Shared per-component monitoring defaults (spec 051): probe cadence and a
 * single execution vantage — the Hub or a selected Import Agent. Every check
 * on the component runs from this vantage.
 */
export function MonitoringSetupEditor({
  componentId,
  setup,
  trigger,
}: {
  componentId: string
  setup: MonitoringSetupView | null
  trigger?: React.ReactNode
}) {
  const [open, setOpen] = React.useState(false)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="outline" size="sm">
            <Settings2Icon data-icon="inline-start" />
            Monitoring defaults
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <SetupForm componentId={componentId} setup={setup} onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  )
}
