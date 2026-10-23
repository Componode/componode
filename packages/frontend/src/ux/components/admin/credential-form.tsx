
import { useNavigate } from "react-router-dom"
import * as React from "react"
import { toast } from "sonner"
import { FormPage, FormSection } from "@/ux/components/forms/form-shell"
import { PageContainer, PageHeader } from "@/ux/components/patterns/page-header"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/ux/components/ui/field"
import { Input } from "@/ux/components/ui/input"
import { RadioGroup, RadioGroupItem } from "@/ux/components/ui/radio-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ux/components/ui/select"
import { Textarea } from "@/ux/components/ui/textarea"
import { PROVIDER_META, type Provider } from "@/ux/lib/domain"

type Kind = "STORED" | "AGENT_MANAGED"

const KIND_META: Record<Kind, { label: string; description: string }> = {
  STORED: {
    label: "Stored in Componode",
    description: "Secret values are encrypted at rest and resolved on the hub. Values cannot be read back after saving.",
  },
  AGENT_MANAGED: {
    label: "Resolved on an Import Agent",
    description: "Holds references only. Values live on the agent host as environment variables or files.",
  },
}

interface SecretField {
  key: string
  label: string
  multiline?: boolean
}

const SECRET_FIELDS: Partial<Record<Provider, SecretField[]>> = {
  AWS: [
    { key: "accessKeyId", label: "Access key ID" },
    { key: "secretAccessKey", label: "Secret access key" },
    { key: "region", label: "Default region" },
  ],
  GITHUB: [{ key: "token", label: "Personal access token" }],
  AZURE: [
    { key: "tenantId", label: "Tenant ID" },
    { key: "clientId", label: "Client ID" },
    { key: "clientSecret", label: "Client secret" },
  ],
  ALIBABA_CLOUD: [
    { key: "accessKeyId", label: "Access key ID" },
    { key: "accessKeySecret", label: "Access key secret" },
  ],
  GOOGLE_CLOUD: [{ key: "serviceAccountJson", label: "Service account JSON", multiline: true }],
  KUBERNETES: [{ key: "kubeconfig", label: "Kubeconfig", multiline: true }],
}
const FALLBACK_FIELDS: SecretField[] = [{ key: "token", label: "Token" }]

const PROVIDERS: Provider[] = ["AWS", "GITHUB", "AZURE", "GOOGLE_CLOUD", "ALIBABA_CLOUD", "KUBERNETES", "WEB_URL", "API_URL", "MCP_SERVER"]

const REF_NAME = /^[A-Z][A-Z0-9_]*$|^[a-zA-Z0-9._/-]+$/

