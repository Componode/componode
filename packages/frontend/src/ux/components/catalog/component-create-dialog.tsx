import * as React from "react"
import { PlusIcon } from "lucide-react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"
import {
  COMPONENT_CATEGORIES,
  COMPONENT_CATEGORY_META,
  COMPONENT_PROVIDERS,
  COMPONENT_PROVIDER_META,
} from "@componode/core"
import { useCreateComponent } from "@/api/hooks/components"
import { SLUG_RE, deriveSlug } from "@/ux/lib/slug"
import { useComponentGroups } from "@/api/hooks/component-groups"
import { useTeams } from "@/api/hooks/org"
import { describeApiError, type ApiError } from "@/api/client"
import { Button } from "@/ux/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/ux/components/ui/dialog"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/ux/components/ui/field"
import { Input } from "@/ux/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ux/components/ui/select"
import { ux } from "@/ux/lib/paths"

const NONE = "__none__"



/**
 * Manual component creation (spec 042, G29) — createComponentSchema surface.
 * Slug conflicts and validation failures surface inline so the form stays
 * filled in.
 */
export function ComponentCreateDialog({ trigger }: { trigger?: React.ReactNode }) {
  const navigate = useNavigate()
  const create = useCreateComponent()
  const teams = useTeams()
  const groups = useComponentGroups()

  const [open, setOpen] = React.useState(false)
  const [name, setName] = React.useState("")
  const [slug, setSlug] = React.useState("")
  const [slugTouched, setSlugTouched] = React.useState(false)
  const [category, setCategory] = React.useState<string>("")
  const [provider, setProvider] = React.useState<string>("")
  const [resourceType, setResourceType] = React.useState("")
  const [teamOwnerId, setTeamOwnerId] = React.useState<string>(NONE)
  const [componentGroupId, setComponentGroupId] = React.useState<string>(NONE)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!open) return
    setName("")
    setSlug("")
    setSlugTouched(false)
    setCategory("")
    setProvider("")
    setResourceType("")
    setTeamOwnerId(NONE)
    setComponentGroupId(NONE)
    setError(null)
  }, [open])

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!name.trim()) return setError("Name is required.")
    if (!SLUG_RE.test(slug)) return setError("Slug must be lowercase kebab-case (a-z, 0-9, -).")
    if (!category) return setError("Category is required.")
    if (!provider) return setError("Provider is required.")
    if (!resourceType.trim()) return setError("Resource type is required (e.g. service).")
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
      },
      {
        onSuccess: ({ component }) => {
          toast.success(`Component ${component.name} created`)
          setOpen(false)
          navigate(ux(`/components/${component.slug}`))
        },
        // Server messages (SLUG_CONFLICT, VALIDATION_FAILED) render inline —
        // the user fixes the field and resubmits.
        onError: (err) => setError(describeApiError(err as unknown as ApiError)),
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="outline">
            <PlusIcon data-icon="inline-start" />
            Add manually
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form className="flex flex-col gap-6" onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>Add component manually</DialogTitle>
            <DialogDescription>
              For assets no importer discovers — a vendor tool, a spreadsheet-tracked service. Lifecycle starts ACTIVE.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="cc-name">Name</FieldLabel>
              <Input
                id="cc-name"
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
              <FieldLabel htmlFor="cc-slug">Slug</FieldLabel>
              <Input
                id="cc-slug"
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
            <Field>
              <FieldLabel htmlFor="cc-category">Category</FieldLabel>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger id="cc-category" className="w-full">
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
              <FieldLabel htmlFor="cc-provider">Provider</FieldLabel>
              <Select value={provider} onValueChange={setProvider}>
                <SelectTrigger id="cc-provider" className="w-full">
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
            <Field>
              <FieldLabel htmlFor="cc-resource-type">Resource type</FieldLabel>
              <Input
                id="cc-resource-type"
                value={resourceType}
                onChange={(e) => setResourceType(e.target.value)}
                placeholder="service"
                required
                autoComplete="off"
              />
              <FieldDescription>The kind of asset inside the provider — e.g. service, rds:db, github:repository.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="cc-team">Owning team</FieldLabel>
              <Select value={teamOwnerId} onValueChange={setTeamOwnerId}>
                <SelectTrigger id="cc-team" className="w-full">
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
              <FieldLabel htmlFor="cc-group">Component group</FieldLabel>
              <Select value={componentGroupId} onValueChange={setComponentGroupId}>
                <SelectTrigger id="cc-group" className="w-full">
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
            {error && <p className="text-sm text-destructive">{error}</p>}
          </FieldGroup>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" type="button">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={create.isPending}>
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
