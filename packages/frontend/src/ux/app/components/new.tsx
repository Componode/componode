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
} from "@componode/core"
import { describeApiError, fieldErrors, type ApiError } from "@/api/client"
import { useAllComponentGroups } from "@/api/hooks/component-groups"
import { useTeams } from "@/api/hooks/org"
import { useCreateComponentWithMonitoring } from "@/api/hooks/url-checks"
import { FormPage, FormSection } from "@/ux/components/forms/form-shell"
import { PageContainer, PageHeader } from "@/ux/components/patterns/page-header"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/ux/components/ui/field"
import { Input } from "@/ux/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ux/components/ui/select"
import { ux } from "@/ux/lib/paths"
import { SLUG_RE, deriveSlug } from "@/ux/lib/slug"
import { GroupMultiSelect } from "@/ux/components/catalog/group-multi-select"

const NONE = "__none__"

/**
 * Composite create: the component and its first instance in one
 * transaction — a validation failure creates nothing. URL checks are no
 * longer authored here; they are declared by an ImporterConfig and
 * materialize on the first import run (spec 058).
 */
export function UxComponentNewPage() {
  const navigate = useNavigate()
  const create = useCreateComponentWithMonitoring()
  const teams = useTeams()
  const groups = useAllComponentGroups()

  const [name, setName] = React.useState("")
  const [slug, setSlug] = React.useState("")
  const [slugTouched, setSlugTouched] = React.useState(false)
  const [category, setCategory] = React.useState("")
  const [provider, setProvider] = React.useState("")
  const [resourceType, setResourceType] = React.useState("")
  const [teamOwnerId, setTeamOwnerId] = React.useState(NONE)
  const [componentGroupIds, setComponentGroupIds] = React.useState<string[]>([])

  const [environment, setEnvironment] = React.useState("")
  const [instanceUrl, setInstanceUrl] = React.useState("")
  const [instanceVersion, setInstanceVersion] = React.useState("")
  const [instanceRegion, setInstanceRegion] = React.useState("")

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
    if (!environment) return setError("Pick the environment of the instance.")

    setError(null)

    create.mutate(
      {
        name: name.trim(),
        slug,
        category,
        provider,
        resourceType: resourceType.trim(),
        ...(teamOwnerId !== NONE ? { teamOwnerId } : {}),
        ...(componentGroupIds.length > 0 ? { componentGroupIds } : {}),
        instance: {
          environment: environment as (typeof ENVIRONMENTS)[number],
          ...(instanceUrl.trim() ? { url: instanceUrl.trim() } : {}),
          ...(instanceVersion.trim() ? { version: instanceVersion.trim() } : {}),
          ...(instanceRegion.trim() ? { region: instanceRegion.trim() } : {}),
        },
      },
      {
        onSuccess: ({ component }) => {
          toast.success(`Component ${component.name} created`)
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
        title="New component"
        description="Create the catalog entry and its first instance — URL checks are declared by an importer's configuration."
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
                <GroupMultiSelect
                  id="nc-group"
                  groups={groups.data ?? []}
                  value={componentGroupIds}
                  onChange={setComponentGroupIds}
                />
              </Field>
            </div>
          </FieldGroup>
        </FormSection>

        <FormSection title="Instance" description="The first environment of this component.">
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

        {error && <FieldError>{error}</FieldError>}
        {Object.entries(errors).map(([field, message]) => (
          <FieldError key={field}>{`${field}: ${message}`}</FieldError>
        ))}
      </FormPage>
    </PageContainer>
  )
}
