
import { useNavigate } from "react-router-dom"
import * as React from "react"
import { toast } from "sonner"
import { FormPage, FormSection } from "@/ux/components/forms/form-shell"
import { PageContainer, PageHeader } from "@/ux/components/patterns/page-header"
import { Alert, AlertDescription, AlertTitle } from "@/ux/components/ui/alert"
import { Checkbox } from "@/ux/components/ui/checkbox"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/ux/components/ui/field"
import { Input } from "@/ux/components/ui/input"
import { Textarea } from "@/ux/components/ui/textarea"
import { usePromoteComponent } from "@/api/hooks/components"
import type { ComponentDependent } from "@/api/types"
import { ux } from "@/ux/lib/paths"
import type { Component } from "@/ux/lib/view-types"

const slugify = (s: string) =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")

/**
 * Promote a component to a platform product and reroute consumers.
 * Consumers are the component's real dependents (`GET /components/:id/dependents`).
 */
export function PromoteForm({ component, consumers }: { component: Component; consumers: ComponentDependent[] }) {
  const navigate = useNavigate()
  const promote = usePromoteComponent()
  const [name, setName] = React.useState(component.name)
  const [slug, setSlug] = React.useState("")
  const [description, setDescription] = React.useState("")
  const [checked, setChecked] = React.useState<Set<string>>(() => new Set(consumers.map((c) => c.id)))
  const [errors, setErrors] = React.useState<{ name?: string; slug?: string }>({})


  function toggle(id: string, on: boolean) {
    setChecked((prev) => {
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const next: typeof errors = {}
    if (!name.trim()) next.name = "Name is required."
    if (slug && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) next.slug = "Lowercase letters, numbers and single hyphens only."
    setErrors(next)
    if (Object.keys(next).length) return
    promote.mutate(
      {
        id: component.id,
        input: {
          name: name.trim(),
          slug: slug || slugify(name),
          description: description.trim() || null,
          consumerIds: [...checked],
        },
      },
      {
        onSuccess: (result) => {
          toast.success(`${result.product.name} promoted to a platform product`)
          navigate(ux(`/products/${result.product.slug}`))
        },
        onError: (err) => {
          if ((err as { code?: string }).code === "SLUG_TAKEN") {
            setErrors((p) => ({ ...p, slug: "A product with this slug already exists." }))
            return
          }
          toast.error(err.message)
        },
      },
    )
  }

  return (
    <PageContainer width="narrow">
      <PageHeader
        title={`Promote ${component.name}`}
        description="Create a platform product backed by this component, and point consuming products at it instead."
      />
      <FormPage
        onSubmit={handleSubmit}
        cancelHref={ux(`/components/${component.slug}`)}
        submitLabel={`Promote and reroute ${checked.size} ${checked.size === 1 ? "consumer" : "consumers"}`}
        pending={promote.isPending}
      >
        <FormSection title="Platform product">
          <FieldGroup>
            <Field data-invalid={errors.name ? true : undefined}>
              <FieldLabel htmlFor="pr-name">Name</FieldLabel>
              <Input id="pr-name" value={name} onChange={(e) => setName(e.target.value)} aria-invalid={errors.name ? true : undefined} />
              {errors.name && <FieldError>{errors.name}</FieldError>}
            </Field>
            <Field data-invalid={errors.slug ? true : undefined}>
              <FieldLabel htmlFor="pr-slug">Slug</FieldLabel>
              <Input
                id="pr-slug"
                value={slug}
                className="font-mono"
                placeholder={slugify(name)}
                onChange={(e) => setSlug(e.target.value)}
                aria-invalid={errors.slug ? true : undefined}
              />
              {errors.slug ? <FieldError>{errors.slug}</FieldError> : <FieldDescription>Auto-derived from the name when blank.</FieldDescription>}
            </Field>
            <Field>
              <FieldLabel htmlFor="pr-desc">Description</FieldLabel>
              <Textarea id="pr-desc" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
            </Field>
          </FieldGroup>
        </FormSection>

        <FormSection
          title="Consumers to reroute"
          description="Checked products stop depending on this component directly and consume the new platform product instead."
        >
          {consumers.length === 0 ? (
            <p className="text-sm text-muted-foreground">No products depend on this component. A platform product without consumers will be created.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {consumers.map((c) => (
                <li key={c.id} className="flex items-start gap-3">
                  <Checkbox id={`consumer-${c.id}`} checked={checked.has(c.id)} onCheckedChange={(v) => toggle(c.id, v === true)} className="mt-0.5" />
                  <label htmlFor={`consumer-${c.id}`} className="flex min-w-0 flex-col">
                    <span className="text-sm font-medium">{c.name}</span>
                    <span className="truncate font-mono text-xs text-muted-foreground">{c.slug}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          {checked.size < consumers.length && (
            <Alert>
              <AlertTitle>{consumers.length - checked.size} consumer(s) left unchanged</AlertTitle>
              <AlertDescription>They keep their direct dependency on the component. You can reroute them later from their product page.</AlertDescription>
            </Alert>
          )}
        </FormSection>
      </FormPage>
    </PageContainer>
  )
}
