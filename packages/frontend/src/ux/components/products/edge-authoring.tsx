import * as React from "react"
import { Link } from "react-router-dom"
import { PlusIcon, XIcon } from "lucide-react"
import { toast } from "sonner"
import { useSession } from "@/api/hooks/auth"
import { useAllComponents } from "@/api/hooks/components"
import { useComponentGroups } from "@/api/hooks/component-groups"
import { useAddEdge, useRemoveEdge, useProducts, type EdgeKind } from "@/api/hooks/products"
import type { ProductRef } from "@/api/types"
import type { ProductGroupEdge } from "@componode/core"
import { Button } from "@/ux/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/ux/components/ui/card"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ux/components/ui/dialog"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/ux/components/ui/field"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/ux/components/ui/select"
import { errorMessage } from "@/ux/lib/api-state"
import { canAccess } from "@/ux/lib/nav"
import { ux } from "@/ux/lib/paths"

const KIND_META: Record<EdgeKind, { label: string; target: string; description: string }> = {
  composes: {
    label: "Composes",
    target: "child product",
    description: "This product composes another product's capabilities.",
  },
  "consumes-from": {
    label: "Consumes from",
    target: "platform product",
    description: "This product consumes from a PLATFORM product.",
  },
  "depends-on": {
    label: "Depends on",
    target: "component or group",
    description: "This product depends on a component or a component group.",
  },
}

export interface EdgeAuthoringProps {
  product: { id: string; name: string; slug: string }
  composes: ProductRef[]
  consumesFrom: ProductRef[]
  /** Components with a DIRECT depends-on edge (group-expanded excluded). */
  dependsOnComponents: { id: string; name: string; slug: string }[]
  dependsOnGroups: ProductGroupEdge[]
}

/**
 * Spec 042 / G31 — add/remove product relations through the existing edge
 * endpoints. Server-side rules (DAG, PLATFORM-only consumes-from, 409 CYCLE)
 * surface via toast with the server message.
 */
