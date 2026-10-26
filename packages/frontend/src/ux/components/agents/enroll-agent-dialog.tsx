
import { PlusIcon } from "lucide-react"
import * as React from "react"
import { toast } from "sonner"
import { EnrollmentTokenPanel } from "@/ux/components/agents/enrollment-token-panel"
import { Button } from "@/ux/components/ui/button"
import { Checkbox } from "@/ux/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/ux/components/ui/dialog"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/ux/components/ui/field"
import { Input } from "@/ux/components/ui/input"
import { validateAgentName } from "@/ux/lib/agents"
import { IMPORTER_NAMES } from "@/ux/lib/domain"
import { useCreateAgent } from "@/api/hooks/agents"

interface EnrollAgentDialogProps {
  existingNames: string[]
  trigger?: React.ReactNode
}

export function EnrollAgentDialog({ existingNames, trigger }: EnrollAgentDialogProps) {
  const createAgent = useCreateAgent()
  const [open, setOpen] = React.useState(false)
  const [step, setStep] = React.useState<"form" | "token">("form")
  const [name, setName] = React.useState("")
  const [allowed, setAllowed] = React.useState<string[]>([])
  const [error, setError] = React.useState<string | null>(null)
  const [token, setToken] = React.useState("")

  const handleOpenChange = (next: boolean) => {
    if (next) {
      setStep("form")
      setName("")
      setAllowed([])
      setError(null)
      setToken("")
    } else if (step === "token") {
      return
    }
    setOpen(next)
  }

  const toggleImporter = (importer: string, on: boolean) =>
    setAllowed((prev) => (on ? [...prev, importer] : prev.filter((i) => i !== importer)))

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const message = validateAgentName(name, existingNames)
    setError(message)
    if (message) return
    createAgent.mutate(
      { name, allowedImporters: allowed.length ? allowed : undefined },
      {
        onSuccess: (result) => {
          setToken(result.enrollment.token)
          setStep("token")
        },
        onError: (err) => setError(err.message),
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <PlusIcon data-icon="inline-start" />
            Enroll agent
          </Button>
        )}
      </DialogTrigger>
      <DialogContent
        className="sm:max-w-lg"
        onInteractOutside={(e) => step === "token" && e.preventDefault()}
        onEscapeKeyDown={(e) => step === "token" && e.preventDefault()}
      >
        {step === "form" ? (
          <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
            <DialogHeader>
              <DialogTitle>Enroll an import agent</DialogTitle>
              <DialogDescription>
                Register the agent identity first. You will get a single-use token to run on the host that can reach your private sources.
              </DialogDescription>
            </DialogHeader>
            <FieldGroup>
              <Field data-invalid={error ? true : undefined}>
                <FieldLabel htmlFor="agent-name">Agent name</FieldLabel>
                <Input
                  id="agent-name"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value.toLowerCase())
                    setError(null)
                  }}
                  placeholder="eu-k8s-prod"
                  autoComplete="off"
                  aria-invalid={error ? true : undefined}
                  className="font-mono"
                />
                {error ? (
                  <FieldError>{error}</FieldError>
                ) : (
                  <FieldDescription>Lowercase, unique, and describes where it runs. It cannot be changed later.</FieldDescription>
                )}
              </Field>
              <FieldSet>
                <FieldLegend variant="label">Allowed importers</FieldLegend>
                <FieldDescription>Leave all unchecked to allow every importer compiled into the agent. You can change this later.</FieldDescription>
                <div className="grid grid-cols-2 gap-2">
                  {IMPORTER_NAMES.map((importer) => (
                    <Field key={importer} orientation="horizontal">
                      <Checkbox
                        id={`allow-${importer}`}
                        checked={allowed.includes(importer)}
                        onCheckedChange={(v) => toggleImporter(importer, v === true)}
                      />
                      <FieldLabel htmlFor={`allow-${importer}`} className="font-mono text-xs font-normal">
                        {importer}
                      </FieldLabel>
                    </Field>
                  ))}
                </div>
              </FieldSet>
            </FieldGroup>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createAgent.isPending}>Create and get token</Button>
            </DialogFooter>
          </form>
        ) : (
          <div className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>Agent registered</DialogTitle>
              <DialogDescription>
                Copy the enrollment token for <span className="font-mono">{name}</span> before closing this dialog.
              </DialogDescription>
            </DialogHeader>
            <EnrollmentTokenPanel
              agentName={name}
              token={token}
              onDone={() => {
                setOpen(false)
                toast.success(`${name} is waiting for its first connection`)
              }}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
