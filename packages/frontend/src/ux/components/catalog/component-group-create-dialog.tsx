import * as React from "react"
import { PlusIcon } from "lucide-react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { useCreateComponentGroup } from "@/api/hooks/component-groups"
import { SLUG_RE, deriveSlug } from "@/ux/lib/slug"
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
import { Textarea } from "@/ux/components/ui/textarea"
import { ux } from "@/ux/lib/paths"

const NONE = "__none__"



/**
 * Manual component-group creation (spec 042, G29) — wired to the existing
 * POST /component-groups endpoint. Slug conflicts surface inline.
 */
export function ComponentGroupCreateDialog({ trigger }: { trigger?: React.ReactNode }) {
  const navigate = useNavigate()
  const create = useCreateComponentGroup()
  const teams = useTeams()

  const [open, setOpen] = React.useState(false)
  const [name, setName] = React.useState("")
  const [slug, setSlug] = React.useState("")
  const [slugTouched, setSlugTouched] = React.useState(false)
  const [description, setDescription] = React.useState("")
  const [teamOwnerId, setTeamOwnerId] = React.useState<string>(NONE)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!open) return
    setName("")
    setSlug("")
    setSlugTouched(false)
    setDescription("")
    setTeamOwnerId(NONE)
    setError(null)
  }, [open])

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!name.trim()) return setError("Name is required.")
    if (!SLUG_RE.test(slug)) return setError("Slug must be lowercase kebab-case (a-z, 0-9, -).")
    setError(null)
    create.mutate(
      {
        name: name.trim(),
        slug,
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(teamOwnerId !== NONE ? { teamOwnerId } : {}),
      },
      {
        onSuccess: ({ group }) => {
          toast.success(`Group ${group.name} created`)
          setOpen(false)
          navigate(ux(`/component-groups/${group.slug}`))
        },
        onError: (err) => setError(describeApiError(err as unknown as ApiError)),
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <PlusIcon data-icon="inline-start" />
            New group
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form className="flex flex-col gap-6" onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>New component group</DialogTitle>
            <DialogDescription>
              Bundle components that ship and retire together — products can depend on the whole group at once.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="cg-name">Name</FieldLabel>
              <Input
                id="cg-name"
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
              <FieldLabel htmlFor="cg-slug">Slug</FieldLabel>
              <Input
                id="cg-slug"
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
              <FieldLabel htmlFor="cg-desc">Description</FieldLabel>
              <Textarea id="cg-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
            </Field>
            <Field>
              <FieldLabel htmlFor="cg-team">Owning team</FieldLabel>
              <Select value={teamOwnerId} onValueChange={setTeamOwnerId}>
                <SelectTrigger id="cg-team" className="w-full">
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
