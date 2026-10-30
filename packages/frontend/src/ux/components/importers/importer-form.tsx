import { useNavigate } from "react-router-dom"
import * as React from "react"
import { toast } from "sonner"
import {
  useCreateImporterConfig,
  useUpdateImporterConfig,
} from "@/api/hooks/importers"
import { fieldErrors, type ApiError } from "@/api/client"
import type { Credential, ImporterConfig, ImporterManifest } from "@/api/types"
import type { ImportAgent } from "@componode/core"
import { FormPage, FormSection } from "@/ux/components/forms/form-shell"
import { PageContainer, PageHeader } from "@/ux/components/patterns/page-header"
import { Alert, AlertDescription, AlertTitle } from "@/ux/components/ui/alert"
import { AlertTriangleIcon } from "lucide-react"
import { Button } from "@/ux/components/ui/button"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/ux/components/ui/field"
import { Input } from "@/ux/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ux/components/ui/select"
import { Switch } from "@/ux/components/ui/switch"
import { Textarea } from "@/ux/components/ui/textarea"
import { ux } from "@/ux/lib/paths"
import { ScopeFields } from "./scope-fields"
import {
  fieldsForSchema,
  defaultsFor,
  scopeFromValues,
  unknownKeys,
  schemaRenderable,
  isRecord,
  type ScopeField,
} from "./scope-schema"

const NONE = "__none__"
const HUB = "__hub__"

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
  cron?: string
  scope?: string
}

const UNKNOWN_FIELD = "__unknown"

// Split a stored/parsed scope into schema-known values, unknown keys,
// rendered JSON text, and the unrecognized-fields buffer — shared by the
// seeding effect and the raw→typed toggle.
function seedScope(
  stored: Record<string, unknown>,
  fields: ScopeField[],
  schema: unknown,
) {
  const unknown = unknownKeys(stored, schema)
  const known = Object.fromEntries(
    Object.entries(stored).filter(([k]) => !(k in unknown)),
  )
  return {
    known,
    unknown,
    unknownText: Object.keys(unknown).length
      ? JSON.stringify(unknown, null, 2)
      : "",
    jsonTexts: Object.fromEntries(
      fields
        .filter((f) => f.kind === "json" && stored[f.key] !== undefined)
        .map((f) => [f.key, JSON.stringify(stored[f.key], null, 2)]),
    ),
  }
}

interface ImporterFormProps {
  config?: ImporterConfig
  manifests: ImporterManifest[]
  credentials: Credential[]
  agents: Pick<ImportAgent, "id" | "name" | "status">[]
}

