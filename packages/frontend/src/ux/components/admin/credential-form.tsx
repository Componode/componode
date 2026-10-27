import { useNavigate } from "react-router-dom"
import * as React from "react"
import { PlusIcon, Trash2Icon } from "lucide-react"
import { toast } from "sonner"
import { FormPage, FormSection } from "@/ux/components/forms/form-shell"
import { PageContainer, PageHeader } from "@/ux/components/patterns/page-header"
import { Button } from "@/ux/components/ui/button"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/ux/components/ui/field"
import { Input } from "@/ux/components/ui/input"
import { RadioGroup, RadioGroupItem } from "@/ux/components/ui/radio-group"
import { useCreateCredential, useUpdateCredential } from "@/api/hooks/credentials"
import { ux } from "@/ux/lib/paths"
import type { SecretRefMap } from "@/api/types"

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

const REF_NAME = /^[A-Z][A-Z0-9_]*$|^[a-zA-Z0-9._/-]+$/
const KEY_NAME = /^[a-zA-Z][a-zA-Z0-9._-]*$/

interface SecretRow {
  key: string
  value: string
}

interface CredentialFormProps {
  /** "rotate" re-keys an existing credential (PATCH secrets only). */
  mode?: "create" | "rotate"
  credential?: { id: string; label: string; kind: Kind; keyHints?: Record<string, string> }
}