export function EdgeAuthoring({ product, composes, consumesFrom, dependsOnComponents, dependsOnGroups }: EdgeAuthoringProps) {
  const session = useSession()
  const canEdit = canAccess(session.data?.role ?? "VIEWER", "EDITOR")
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [kind, setKind] = React.useState<EdgeKind>("composes")
  const [target, setTarget] = React.useState<string>("")
  const [error, setError] = React.useState<string | null>(null)

  const addEdge = useAddEdge()
  const removeEdge = useRemoveEdge()

  // Candidate pools — only fetched while the dialog is open.
  const products = useProducts({}, dialogOpen)
  const components = useAllComponents({}, dialogOpen)
  const groups = useComponentGroups(dialogOpen)

  React.useEffect(() => {
    if (dialogOpen) {
      setKind("composes")
      setTarget("")
      setError(null)
    }
  }, [dialogOpen])

  const allProducts = (products.data?.products ?? []).filter((p) => p.id !== product.id && p.lifecycle !== "RETIRED")
  const composesIds = new Set(composes.map((p) => p.id))
  const consumesIds = new Set(consumesFrom.map((p) => p.id))
  const depComponentIds = new Set(dependsOnComponents.map((c) => c.id))
  const depGroupIds = new Set(dependsOnGroups.map((g) => g.id))

  const composesTargets = allProducts.filter((p) => !composesIds.has(p.id))
  const consumesTargets = allProducts.filter((p) => p.type === "PLATFORM" && !consumesIds.has(p.id))
  const depComponents = (components.data ?? []).filter((c) => !depComponentIds.has(c.id))
  const depGroups = (groups.data?.groups ?? []).filter((g) => !depGroupIds.has(g.id))

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!target) return setError("Choose a target.")
    let body: Record<string, string>
    if (kind === "composes") body = { childId: target }
    else if (kind === "consumes-from") body = { platformId: target }
    else if (target.startsWith("g:")) body = { componentGroupId: target.slice(2) }
    else body = { componentId: target.replace(/^c:/, "") }
    setError(null)
    addEdge.mutate(
      { id: product.id, kind, body },
      {
        onSuccess: () => {
          toast.success(`${KIND_META[kind].label} edge added`)
          setDialogOpen(false)
        },
        onError: (err) => setError(errorMessage(err)),
      },
    )
  }

  const remove = (vars: { kind: EdgeKind; otherId: string; targetKind?: "component" | "group" }) =>
    removeEdge.mutate(
      { id: product.id, ...vars },
      {
        onSuccess: () => toast.success("Relation removed"),
        onError: (e) => toast.error(errorMessage(e)),
      },
    )

  const pending = addEdge.isPending || removeEdge.isPending

  const Section = ({
    title,
    items,
    hrefFor,
    onRemove,
  }: {
    title: string
    items: { id: string; name: string; slug?: string }[]
    hrefFor?: (i: { id: string; name: string; slug?: string }) => string | null
    onRemove?: (i: { id: string; name: string }) => void
  }) => (
    <div className="flex flex-col gap-1.5">
      <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h4>
      {items.length ? (
        <ul className="flex flex-col divide-y">
          {items.map((i) => {
            const href = hrefFor?.(i)
            return (
              <li key={i.id} className="flex items-center justify-between gap-2 py-1.5">
                {href ? (
                  <Link to={href} className="truncate text-sm font-medium underline-offset-4 hover:underline">
                    {i.name}
                  </Link>
                ) : (
                  <span className="truncate text-sm font-medium">{i.name}</span>
                )}
                {canEdit && onRemove && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 shrink-0 text-muted-foreground hover:text-destructive"
                    aria-label={`Remove ${i.name}`}
                    disabled={pending}
                    onClick={() => onRemove(i)}
                  >
                    <XIcon className="size-4" />
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">None yet.</p>
      )}
    </div>
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>Relations</CardTitle>
        <CardDescription>
          Composition, platform consumption, and component dependencies declared by {product.name}.
        </CardDescription>
        {canEdit && (
          <CardAction>
            <Button size="sm" variant="outline" onClick={() => setDialogOpen(true)}>
              <PlusIcon data-icon="inline-start" />
              Add relation
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="grid gap-6 sm:grid-cols-2">
        <Section
          title="Composes"
          items={composes}
          hrefFor={(i) => ux(`/products/${i.slug}`)}
          onRemove={(i) => remove({ kind: "composes", otherId: i.id })}
        />
        <Section
          title="Consumes from"
          items={consumesFrom}
          hrefFor={(i) => ux(`/products/${i.slug}`)}
          onRemove={(i) => remove({ kind: "consumes-from", otherId: i.id })}
        />
        <Section
          title="Depends on components"
          items={dependsOnComponents}
          hrefFor={(i) => ux(`/components/${i.slug}`)}
          onRemove={(i) => remove({ kind: "depends-on", otherId: i.id, targetKind: "component" })}
        />
        <Section
          title="Depends on groups"
          items={dependsOnGroups}
          hrefFor={(i) => ux(`/component-groups/${i.slug}`)}
          onRemove={(i) => remove({ kind: "depends-on", otherId: i.id, targetKind: "group" })}
        />
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <form className="flex flex-col gap-6" onSubmit={submit}>
            <DialogHeader>
              <DialogTitle>Add relation</DialogTitle>
              <DialogDescription>Declare a new edge from {product.name}.</DialogDescription>
            </DialogHeader>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="ea-kind">Relation kind</FieldLabel>
                <Select value={kind} onValueChange={(v) => { setKind(v as EdgeKind); setTarget("") }}>
                  <SelectTrigger id="ea-kind" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="composes">Composes</SelectItem>
                    <SelectItem value="consumes-from">Consumes from</SelectItem>
                    <SelectItem value="depends-on">Depends on</SelectItem>
                  </SelectContent>
                </Select>
                <FieldDescription>{KIND_META[kind].description}</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="ea-target">Target — {KIND_META[kind].target}</FieldLabel>
                <Select value={target} onValueChange={setTarget}>
                  <SelectTrigger id="ea-target" className="w-full">
                    <SelectValue placeholder="Select a target" />
                  </SelectTrigger>
                  <SelectContent>
                    {kind === "composes" &&
                      composesTargets.map((p) => (
                        <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                      ))}
                    {kind === "consumes-from" &&
                      consumesTargets.map((p) => (
                        <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                      ))}
                    {kind === "depends-on" && (
                      <>
                        <SelectGroup>
                          <SelectLabel>Components</SelectLabel>
                          {depComponents.map((c) => (
                            <SelectItem key={c.id} value={`c:${c.id}`}>{c.name}</SelectItem>
                          ))}
                        </SelectGroup>
                        <SelectGroup>
                          <SelectLabel>Component groups</SelectLabel>
                          {depGroups.map((g) => (
                            <SelectItem key={g.id} value={`g:${g.id}`}>{g.name}</SelectItem>
                          ))}
                        </SelectGroup>
                      </>
                    )}
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
              <Button type="submit" disabled={pending}>
                Add relation
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