export function ImporterForm({ config, manifests, credentials, agents }: ImporterFormProps) {
  const navigate = useNavigate()
  const createConfig = useCreateImporterConfig()
  const updateConfig = useUpdateImporterConfig()
  const editing = Boolean(config)
  const initialPreset = !config
    ? "0 */6 * * *"
    : config.schedule === null
      ? "manual"
      : SCHEDULES.some((s) => s.value === config.schedule)
        ? config.schedule
        : "custom"

  const [importerName, setImporterName] = React.useState(config?.importerName ?? manifests[0]?.name ?? "")
  const [label, setLabel] = React.useState(config?.label ?? "")
  const [credentialId, setCredentialId] = React.useState(config?.credentialIds[0] ?? NONE)
  const [agentId, setAgentId] = React.useState(config?.agentId ?? HUB)
  const [preset, setPreset] = React.useState<string>(initialPreset)
  const [cron, setCron] = React.useState(config?.schedule ?? "")
  const [enabled, setEnabled] = React.useState(config?.enabled ?? true)
  const [scopeValues, setScopeValues] = React.useState<Record<string, unknown>>({})
  const [jsonTexts, setJsonTexts] = React.useState<Record<string, string>>({})
  const [unknownText, setUnknownText] = React.useState("")
  const [unknownScope, setUnknownScope] = React.useState<Record<string, unknown>>({})
  const [rawMode, setRawMode] = React.useState(false)
  const [rawText, setRawText] = React.useState("{}")
  const [scopeFieldErrors, setScopeFieldErrors] = React.useState<Record<string, string>>({})
  const [errors, setErrors] = React.useState<Errors>({})

  const boundToAgent = agentId !== HUB
  const manifest = manifests.find((m) => m.name === importerName)
  const requiresSecrets = Boolean(manifest?.secrets?.length)
  const schema = manifest?.configSchema
  const scopeFields = React.useMemo(() => fieldsForSchema(schema), [schema])
  const renderable = schemaRenderable(schema)
  const scopeRequired = scopeFields.filter((f) => f.required).map((f) => f.key)

  // Seed scope state once per (config, importer) pair — the seededFor ref
  // means a manifest refetch (new array identity) can never wipe entered
  // values, and switching importers reseeds from the new schema's defaults
  // so one importer's keys never leak into another's scope (spec 037 US3).
  const manifestsRef = React.useRef(manifests)
  manifestsRef.current = manifests
  const seededFor = React.useRef<string | null>(null)
  React.useEffect(() => {
    const m = manifestsRef.current.find((x) => x.name === importerName)
    const s = m?.configSchema
    const key = `${config?.id ?? "new"}:${importerName}`
    if (seededFor.current === key) return
    // The raw fallback must always mirror the stored scope — a missing
    // schema may never surface an empty editor over real data.
    if (config) {
      setRawText(
        JSON.stringify(isRecord(config.scope) ? config.scope : {}, null, 2),
      )
      // Mark seeded even without a schema — otherwise a manifest refetch
      // would re-run this and wipe raw-mode edits over a stored scope.
      if (!s) {
        seededFor.current = key
        return
      }
    } else if (!s) {
      return
    }
    seededFor.current = key
    const fields = fieldsForSchema(s)
    if (config) {
      const stored = isRecord(config.scope) ? config.scope : {}
      const split = seedScope(stored, fields, s)
      setScopeValues({ ...defaultsFor(fields), ...split.known })
      setJsonTexts(split.jsonTexts)
      setUnknownScope(split.unknown)
      setUnknownText(split.unknownText)
    } else {
      setScopeValues(defaultsFor(fields))
      setJsonTexts({})
      setUnknownScope({})
      setUnknownText("")
      setRawText("{}")
    }
    setScopeFieldErrors({})
  }, [config, importerName, manifest])

  function typedScope(): Record<string, unknown> {
    return scopeFromValues(scopeFields, scopeValues, unknownScope)
  }

  function setScopeValue(key: string, value: unknown) {
    setScopeValues((prev) => ({ ...prev, [key]: value }))
    setScopeFieldErrors((prev) => {
      if (!prev[key]) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })
  }

  function setJsonFieldText(key: string, text: string) {
    setJsonTexts((prev) => ({ ...prev, [key]: text }))
    const label = scopeFields.find((f) => f.key === key)?.label ?? key
    if (!text.trim()) {
      setScopeValue(key, undefined)
      return
    }
    try {
      // Any valid JSON is accepted — the server validates the value's
      // type; the editor only owns syntax (contract rule: JSON fallback).
      setScopeValue(key, JSON.parse(text))
    } catch {
      setScopeFieldErrors((prev) => ({
        ...prev,
        [key]: `${label} must be valid JSON.`,
      }))
    }
  }

  function setUnknownJson(text: string) {
    setUnknownText(text)
    if (!text.trim()) {
      setUnknownScope({})
      setScopeFieldErrors((prev) => {
        const next = { ...prev }
        delete next[UNKNOWN_FIELD]
        return next
      })
      return
    }
    try {
      const parsed = JSON.parse(text)
      if (!isRecord(parsed)) throw new Error("not-object")
      setUnknownScope(parsed)
      setScopeFieldErrors((prev) => {
        const next = { ...prev }
        delete next[UNKNOWN_FIELD]
        return next
      })
    } catch {
      setScopeFieldErrors((prev) => ({
        ...prev,
        [UNKNOWN_FIELD]: "Unrecognized fields must be a valid JSON object.",
      }))
    }
  }

  function toggleScopeMode() {
    if (!rawMode) {
      // Invalid JSON buffers can't be represented in scopeValues —
      // switching would silently drop the edit, so block instead. Covers
      // per-field editors AND the unrecognized-fields buffer.
      const parseJson = (t: string | undefined): unknown => {
        try {
          return JSON.parse(t ?? "")
        } catch {
          return undefined
        }
      }
      const badJson =
        scopeFields.some(
          (f) =>
            f.kind === "json" &&
            Boolean(jsonTexts[f.key]?.trim()) &&
            parseJson(jsonTexts[f.key]) === undefined,
        ) ||
        (Boolean(unknownText.trim()) && !isRecord(parseJson(unknownText)))
      if (badJson) {
        setErrors((prev) => ({
          ...prev,
          scope: "Fix the invalid JSON fields before editing as JSON.",
        }))
        return
      }
      setRawText(JSON.stringify(typedScope(), null, 2))
      setRawMode(true)
      setErrors((prev) => ({ ...prev, scope: undefined }))
      return
    }
    try {
      const parsed = JSON.parse(rawText || "{}")
      if (!isRecord(parsed)) throw new Error("not-object")
      const split = seedScope(parsed, scopeFields, schema)
      // Exactly what raw mode held: absent keys stay absent — deleted
      // defaults must not resurrect on the way back.
      setScopeValues(split.known)
      setJsonTexts(split.jsonTexts)
      setUnknownScope(split.unknown)
      setUnknownText(split.unknownText)
      setScopeFieldErrors({})
      setRawMode(false)
      setErrors((prev) => ({ ...prev, scope: undefined }))
    } catch {
      setErrors((prev) => ({ ...prev, scope: "Scope must be a valid JSON object." }))
    }
  }

  function applyServerErrors(err: unknown) {
    const fe = fieldErrors(err as ApiError)
    // Scope validation issues arrive either as ["scope", key] paths or as
    // bare scope-key paths ([key]) from validateScopeForImporter — both
    // attach to the matching field. Paths that resolve to no field fall
    // back to the section-level error instead of going invisible.
    const known = new Set(scopeFields.map((f) => f.key))
    const fieldsRendered = renderable && !rawMode
    const scoped: [string, string][] = []
    const unresolvable: string[] = []
    for (const [k, v] of Object.entries(fe)) {
      if (k.startsWith("scope.")) {
        const fieldKey = k.slice("scope.".length)
        if (fieldsRendered && known.has(fieldKey)) scoped.push([fieldKey, v])
        else unresolvable.push(`${fieldKey}: ${v}`)
      } else if (fieldsRendered && known.has(k)) {
        scoped.push([k, v])
      } else if (k === "label") {
        setErrors((prev) => ({ ...prev, label: v }))
      } else if (k !== "scope") {
        // Bare paths that resolve to nothing visible (nested indices like
        // "repos.0", unknown keys) still surface at the section level.
        unresolvable.push(`${k}: ${v}`)
      }
    }
    if (scoped.length) {
      setScopeFieldErrors((prev) => ({ ...prev, ...Object.fromEntries(scoped) }))
    }
    if (unresolvable.length) {
      setErrors((prev) => ({ ...prev, scope: unresolvable.join("; ") }))
    }
    // Strict-schema unrecognized_keys issues name keys that live in the
    // Unrecognized-fields block — surface them there, not on a toast only.
    const details = (err as ApiError).details
    if (Array.isArray(details)) {
      const unknownNames = (details as { code?: string; keys?: unknown[] }[])
        .filter((i) => i.code === "unrecognized_keys" && Array.isArray(i.keys))
        .flatMap((i) => i.keys as string[])
      if (unknownNames.length) {
        setScopeFieldErrors((prev) => ({
          ...prev,
          [UNKNOWN_FIELD]: `Server rejected scope keys: ${unknownNames.join(", ")}`,
        }))
      }
    }
    if (fe.scope) setErrors((prev) => ({ ...prev, scope: fe.scope }))
  }
  // Agent-bound configs resolve AGENT_MANAGED references on the agent host;
  // hub-bound configs use stored credentials (spec 026/027).
  const matching = credentials.filter((c) =>
    boundToAgent ? c.kind === "AGENT_MANAGED" : c.kind !== "AGENT_MANAGED",
  )
  const credentialMissing = credentialId !== NONE && !matching.some((c) => c.id === credentialId)

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const next: Errors = {}
    if (!label.trim()) next.label = "Label is required."
    if (preset === "custom" && !isCron(cron)) next.cron = "Enter a five-field cron expression, for example 0 */4 * * *."
    let scope: Record<string, unknown> = {}
    const fieldErrs: Record<string, string> = {}
    if (rawMode || !renderable) {
      try {
        const parsed = JSON.parse(rawText || "{}")
        if (!isRecord(parsed)) {
          next.scope = "Scope must be a JSON object."
        } else {
          scope = parsed
        }
      } catch {
        next.scope = "Scope must be valid JSON."
      }
    } else {
      for (const f of scopeFields) {
        const v = scopeValues[f.key]
        const missing =
          v === undefined ||
          v === "" ||
          (f.kind === "string-list" &&
            (!Array.isArray(v) || v.every((s) => String(s).trim() === "")))
        if (f.required && missing) fieldErrs[f.key] = `${f.label} is required.`
      }
      scope = typedScope()
    }
    // JSON sub-editors / unrecognized-fields parse errors block submit —
    // a live parse error outranks a required-field miss for the same key.
    const blocking = { ...fieldErrs, ...scopeFieldErrors }
    setScopeFieldErrors(blocking)
    setErrors(next)
    if (Object.keys(next).length || Object.keys(blocking).length) return

    const schedule = preset === "manual" ? null : preset === "custom" ? cron : preset
    const input = {
      label: label.trim(),
      scope,
      secretRefs: [] as { key: string; env?: string; file?: string }[],
      credentialIds: credentialId === NONE ? [] : [credentialId],
      agentId: boundToAgent ? agentId : null,
      schedule,
      enabled,
    }
    if (editing) {
      updateConfig.mutate(
        { id: config!.id, ...input },
        {
          onSuccess: () => {
            toast.success(`${label} saved`)
            navigate(ux(`/importers/${config!.id}`))
          },
          onError: (err) => {
            applyServerErrors(err)
            toast.error(err.message)
          },
        },
      )
    } else {
      createConfig.mutate(
        { importerName, ...input },
        {
          onSuccess: (result) => {
            toast.success(`${label} created`)
            navigate(ux(`/importers/${result.config.id}`))
          },
          onError: (err) => {
            applyServerErrors(err)
            toast.error(err.message)
          },
        },
      )
    }
  }

  const pending = createConfig.isPending || updateConfig.isPending

  return (
    <PageContainer width="narrow">
      <PageHeader
        title={editing ? `Edit ${config!.label}` : "New importer"}
        description="An importer discovers components in one provider account on a schedule using a credential."
      />
      {editing && config!.agentIncompatible && (
        <Alert variant="destructive">
          <AlertTriangleIcon />
          <AlertTitle>Bound agent no longer covers this importer</AlertTitle>
          <AlertDescription>
            The agent is revoked or its allowed-importers policy excludes {config!.importerName}. Rebind or adjust the agent policy — the next scheduled run will fail.
          </AlertDescription>
        </Alert>
      )}
      {editing && config!.secretRefsDeprecated && (
        <Alert>
          <AlertTriangleIcon />
          <AlertTitle>Legacy secret references</AlertTitle>
          <AlertDescription>
            This config still uses env/file secret references. Link a stored credential below, or run “convert secrets” from the importer detail page.
          </AlertDescription>
        </Alert>
      )}
      <FormPage
        onSubmit={handleSubmit}
        cancelHref={ux(editing ? `/importers/${config!.id}` : "/importers")}
        submitLabel={editing ? "Save changes" : "Create importer"}
        pending={pending}
      >
        <FormSection title="Source">
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="i-provider">Importer</FieldLabel>
              <Select value={importerName} disabled={editing} onValueChange={setImporterName}>
                <SelectTrigger id="i-provider" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {manifests.map((m) => (
                    <SelectItem key={m.name} value={m.name}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldDescription>
                {editing
                  ? "The importer cannot change after creation. Create a new config instead."
                  : (manifest?.description ?? "")}
              </FieldDescription>
            </Field>
            <Field data-invalid={errors.label ? true : undefined}>
              <FieldLabel htmlFor="i-label">Label</FieldLabel>
              <Input
                id="i-label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                aria-invalid={errors.label ? true : undefined}
                placeholder="AWS: production org"
              />
              {errors.label && <FieldError>{errors.label}</FieldError>}
            </Field>
            <Field>
              <FieldLabel htmlFor="i-agent">Execution</FieldLabel>
              <Select
                value={agentId}
                onValueChange={(v) => {
                  setAgentId(v)
                  setCredentialId(NONE)
                }}
              >
                <SelectTrigger id="i-agent" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={HUB}>Hub (in-process)</SelectItem>
                  {agents.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                      {a.status !== "CONNECTED" ? " (offline)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldDescription>
                {boundToAgent
                  ? "Runs on the selected agent. Only AGENT_MANAGED credentials can be linked."
                  : "Runs inside the hub process on its schedule."}
              </FieldDescription>
            </Field>
            <Field data-invalid={credentialMissing ? true : undefined}>
              <FieldLabel htmlFor="i-cred">Credential</FieldLabel>
              <Select value={credentialId} onValueChange={setCredentialId}>
                <SelectTrigger id="i-cred" className="w-full" aria-invalid={credentialMissing ? true : undefined}>
                  <SelectValue placeholder={matching.length ? "Select a credential" : "No matching credentials"} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>None</SelectItem>
                  {matching.map((c) => (
                    <SelectItem key={c.id} value={c.id} disabled={c.status === "REVOKED"}>
                      {c.label}
                      {c.status !== "ACTIVE" && ` (${c.status.toLowerCase()})`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {credentialMissing ? (
                <FieldError>The linked credential is not valid for this executor.</FieldError>
              ) : (
                <FieldDescription>
                  {requiresSecrets
                    ? `${manifest!.label} needs secrets — link a credential.`
                    : "Optional unless this importer needs secrets."}
                </FieldDescription>
              )}
            </Field>
          </FieldGroup>
        </FormSection>

        <FormSection
          title="Scope"
          description={
            scopeRequired.length
              ? `What the importer reads — orgs, clusters, accounts, URLs. ${manifest?.label} requires: ${scopeRequired.join(", ")}.`
              : "What the importer reads — orgs, clusters, accounts, URLs."
          }
        >
          {renderable && (
            <div className="flex justify-end">
              <Button type="button" variant="outline" size="sm" onClick={toggleScopeMode}>
                {rawMode ? "Edit fields" : "Edit as JSON"}
              </Button>
            </div>
          )}
          {rawMode || !renderable ? (
            <FieldGroup>
              <Field data-invalid={errors.scope ? true : undefined}>
                <FieldLabel htmlFor="i-scope-json">Scope JSON</FieldLabel>
                <Textarea
                  id="i-scope-json"
                  value={rawText}
                  onChange={(e) => setRawText(e.target.value)}
                  rows={6}
                  className="font-mono text-xs"
                  aria-invalid={errors.scope ? true : undefined}
                  placeholder="{}"
                />
                {errors.scope ? (
                  <FieldError>{errors.scope}</FieldError>
                ) : (
                  !renderable && (
                    <FieldDescription>
                      This importer's scope can't be rendered as fields — edit the raw JSON.
                    </FieldDescription>
                  )
                )}
              </Field>
            </FieldGroup>
          ) : (
            <>
              {scopeFields.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  This importer has no configurable scope options.
                </p>
              )}
              <ScopeFields
                fields={scopeFields}
                values={scopeValues}
                jsonTexts={jsonTexts}
                fieldErrors={scopeFieldErrors}
                onValue={setScopeValue}
                onJsonText={setJsonFieldText}
                unknownText={unknownText}
                unknownError={scopeFieldErrors[UNKNOWN_FIELD]}
                onUnknownText={setUnknownJson}
              />
              {errors.scope && <FieldError>{errors.scope}</FieldError>}
            </>
          )}
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