export function CredentialForm({ mode = "create", credential }: CredentialFormProps) {
  const navigate = useNavigate()
  const createCred = useCreateCredential()
  const updateCred = useUpdateCredential(credential?.id ?? "")
  const [label, setLabel] = React.useState("")
  const [kind, setKind] = React.useState<Kind>(credential?.kind ?? "STORED")
  const [expiresAt, setExpiresAt] = React.useState("")
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const pending = createCred.isPending || updateCred.isPending
  const rotating = mode === "rotate" && credential !== undefined

  // Rotate: the existing key names are the contract — importers resolve the
  // same keys, only values change. Create: free-form rows; the importer
  // manifests declare which keys each provider expects (docs/importers/*).
  const existingKeys = React.useMemo(
    () => Object.keys(credential?.keyHints ?? {}),
    [credential],
  )
  const [rows, setRows] = React.useState<SecretRow[]>(() =>
    rotating && existingKeys.length
      ? existingKeys.map((key) => ({ key, value: "" }))
      : [{ key: "", value: "" }],
  )

  const setRow = (i: number, patch: Partial<SecretRow>) =>
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)))

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const next: Record<string, string> = {}
    if (!rotating && !label.trim()) next.label = "Label is required."
    const seen = new Set<string>()
    rows.forEach((r, i) => {
      const key = r.key.trim()
      const value = r.value.trim()
      if (!key) next[`key-${i}`] = "Secret key is required."
      else if (!KEY_NAME.test(key)) next[`key-${i}`] = "Use letters, digits, dots, dashes or underscores."
      else if (seen.has(key)) next[`key-${i}`] = "Duplicate key."
      else seen.add(key)
      if (!value) next[`value-${i}`] = kind === "STORED" ? "Value is required." : "Reference name is required."
      else if (kind === "AGENT_MANAGED" && !REF_NAME.test(value))
        next[`value-${i}`] = "Use an environment variable name or a file path without spaces."
    })
    if (!rows.length) next["key-0"] = "Add at least one secret."
    if (!rotating && expiresAt && new Date(expiresAt).getTime() < Date.now()) next.expiresAt = "The expiry date is in the past."
    setErrors(next)
    if (Object.keys(next).length) return

    // Never log or echo secret values — send them straight to the API.
    // AGENT_MANAGED sends references ({env}|{file}), never the values themselves.
    const entries = rows.map((r) => [r.key.trim(), r.value.trim()] as const)
    const secrets = Object.fromEntries(entries)
    const secretRefMap: SecretRefMap = Object.fromEntries(
      entries.map(([k, v]) => [k, /^[A-Z][A-Z0-9_]*$/.test(v) ? { env: v } : { file: v }]),
    )
    const body = kind === "AGENT_MANAGED" ? { kind, secretRefMap } : { kind, secrets }

    const onSuccess = () => {
      toast.success(rotating ? `${credential.label} rotated` : "Credential created")
      navigate(ux(rotating ? `/credentials/${credential.id}` : "/credentials"))
    }
    const onError = (e: Error) => toast.error(e.message)

    if (rotating) {
      // kind is immutable — updateCredentialSchema is .strict() without it.
      updateCred.mutate(kind === "AGENT_MANAGED" ? { secretRefMap } : { secrets }, { onSuccess, onError })
    } else {
      createCred.mutate({ label: label.trim(), expiresAt: expiresAt || null, ...body }, { onSuccess, onError })
    }
  }

  return (
    <PageContainer width="narrow">
      <PageHeader
        title={rotating ? `Rotate ${credential.label}` : "New credential"}
        description={
          rotating
            ? "Replace the secret values. Importers using this credential pick up the new values on their next run."
            : "Credentials hold the secret keys importers expect — see each importer's setup guide for its required keys. Secret values are write-only: after saving, only masked hints are shown."
        }
      />
      <FormPage
        onSubmit={handleSubmit}
        cancelHref={ux(rotating ? `/credentials/${credential.id}` : "/credentials")}
        submitLabel={rotating ? "Rotate secret" : "Create credential"}
        pending={pending}
      >
        {!rotating && (
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
              <Field data-invalid={errors.expiresAt ? true : undefined}>
                <FieldLabel htmlFor="c-expiry">Expires</FieldLabel>
                <Input id="c-expiry" type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} aria-invalid={errors.expiresAt ? true : undefined} />
                {errors.expiresAt ? <FieldError>{errors.expiresAt}</FieldError> : <FieldDescription>Optional. Importers using an expired credential stop running.</FieldDescription>}
              </Field>
            </FieldGroup>
          </FormSection>
        )}

        {!rotating && (
          <FormSection title="Where the secret lives">
            <RadioGroup value={kind} onValueChange={(v) => { setKind(v as Kind); setErrors({}) }} className="gap-3">
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
        )}

        <FormSection
          title={kind === "STORED" ? "Secret values" : "Agent references"}
          description={
            kind === "STORED"
              ? "Encrypted before storage. They are never shown again."
              : "Enter the name of the environment variable or file on the agent host for each value."
          }
        >
          <FieldGroup>
            {rows.map((r, i) => (
              <div key={i} className="flex items-start gap-2">
                <Field className="w-56 shrink-0" data-invalid={errors[`key-${i}`] ? true : undefined}>
                  <FieldLabel htmlFor={`c-key-${i}`}>Key</FieldLabel>
                  <Input
                    id={`c-key-${i}`}
                    className="font-mono text-xs"
                    value={r.key}
                    disabled={rotating}
                    placeholder="token"
                    onChange={(e) => setRow(i, { key: e.target.value })}
                    aria-invalid={errors[`key-${i}`] ? true : undefined}
                  />
                  {errors[`key-${i}`] && <FieldError>{errors[`key-${i}`]}</FieldError>}
                </Field>
                <Field className="flex-1" data-invalid={errors[`value-${i}`] ? true : undefined}>
                  <FieldLabel htmlFor={`c-value-${i}`}>{kind === "STORED" ? "Value" : "Reference"}</FieldLabel>
                  <Input
                    id={`c-value-${i}`}
                    type={kind === "STORED" ? "password" : "text"}
                    autoComplete="new-password"
                    value={r.value}
                    placeholder={kind === "STORED" ? "Secret value" : "MY_SECRET_VAR or path/under/secrets"}
                    onChange={(e) => setRow(i, { value: e.target.value })}
                    aria-invalid={errors[`value-${i}`] ? true : undefined}
                  />
                  {errors[`value-${i}`] && <FieldError>{errors[`value-${i}`]}</FieldError>}
                </Field>
                {!rotating && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="mt-6"
                    onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))}
                    aria-label={`Remove secret row ${i + 1}`}
                  >
                    <Trash2Icon />
                  </Button>
                )}
              </div>
            ))}
            {!rotating && (
              <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => setRows((p) => [...p, { key: "", value: "" }])}>
                <PlusIcon data-icon="inline-start" />
                Add secret
              </Button>
            )}
          </FieldGroup>
        </FormSection>
      </FormPage>
    </PageContainer>
  )
}
