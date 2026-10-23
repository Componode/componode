
import { useNavigate } from "react-router-dom"
import { ux } from "@/ux/lib/paths"
import { toast } from "sonner"
import { ConfirmDialog } from "@/ux/components/patterns/confirm-dialog"
import { Button } from "@/ux/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/ux/components/ui/card"

export interface DangerAction {
  id: string
  title: string
  description: string
  buttonLabel: string
  variant?: "outline" | "destructive"
  confirmTitle: string
  confirmDescription: string
  confirmLabel: string
  /** Require typing this value. Use for irreversible deletes. */
  typeToConfirm?: string
  /** When set the button is disabled and this explains why. */
  blockedReason?: string
  successMessage: string
  /** Navigate here after confirming (e.g. the list page after a delete). */
  redirectTo?: string
  /** Update local state so the page reflects the action. Replace with the mutation hook when wiring. */
  onConfirm?: () => void
}

/**
 * Standard destructive section for every detail page. One row per action, always last on the page.
 * Wire each `onConfirm` to the mutation named in the page's wiring entry.
 */
export function DangerZone({ actions }: { actions: DangerAction[] }) {
  const navigate = useNavigate()
  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle>Danger zone</CardTitle>
        <CardDescription>Destructive actions are kept here, away from everyday controls, and always ask for confirmation.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col divide-y">
        {actions.map((a) => (
          <div key={a.id} className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">{a.title}</span>
              <span className="text-sm text-muted-foreground">{a.blockedReason ?? a.description}</span>
            </div>
            <ConfirmDialog
              trigger={
                <Button variant={a.variant ?? "outline"} disabled={Boolean(a.blockedReason)}>
                  {a.buttonLabel}
                </Button>
              }
              title={a.confirmTitle}
              description={a.confirmDescription}
              confirmLabel={a.confirmLabel}
              typeToConfirm={a.typeToConfirm}
              onConfirm={() => {
                // Wired actions own their success/error toasts via the
                // mutation; the prototype toast only fires for unwired ones.
                if (a.onConfirm) {
                  a.onConfirm()
                } else {
                  toast.success(a.successMessage, { description: "Not wired yet." })
                }
                if (a.redirectTo) navigate(ux(a.redirectTo))
              }}
            />
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
