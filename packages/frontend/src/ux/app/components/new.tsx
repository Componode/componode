import * as React from "react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"
import {
  COMPONENT_CATEGORIES,
  COMPONENT_CATEGORY_META,
  COMPONENT_PROVIDERS,
  COMPONENT_PROVIDER_META,
  ENVIRONMENTS,
  ENVIRONMENT_META,
  URL_CHECK_DEFAULT_CADENCE_SECONDS,
  URL_CHECK_MAX_CADENCE_SECONDS,
  URL_CHECK_MIN_CADENCE_SECONDS,
} from "@componode/core"
import { describeApiError, fieldErrors, type ApiError } from "@/api/client"
import { useAgents } from "@/api/hooks/agents"
import { useComponentGroups } from "@/api/hooks/component-groups"
import { useTeams } from "@/api/hooks/org"
import { useCreateComponentWithMonitoring } from "@/api/hooks/url-checks"
import { parseStatusesInput } from "@/api/mappers/monitoring"
import { FormPage, FormSection } from "@/ux/components/forms/form-shell"
import { emptyCheckRow, UrlCheckRows, type UrlCheckRowDraft } from "@/ux/components/forms/url-check-rows"
import { PageContainer, PageHeader } from "@/ux/components/patterns/page-header"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/ux/components/ui/field"
import { Input } from "@/ux/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ux/components/ui/select"
import type { UrlCheckVantage } from "@/ux/lib/domain"
import { ux } from "@/ux/lib/paths"
import { SLUG_RE, deriveSlug } from "@/ux/lib/slug"

const NONE = "__none__"
const URL_RE = /^https?:\/\//i

