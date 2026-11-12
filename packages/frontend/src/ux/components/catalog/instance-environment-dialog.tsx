import * as React from "react"
import { toast } from "sonner"
import { PencilIcon } from "lucide-react"
import { ENVIRONMENTS } from "@componode/core"
import { useUpdateComponentInstanceEnvironment } from "@/api/hooks/components"
import { useSession } from "@/api/hooks/auth"
import { canAccess } from "@/ux/lib/nav"
import { describeApiError, type ApiError } from "@/api/client"
import { Button } from "@/ux/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/ux/components/ui/dialog"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/ux/components/ui/field"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ux/components/ui/select"
import { ENVIRONMENT_META, type Environment } from "@/ux/lib/domain"
import type { ComponentInstance } from "@/ux/lib/view-types"
import { formatDate } from "@/ux/lib/format"

/**
 * Spec 071: edit a ComponentInstance's environment override. The select
 * starts at the current override (or the reported value when unoverridden);
 * saving writes the override, and "Reset to reported" clears it so the
 * effective value follows the importer again.
 */
export function InstanceEnvironmentDialog({ instance }: { instance: ComponentInstance }) {
  const [open, setOpen] = React.useState(false)
  const [environment, setEnvironment] = React.useState<Environment>(instance.environment)
  const update = useUpdateComponentInstanceEnvironment()
  // Advisory UX gate — the API enforces component:update regardless.
  const session = useSession()
  const canEdit = canAccess(session.data?.role ?? "VIEWER", "EDITOR")

  const overridden = instance.environmentOverride !== null
  // Picking the reported value means "follow the importer" — submit clears
  // the override (null) rather than writing a redundant one.
  const followsReported = environment === instance.reportedEnvironment
  const dirty = overridden ? !followsReported : environment !== instance.reportedEnvironment

  // Unconditional reset on open — never leak a previous instance's values.
  React.useEffect(() => {
    if (!open) return
    setEnvironment(instance.environmentOverride ?? instance.reportedEnvironment)
  }, [open, instance])

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!dirty) return
    update.mutate(
      { id: instance.id, environment: followsReported ? null : environment },
      {
        onSuccess: () => {
          toast.success("Instance environment updated")
          setOpen(false)
        },
        onError: (err) => toast.error(describeApiError(err as unknown as ApiError)),
      },
    )
  }

  function onReset() {
    update.mutate(
      { id: instance.id, environment: null },
      {
        onSuccess: () => {
          toast.success("Environment override cleared")
          setOpen(false)
        },
        onError: (err) => toast.error(describeApiError(err as unknown as ApiError)),
      },
    )
  }

  if (!canEdit) return null

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon-xs" aria-label="Edit environment">
          <PencilIcon className="size-3.5" aria-hidden="true" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit instance environment</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="ie-env">Environment</FieldLabel>
              <Select value={environment} onValueChange={(v) => setEnvironment(v as Environment)}>
                <SelectTrigger id="ie-env" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ENVIRONMENTS.map((env) => (
                    <SelectItem key={env} value={env}>
                      {ENVIRONMENT_META[env].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldDescription>
                {overridden
                  ? `Override active — importer reports ${ENVIRONMENT_META[instance.reportedEnvironment].label}${instance.environmentOverriddenAt ? ` (set ${formatDate(instance.environmentOverriddenAt)})` : ""}. Import runs keep the reported value; the override wins until reset.`
                  : `Importer reports ${ENVIRONMENT_META[instance.reportedEnvironment].label}. Saving sets a manual override that survives import runs.`}
              </FieldDescription>
            </Field>
          </FieldGroup>
          <DialogFooter className="mt-6">
            {overridden ? (
              <Button type="button" variant="outline" onClick={onReset} disabled={update.isPending}>
                Reset to reported
              </Button>
            ) : null}
            <Button type="submit" disabled={update.isPending || !dirty}>
              {update.isPending ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