export function CredentialForm() {
  const navigate = useNavigate()
  const [label, setLabel] = React.useState("")
  const [provider, setProvider] = React.useState<Provider>("AWS")
  const [kind, setKind] = React.useState<Kind>("STORED")
  const [values, setValues] = React.useState<Record<string, string>>({})
  const [expiresAt, setExpiresAt] = React.useState("")
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [pending, setPending] = React.useState(false)

  const fields = SECRET_FIELDS[provider] ?? FALLBACK_FIELDS
  const setValue = (key: string, v: string) => setValues((prev) => ({ ...prev, [key]: v }))

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const next: Record<string, string> = {}
    if (!label.trim()) next.label = "Label is required."
    for (const f of fields) {
      const v = (values[f.key] ?? "").trim()
      if (!v) next[f.key] = kind === "STORED" ? `${f.label} is required.` : "Reference name is required."
      else if (kind === "AGENT_MANAGED" && !REF_NAME.test(v)) next[f.key] = "Use an environment variable name or a file path without spaces."
    }
    if (expiresAt && new Date(expiresAt).getTime() < Date.now()) next.expiresAt = "The expiry date is in the past."
    setErrors(next)
    if (Object.keys(next).length) return
    setPending(true)
    // Simulated save. Wire to POST /credentials (see /standards/wiring). Never log or echo secret values.
    setTimeout(() => {
      toast.success("Credential created (simulated)")
      navigate("/credentials")
    }, 600)
  }

  return (
    <PageContainer width="narrow">
      <PageHeader
        title="New credential"
        description="Credentials let importers read from a provider. Secret values are write-only: after saving, only masked hints are shown."
      />
      <FormPage onSubmit={handleSubmit} cancelHref="/credentials" submitLabel="Create credential" pending={pending}>
        <FormSection title="Details">
          <FieldGroup>
            <Field data-invalid={errors.label ? true : undefined}>
              <FieldLabel htmlFor="c-label">Label</FieldLabel>
              <Input
                id="c-label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                aria-invalid={errors.label ? true : undefined}
                placeholder="aws-prod-readonly"
              />
              {errors.label ? <FieldError>{errors.label}</FieldError> : <FieldDescription>Prefer a name that states the scope, such as read-only or production.</FieldDescription>}
            </Field>
            <Field>
              <FieldLabel htmlFor="c-provider">Provider</FieldLabel>
              <Select
                value={provider}
                onValueChange={(v) => {
                  setProvider(v as Provider)
                  setValues({})
                  setErrors({})
                }}
              >
                <SelectTrigger id="c-provider" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROVIDERS.map((p) => (
                    <SelectItem key={p} value={p}>
                      {PROVIDER_META[p].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field data-invalid={errors.expiresAt ? true : undefined}>
              <FieldLabel htmlFor="c-expiry">Expires</FieldLabel>
              <Input id="c-expiry" type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} aria-invalid={errors.expiresAt ? true : undefined} />
              {errors.expiresAt ? <FieldError>{errors.expiresAt}</FieldError> : <FieldDescription>Optional. Importers using an expired credential stop running.</FieldDescription>}
            </Field>
          </FieldGroup>
        </FormSection>

        <FormSection title="Where the secret lives">
          <RadioGroup value={kind} onValueChange={(v) => { setKind(v as Kind); setValues({}); setErrors({}) }} className="gap-3">
            {(Object.keys(KIND_META) as Kind[]).map((k) => (
              <label key={k} htmlFor={`kind-${k}`} className="flex cursor-pointer items-start gap-3 rounded-md border p-3 has-[[data-state=checked]]:border-primary">
                <RadioGroupItem id={`kind-${k}`} value={k} className="mt-0.5" />
                <span className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium">{KIND_META[k].label}</span>
                  <span className="text-sm text-muted-foreground">{KIND_META[k].description}</span>
                </span>
              </label>
            ))}
          </RadioGroup>
        </FormSection>

        <FormSection
          title={kind === "STORED" ? `${PROVIDER_META[provider].label} secret values` : "Agent references"}
          description={
            kind === "STORED"
              ? "Encrypted before storage. They are never shown again."
              : "Enter the name of the environment variable or file on the agent host for each value."
          }
        >
          <FieldGroup>
            {fields.map((f) => (
              <Field key={f.key} data-invalid={errors[f.key] ? true : undefined}>
                <FieldLabel htmlFor={`c-${f.key}`}>{kind === "STORED" ? f.label : `${f.label} reference`}</FieldLabel>
                {f.multiline && kind === "STORED" ? (
                  <Textarea
                    id={`c-${f.key}`}
                    rows={5}
                    className="font-mono text-xs"
                    value={values[f.key] ?? ""}
                    onChange={(e) => setValue(f.key, e.target.value)}
                    aria-invalid={errors[f.key] ? true : undefined}
                    autoComplete="off"
                    spellCheck={false}
                  />
                ) : (
                  <Input
                    id={`c-${f.key}`}
                    type={kind === "STORED" && f.key !== "region" && f.key !== "tenantId" && f.key !== "clientId" ? "password" : "text"}
                    className={kind === "AGENT_MANAGED" ? "font-mono" : undefined}
                    value={values[f.key] ?? ""}
                    onChange={(e) => setValue(f.key, e.target.value)}
                    aria-invalid={errors[f.key] ? true : undefined}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder={kind === "AGENT_MANAGED" ? `${provider}_${f.key.replace(/([A-Z])/g, "_$1").toUpperCase()}` : undefined}
                  />
                )}
                {errors[f.key] && <FieldError>{errors[f.key]}</FieldError>}
              </Field>
            ))}
          </FieldGroup>
        </FormSection>
      </FormPage>
    </PageContainer>
  )
}
