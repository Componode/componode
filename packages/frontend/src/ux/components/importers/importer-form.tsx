
import { useNavigate } from "react-router-dom"
import * as React from "react"
import { toast } from "sonner"
import { FormPage, FormSection } from "@/ux/components/forms/form-shell"
import { PageContainer, PageHeader } from "@/ux/components/patterns/page-header"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/ux/components/ui/field"
import { Input } from "@/ux/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ux/components/ui/select"
import { Switch } from "@/ux/components/ui/switch"
import { PROVIDER_META, type Provider } from "@/ux/lib/domain"
import { credentials, type ImporterConfig } from "@/ux/lib/mock-data"

const IMPORTER_PROVIDERS: Provider[] = ["GITHUB", "AWS", "AZURE", "ALIBABA_CLOUD", "KUBERNETES", "WEB_URL", "API_URL", "MCP_SERVER"]

const SCHEDULES = [
  { value: "0 * * * *", label: "Every hour" },
  { value: "0 */6 * * *", label: "Every 6 hours" },
  { value: "0 2 * * *", label: "Daily at 02:00" },
  { value: "0 2 * * 1", label: "Weekly on Monday" },
  { value: "manual", label: "Manual only" },
  { value: "custom", label: "Custom cron" },
] as const

const CRON_FIELD = /^(\*|\d+|\*\/\d+|\d+-\d+|\d+(,\d+)+)$/
const isCron = (v: string) => {
  const parts = v.trim().split(/\s+/)
  return parts.length === 5 && parts.every((p) => CRON_FIELD.test(p))
}

interface Errors {
  label?: string
  credential?: string
  cron?: string
}

export function ImporterForm({ importer }: { importer?: ImporterConfig }) {
  const navigate = useNavigate()
  const editing = Boolean(importer)
  const initialPreset = !importer ? "0 */6 * * *" : importer.schedule === null ? "manual" : SCHEDULES.some((s) => s.value === importer.schedule) ? importer.schedule : "custom"

  const [provider, setProvider] = React.useState<Provider>(importer?.importerName ?? "AWS")
  const [label, setLabel] = React.useState(importer?.label ?? "")
  const [credentialSlug, setCredentialSlug] = React.useState(
    importer ? (credentials.find((c) => c.slug === importer.credentialLabel)?.slug ?? "") : "",
  )
  const [preset, setPreset] = React.useState<string>(initialPreset ?? "manual")
  const [cron, setCron] = React.useState(importer?.schedule ?? "")
  const [enabled, setEnabled] = React.useState(importer?.enabled ?? true)
  const [errors, setErrors] = React.useState<Errors>({})
  const [pending, setPending] = React.useState(false)

  const matching = credentials.filter((c) => c.provider === provider)
  const credentialMissing = credentialSlug !== "" && !matching.some((c) => c.slug === credentialSlug)

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const next: Errors = {}
    if (!label.trim()) next.label = "Label is required."
    if (!credentialSlug || credentialMissing) next.credential = `Choose a ${PROVIDER_META[provider].label} credential.`
    if (preset === "custom" && !isCron(cron)) next.cron = "Enter a five-field cron expression, for example 0 */4 * * *."
    setErrors(next)
    if (Object.keys(next).length) return
    setPending(true)
    // Simulated save. Wire to POST /importers or PATCH /importers/:id (see /standards/wiring).
    setTimeout(() => {
      toast.success(editing ? "Importer saved (simulated)" : "Importer created (simulated)")
      navigate(editing ? `/importers/${importer!.id}` : "/importers")
    }, 600)
  }

  return (
    <PageContainer width="narrow">
      <PageHeader
        title={editing ? `Edit ${importer!.label}` : "New importer"}
        description="An importer discovers components in one provider account on a schedule using a credential."
      />
      <FormPage
        onSubmit={handleSubmit}
        cancelHref={editing ? `/importers/${importer!.id}` : "/importers"}
        submitLabel={editing ? "Save changes" : "Create importer"}
        pending={pending}
      >
        <FormSection title="Source">
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="i-provider">Provider</FieldLabel>
              <Select
                value={provider}
                disabled={editing}
                onValueChange={(v) => {
                  setProvider(v as Provider)
                  setCredentialSlug("")
                }}
              >
                <SelectTrigger id="i-provider" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {IMPORTER_PROVIDERS.map((p) => (
                    <SelectItem key={p} value={p}>
                      {PROVIDER_META[p].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {editing && <FieldDescription>The provider cannot change after creation. Create a new importer instead.</FieldDescription>}
            </Field>
            <Field data-invalid={errors.label ? true : undefined}>
              <FieldLabel htmlFor="i-label">Label</FieldLabel>
              <Input
                id="i-label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                aria-invalid={errors.label ? true : undefined}
                placeholder="AWS: Production org"
              />
              {errors.label && <FieldError>{errors.label}</FieldError>}
            </Field>
            <Field data-invalid={errors.credential ? true : undefined}>
              <FieldLabel htmlFor="i-cred">Credential</FieldLabel>
              <Select value={credentialSlug} onValueChange={setCredentialSlug}>
                <SelectTrigger id="i-cred" className="w-full" aria-invalid={errors.credential ? true : undefined}>
                  <SelectValue placeholder={matching.length ? "Select a credential" : "No credentials for this provider"} />
                </SelectTrigger>
                <SelectContent>
                  {matching.map((c) => (
                    <SelectItem key={c.id} value={c.slug} disabled={c.status === "REVOKED"}>
                      {c.label}
                      {c.status !== "ACTIVE" && ` (${c.status.toLowerCase()})`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.credential ? (
                <FieldError>{errors.credential}</FieldError>
              ) : (
                <FieldDescription>
                  Only credentials for {PROVIDER_META[provider].label} are listed. Expired and revoked ones are disabled.
                </FieldDescription>
              )}
            </Field>
          </FieldGroup>
        </FormSection>

        <FormSection title="Schedule">
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="i-schedule">Run</FieldLabel>
              <Select
                value={preset}
                onValueChange={(v) => {
                  setPreset(v)
                  if (v !== "custom" && v !== "manual") setCron(v)
                  if (v === "manual") setCron("")
                }}
              >
                <SelectTrigger id="i-schedule" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SCHEDULES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            {preset === "custom" && (
              <Field data-invalid={errors.cron ? true : undefined}>
                <FieldLabel htmlFor="i-cron">Cron expression</FieldLabel>
                <Input
                  id="i-cron"
                  value={cron}
                  className="font-mono"
                  onChange={(e) => setCron(e.target.value)}
                  aria-invalid={errors.cron ? true : undefined}
                  placeholder="0 */4 * * *"
                />
                {errors.cron ? <FieldError>{errors.cron}</FieldError> : <FieldDescription>Minute, hour, day of month, month, day of week. Times are UTC.</FieldDescription>}
              </Field>
            )}
            <Field orientation="horizontal">
              <Switch id="i-enabled" checked={enabled} onCheckedChange={setEnabled} />
              <div className="flex flex-col gap-0.5">
                <FieldLabel htmlFor="i-enabled">Enabled</FieldLabel>
                <FieldDescription>Disabled importers keep their history but never run, including manual runs.</FieldDescription>
              </div>
            </Field>
          </FieldGroup>
        </FormSection>
      </FormPage>
    </PageContainer>
  )
}