/** Lazy — mounted only when vantage is AGENT, so the ADMIN-gated /agents list is fetched only when needed. */
function AgentPicker({ agentId, setAgentId }: { agentId: string; setAgentId: (v: string) => void }) {
  const agents = useAgents()
  if (agents.isError) {
    return (
      <Field>
        <FieldLabel>Import Agent</FieldLabel>
        <FieldDescription>Picking an Import Agent requires the Admin role.</FieldDescription>
      </Field>
    )
  }
  return (
    <Field>
      <FieldLabel htmlFor="nc-agent">Import Agent</FieldLabel>
      <Select value={agentId} onValueChange={setAgentId}>
        <SelectTrigger id="nc-agent" className="w-full">
          <SelectValue placeholder="Select an agent" />
        </SelectTrigger>
        <SelectContent>
          {(agents.data?.agents ?? []).map((a) => (
            <SelectItem key={a.id} value={a.id}>
              {a.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <FieldDescription>When the agent is offline, scheduled probes are recorded as missed — shown as a coverage gap.</FieldDescription>
    </Field>
  )
}

/**
 * Composite create (spec 051 US5): the component, its first instance, the
 * shared monitoring defaults, and the first URL checks are created in one
 * transaction — a validation failure creates nothing.
 */
export function UxComponentNewPage() {
  const navigate = useNavigate()
  const create = useCreateComponentWithMonitoring()
  const teams = useTeams()
  const groups = useComponentGroups()

  const [name, setName] = React.useState("")
  const [slug, setSlug] = React.useState("")
  const [slugTouched, setSlugTouched] = React.useState(false)
  const [category, setCategory] = React.useState("")
  const [provider, setProvider] = React.useState("")
  const [resourceType, setResourceType] = React.useState("")
  const [teamOwnerId, setTeamOwnerId] = React.useState(NONE)
  const [componentGroupId, setComponentGroupId] = React.useState(NONE)

  const [environment, setEnvironment] = React.useState("")
  const [instanceUrl, setInstanceUrl] = React.useState("")
  const [instanceVersion, setInstanceVersion] = React.useState("")
  const [instanceRegion, setInstanceRegion] = React.useState("")

  const [cadenceInput, setCadenceInput] = React.useState(String(URL_CHECK_DEFAULT_CADENCE_SECONDS))
  const [vantage, setVantage] = React.useState<UrlCheckVantage>("HUB")
  const [agentId, setAgentId] = React.useState("")

  const [rows, setRows] = React.useState<UrlCheckRowDraft[]>([emptyCheckRow()])
  const [error, setError] = React.useState<string | null>(null)
  const [errors, setErrors] = React.useState<Record<string, string>>({})

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setErrors({})
    if (!name.trim()) return setError("Name is required.")
    if (!SLUG_RE.test(slug)) return setError("Slug must be lowercase kebab-case (a-z, 0-9, -).")
    if (!category) return setError("Category is required.")
    if (!provider) return setError("Provider is required.")
    if (!resourceType.trim()) return setError("Resource type is required (e.g. service).")
    if (!environment) return setError("Pick the environment of the instance the checks monitor.")

    const cadence = Number(cadenceInput)
    if (!Number.isInteger(cadence) || cadence < URL_CHECK_MIN_CADENCE_SECONDS || cadence > URL_CHECK_MAX_CADENCE_SECONDS) {
      return setError(`Monitoring cadence must be ${URL_CHECK_MIN_CADENCE_SECONDS}–${URL_CHECK_MAX_CADENCE_SECONDS} seconds.`)
    }
    if (vantage === "AGENT" && !agentId) return setError("Select the Import Agent probes run from.")

    const checks = []
    for (const [index, row] of rows.entries()) {
      if (!row.name.trim()) return setError(`Check ${index + 1}: name is required.`)
      if (!row.url.trim() || !URL_RE.test(row.url.trim())) {
        return setError(`Check ${index + 1}: URL must start with http:// or https://.`)
      }
      const policy = parseStatusesInput(row.statuses)
      if (policy.error) return setError(`Check ${index + 1}: ${policy.error}`)
      let checkCadence: number | null = null
      if (row.cadence.trim() !== "") {
        const n = Number(row.cadence)
        if (!Number.isInteger(n) || n < URL_CHECK_MIN_CADENCE_SECONDS || n > URL_CHECK_MAX_CADENCE_SECONDS) {
          return setError(`Check ${index + 1}: cadence must be ${URL_CHECK_MIN_CADENCE_SECONDS}–${URL_CHECK_MAX_CADENCE_SECONDS} seconds.`)
        }
        checkCadence = n
      }
      checks.push({
        name: row.name.trim(),
        url: row.url.trim(),
        method: row.method,
        enabled: true,
        authMode: "NONE",
        cadenceSeconds: checkCadence,
        successPolicy: policy.policy,
      })
    }
    if (checks.length === 0) return setError("Add at least one URL check.")
    setError(null)

    create.mutate(
      {
        name: name.trim(),
        slug,
        category,
        provider,
        resourceType: resourceType.trim(),
        ...(teamOwnerId !== NONE ? { teamOwnerId } : {}),
        ...(componentGroupId !== NONE ? { componentGroupId } : {}),
        instance: {
          environment: environment as (typeof ENVIRONMENTS)[number],
          ...(instanceUrl.trim() ? { url: instanceUrl.trim() } : {}),
          ...(instanceVersion.trim() ? { version: instanceVersion.trim() } : {}),
          ...(instanceRegion.trim() ? { region: instanceRegion.trim() } : {}),
        },
        monitoring: {
          setup: {
            cadenceSeconds: cadence,
            vantage,
            agentId: vantage === "AGENT" ? agentId : null,
          },
          checks,
        },
      },
      {
        onSuccess: ({ component }) => {
          toast.success(`Component ${component.name} created with ${checks.length} check${checks.length === 1 ? "" : "s"}`)
          navigate(ux(`/components/${component.slug}`))
        },
        onError: (err) => {
          const apiErr = err as unknown as ApiError
          setErrors(fieldErrors(apiErr))
          setError(describeApiError(apiErr))
        },
      },
    )
  }

  return (
    <PageContainer width="narrow">
      <PageHeader
        title="New component with URL checks"
        description="Create the catalog entry, its first instance, and the checks that probe it — all in one step."
      />
      <FormPage onSubmit={onSubmit} cancelHref={ux("/components")} submitLabel="Create component" pending={create.isPending}>
        <FormSection title="Component" description="The catalog entry — same fields as Add manually.">
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="nc-name">Name</FieldLabel>
              <Input
                id="nc-name"
                value={name}
                onChange={(e) => {
                  setName(e.target.value)
                  if (!slugTouched) setSlug(deriveSlug(e.target.value))
                }}
                required
                autoComplete="off"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="nc-slug">Slug</FieldLabel>
              <Input
                id="nc-slug"
                value={slug}
                onChange={(e) => {
                  setSlugTouched(true)
                  setSlug(e.target.value)
                }}
                className="font-mono"
                required
                autoComplete="off"
              />
              <FieldDescription>Stable identifier used in URLs.</FieldDescription>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="nc-category">Category</FieldLabel>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger id="nc-category" className="w-full">
                    <SelectValue placeholder="Select a category" />
                  </SelectTrigger>
                  <SelectContent>
                    {COMPONENT_CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {COMPONENT_CATEGORY_META[c].label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="nc-provider">Provider</FieldLabel>
                <Select value={provider} onValueChange={setProvider}>
                  <SelectTrigger id="nc-provider" className="w-full">
                    <SelectValue placeholder="Select a provider" />
                  </SelectTrigger>
                  <SelectContent>
                    {COMPONENT_PROVIDERS.map((p) => (
                      <SelectItem key={p} value={p}>
                        {COMPONENT_PROVIDER_META[p].label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="nc-resource-type">Resource type</FieldLabel>
              <Input
                id="nc-resource-type"
                value={resourceType}
                onChange={(e) => setResourceType(e.target.value)}
                placeholder="service"
                required
                autoComplete="off"
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="nc-team">Owning team</FieldLabel>
                <Select value={teamOwnerId} onValueChange={setTeamOwnerId}>
                  <SelectTrigger id="nc-team" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Unowned</SelectItem>
                    {(teams.data?.teams ?? []).map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="nc-group">Component group</FieldLabel>
                <Select value={componentGroupId} onValueChange={setComponentGroupId}>
                  <SelectTrigger id="nc-group" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>No group</SelectItem>
                    {(groups.data?.groups ?? []).map((g) => (
                      <SelectItem key={g.id} value={g.id}>
                        {g.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
          </FieldGroup>
        </FormSection>

        <FormSection title="Instance" description="The environment the new checks monitor.">
          <FieldGroup>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="nc-environment">Environment</FieldLabel>
                <Select value={environment} onValueChange={setEnvironment}>
                  <SelectTrigger id="nc-environment" className="w-full">
                    <SelectValue placeholder="Select an environment" />
                  </SelectTrigger>
                  <SelectContent>
                    {ENVIRONMENTS.map((env) => (
                      <SelectItem key={env} value={env}>
                        {ENVIRONMENT_META[env].label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="nc-instance-url">URL</FieldLabel>
                <Input
                  id="nc-instance-url"
                  value={instanceUrl}
                  onChange={(e) => setInstanceUrl(e.target.value)}
                  placeholder="https://… (optional)"
                  autoComplete="off"
                  className="font-mono"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="nc-version">Version</FieldLabel>
                <Input
                  id="nc-version"
                  value={instanceVersion}
                  onChange={(e) => setInstanceVersion(e.target.value)}
                  placeholder="Optional"
                  autoComplete="off"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="nc-region">Region</FieldLabel>
                <Input
                  id="nc-region"
                  value={instanceRegion}
                  onChange={(e) => setInstanceRegion(e.target.value)}
                  placeholder="Optional"
                  autoComplete="off"
                />
              </Field>
            </div>
          </FieldGroup>
        </FormSection>

        <FormSection
          title="Monitoring defaults"
          description="Shared by every check on this component — cadence and where probes run from."
        >
          <FieldGroup>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="nc-cadence">Probe cadence (seconds)</FieldLabel>
                <Input
                  id="nc-cadence"
                  value={cadenceInput}
                  onChange={(e) => setCadenceInput(e.target.value)}
                  inputMode="numeric"
                  autoComplete="off"
                />
                <FieldDescription>
                  {URL_CHECK_MIN_CADENCE_SECONDS}–{URL_CHECK_MAX_CADENCE_SECONDS} seconds; default {URL_CHECK_DEFAULT_CADENCE_SECONDS}.
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="nc-vantage">Execution vantage</FieldLabel>
                <Select value={vantage} onValueChange={(v) => setVantage(v as UrlCheckVantage)}>
                  <SelectTrigger id="nc-vantage" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="HUB">Hub — probes run on this server</SelectItem>
                    <SelectItem value="AGENT">Import Agent — probes run on a remote agent</SelectItem>
                  </SelectContent>
                </Select>
                <FieldDescription>Metrics are phrased as “reachable from” this vantage.</FieldDescription>
              </Field>
            </div>
            {vantage === "AGENT" && <AgentPicker agentId={agentId} setAgentId={setAgentId} />}
          </FieldGroup>
        </FormSection>

        <FormSection title="URL checks" description="Each check probes one URL on the new instance on the shared schedule.">
          <UrlCheckRows rows={rows} onChange={setRows} />
        </FormSection>

        {error && <FieldError>{error}</FieldError>}
        {Object.entries(errors).map(([field, message]) => (
          <FieldError key={field}>{`${field}: ${message}`}</FieldError>
        ))}
      </FormPage>
    </PageContainer>
  )
}
