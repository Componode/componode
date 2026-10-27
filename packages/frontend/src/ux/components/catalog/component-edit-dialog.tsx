import * as React from "react"
import { toast } from "sonner"
import { PencilIcon } from "lucide-react"
import { useUpdateComponent } from "@/api/hooks/components"
import { useComponentGroups } from "@/api/hooks/component-groups"
import { useTeams } from "@/api/hooks/org"
import { describeApiError, type ApiError } from "@/api/client"
import { Button } from "@/ux/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/ux/components/ui/dialog"
import { Field, FieldGroup, FieldLabel } from "@/ux/components/ui/field"
import { Input } from "@/ux/components/ui/input"
import { LinksEditor, TagsInput } from "@/ux/components/forms/list-editors"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ux/components/ui/select"
import type { Component, Link } from "@/ux/lib/view-types"

const NONE = "__none__"

/** Edit a component's governance fields — updateComponentSchema surface. */
export function ComponentEditDialog({ component: c, trigger }: { component: Component; trigger?: React.ReactNode }) {
  const [open, setOpen] = React.useState(false)
  const update = useUpdateComponent()
  const teams = useTeams()
  const groups = useComponentGroups()

  const [teamOwnerId, setTeamOwnerId] = React.useState<string>(NONE)
  const [componentGroupId, setComponentGroupId] = React.useState<string>(NONE)
  const [tags, setTags] = React.useState<string[]>([])
  const [links, setLinks] = React.useState<Link[]>([])
  const [sunset, setSunset] = React.useState("")

  // Unconditional reset on open — never leak a previous component's values.
  React.useEffect(() => {
    if (!open) return
    setTeamOwnerId(c.teamOwnerId ?? NONE)
    setComponentGroupId(c.componentGroupId ?? NONE)
    setTags(c.tags)
    setLinks(c.links)
    setSunset(c.sunsetAt ? c.sunsetAt.slice(0, 10) : "")
  }, [open, c])

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    update.mutate(
      {
        id: c.id,
        teamOwnerId: teamOwnerId === NONE ? null : teamOwnerId,
        componentGroupId: componentGroupId === NONE ? null : componentGroupId,
        tags,
        links,
        sunsetAt: sunset ? new Date(`${sunset}T00:00:00Z`).toISOString() : null,
      },
      {
        onSuccess: () => {
          toast.success("Component updated")
          setOpen(false)
        },
        onError: (err) => toast.error(describeApiError(err as unknown as ApiError)),
      },
    )
  }

  const teamList = teams.data?.teams ?? []
  const groupList = groups.data?.groups ?? []

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="outline">
            <PencilIcon data-icon="inline-start" />
            Edit
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit {c.name}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="ce-team">Owning team</FieldLabel>
              <Select value={teamOwnerId} onValueChange={setTeamOwnerId}>
                <SelectTrigger id="ce-team" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Unowned</SelectItem>
                  {teamList.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="ce-group">Component group</FieldLabel>
              <Select value={componentGroupId} onValueChange={setComponentGroupId}>
                <SelectTrigger id="ce-group" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>No group</SelectItem>
                  {groupList.map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      {g.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="ce-sunset">Sunset date</FieldLabel>
              <Input id="ce-sunset" type="date" value={sunset} onChange={(e) => setSunset(e.target.value)} />
            </Field>
            <Field>
              <TagsInput value={tags} onChange={setTags} id="ce-tags" />
            </Field>
            <Field>
              <LinksEditor value={links} onChange={setLinks} />
            </Field>
          </FieldGroup>
          <DialogFooter className="mt-6">
            <Button type="submit" disabled={update.isPending}>
              {update.isPending ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
