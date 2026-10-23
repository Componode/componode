
import { KeyRoundIcon } from "lucide-react"
import * as React from "react"
import { CopyButton, MonoValue } from "@/ux/components/patterns/primitives"
import { Alert, AlertDescription, AlertTitle } from "@/ux/components/ui/alert"
import { Button } from "@/ux/components/ui/button"
import { Checkbox } from "@/ux/components/ui/checkbox"
import { DialogFooter } from "@/ux/components/ui/dialog"
import { Field, FieldLabel } from "@/ux/components/ui/field"
import { ENROLLMENT_TTL_HOURS } from "@/ux/lib/agents"

interface EnrollmentTokenPanelProps {
  agentName: string
  token: string
  onDone: () => void
}

/**
 * Show-once secret pattern. The value is displayed a single time, can only be dismissed
 * after the user confirms they stored it, and is never re-fetchable.
 */
export function EnrollmentTokenPanel({ agentName, token, onDone }: EnrollmentTokenPanelProps) {
  const [stored, setStored] = React.useState(false)
  const command = `componode-agent enroll --hub ${window.location.origin} --name ${agentName} --token ${token}`

  return (
    <div className="flex flex-col gap-4">
      <Alert>
        <KeyRoundIcon />
        <AlertTitle>This token is shown once</AlertTitle>
        <AlertDescription>
          Single use, expires in {ENROLLMENT_TTL_HOURS} hours. The agent exchanges it for a durable credential on first connect.
        </AlertDescription>
      </Alert>

      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Enrollment token</span>
        <MonoValue value={token} />
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Run on the agent host</span>
          <CopyButton value={command} label="Copy command" />
        </div>
        <pre className="overflow-x-auto rounded-md border bg-muted/50 p-3 font-mono text-xs leading-relaxed">
          <code>{command}</code>
        </pre>
      </div>

      <Field orientation="horizontal">
        <Checkbox id="token-stored" checked={stored} onCheckedChange={(v) => setStored(v === true)} />
        <FieldLabel htmlFor="token-stored" className="font-normal">
          I have copied the token or command
        </FieldLabel>
      </Field>

      <DialogFooter>
        <Button disabled={!stored} onClick={onDone}>
          Done
        </Button>
      </DialogFooter>
    </div>
  )
}
