
import { useNavigate } from "react-router-dom"
import * as React from "react"
import { toast } from "sonner"
import { FormPage, FormSection } from "@/ux/components/forms/form-shell"
import { LinksEditor, TagsInput, validateLinks } from "@/ux/components/forms/list-editors"
import { PageContainer, PageHeader } from "@/ux/components/patterns/page-header"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/ux/components/ui/field"
import { Input } from "@/ux/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ux/components/ui/select"
import { Textarea } from "@/ux/components/ui/textarea"
import {
  CRITICALITY_META,
  LIFECYCLE_META,
  PRODUCT_TYPE_META,
  type Criticality,
  type Lifecycle,
  type ProductType,
} from "@/ux/lib/domain"
import { lobs, teams, type Link, type Product } from "@/ux/lib/mock-data"

const NONE = "__none__"

const slugify = (s: string) =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")

interface Errors {
  name?: string
  slug?: string
  links?: Record<number, string>
}

export function ProductForm({ product }: { product?: Product }) {
  const navigate = useNavigate()
  const editing = Boolean(product)
  const [name, setName] = React.useState(product?.name ?? "")
  const [slug, setSlug] = React.useState(product?.slug ?? "")
  const [slugTouched, setSlugTouched] = React.useState(editing)
  const [type, setType] = React.useState<ProductType>(product?.type ?? "BUSINESS_CAPABILITY")
  const [lifecycle, setLifecycle] = React.useState<Lifecycle>(product?.lifecycle ?? "ACTIVE")
  const [criticality, setCriticality] = React.useState<Criticality | typeof NONE>(product?.criticality ?? NONE)
  const [description, setDescription] = React.useState(product?.description ?? "")
  const [lob, setLob] = React.useState(product?.lobOwnerName ?? NONE)
  const [team, setTeam] = React.useState(product?.teamOwnerName ?? NONE)
  const [sunsetAt, setSunsetAt] = React.useState(product?.sunsetAt?.slice(0, 10) ?? "")
  const [tags, setTags] = React.useState<string[]>(product?.tags ?? [])
  const [links, setLinks] = React.useState<Link[]>(product?.links ?? [])
  const [errors, setErrors] = React.useState<Errors>({})
  const [pending, setPending] = React.useState(false)

  const visibleTeams = lob === NONE ? teams : teams.filter((t) => t.lob === lob)

  function validate(): Errors {
    const next: Errors = {}
    if (!name.trim()) next.name = "Name is required."
    if (slug && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) next.slug = "Lowercase letters, numbers and single hyphens only."
    const linkErrors = validateLinks(links)
    if (Object.keys(linkErrors).length) next.links = linkErrors
    return next
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const next = validate()
    setErrors(next)
    if (Object.keys(next).length) return
    setPending(true)
    // Simulated save. Wire to POST /products or PATCH /products/:id (see /standards/wiring).
    setTimeout(() => {
      const finalSlug = slug || slugify(name)
      toast.success(editing ? `Saved ${name} (simulated)` : `Created ${name} (simulated)`)
      navigate(editing ? `/products/${product!.slug}` : "/products")
      void finalSlug
    }, 600)
  }

  return (
    <PageContainer width="narrow">
      <PageHeader
        title={editing ? `Edit ${product!.name}` : "New product"}
        description={
          editing
            ? "Changes apply to the catalog immediately and are recorded in the activity log."
            : "A product is a business-facing capability. Wire components to it afterwards from its dependencies tab."
        }
      />
      <FormPage
        onSubmit={handleSubmit}
        cancelHref={editing ? `/products/${product!.slug}` : "/products"}
        submitLabel={editing ? "Save changes" : "Create product"}
        pending={pending}
      >
        <FormSection title="Identity">
          <FieldGroup>
            <Field data-invalid={errors.name ? true : undefined}>
              <FieldLabel htmlFor="p-name">Name</FieldLabel>
              <Input
                id="p-name"
                value={name}
                required
                aria-invalid={errors.name ? true : undefined}
                onChange={(e) => {
                  setName(e.target.value)
                  if (!slugTouched) setSlug(slugify(e.target.value))
                }}
                placeholder="Checkout"
              />
              {errors.name && <FieldError>{errors.name}</FieldError>}
            </Field>
            <Field data-invalid={errors.slug ? true : undefined}>
              <FieldLabel htmlFor="p-slug">Slug</FieldLabel>
              <Input
                id="p-slug"
                value={slug}
                className="font-mono"
                aria-invalid={errors.slug ? true : undefined}
                onChange={(e) => {
                  setSlugTouched(true)
                  setSlug(e.target.value)
                }}
                placeholder="checkout"
              />
              <FieldDescription>
                {editing ? "Changing the slug breaks existing links to this product." : "Derived from the name. Leave blank to auto-generate."}
              </FieldDescription>
              {errors.slug && <FieldError>{errors.slug}</FieldError>}
            </Field>
            <Field>
              <FieldLabel htmlFor="p-type">Type</FieldLabel>
              <Select value={type} onValueChange={(v) => setType(v as ProductType)}>
                <SelectTrigger id="p-type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(PRODUCT_TYPE_META) as ProductType[]).map((t) => (
                    <SelectItem key={t} value={t}>
                      {PRODUCT_TYPE_META[t].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldDescription>Platform products can be consumed by other products.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="p-desc">Description</FieldLabel>
              <Textarea
                id="p-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                placeholder="What this product does and who relies on it."
              />
            </Field>
          </FieldGroup>
        </FormSection>

        <FormSection title="Ownership" description="Ownership drives the completeness indicator on the product list.">
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="p-lob">Line of business</FieldLabel>
              <Select
                value={lob}
                onValueChange={(v) => {
                  setLob(v)
                  const stillValid = v === NONE || teams.find((t) => t.name === team)?.lob === v
                  if (!stillValid) setTeam(NONE)
                }}
              >
                <SelectTrigger id="p-lob" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Unassigned</SelectItem>
                  {lobs.map((l) => (
                    <SelectItem key={l.id} value={l.name}>
                      {l.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="p-team">Owning team</FieldLabel>
              <Select value={team} onValueChange={setTeam}>
                <SelectTrigger id="p-team" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Unassigned</SelectItem>
                  {visibleTeams.map((t) => (
                    <SelectItem key={t.id} value={t.name}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {lob !== NONE && <FieldDescription>Showing teams in {lob}.</FieldDescription>}
            </Field>
          </FieldGroup>
        </FormSection>

        <FormSection title="Operations">
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="p-crit">Criticality</FieldLabel>
              <Select value={criticality} onValueChange={(v) => setCriticality(v as Criticality | typeof NONE)}>
                <SelectTrigger id="p-crit" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Not set</SelectItem>
                  {(Object.keys(CRITICALITY_META) as Criticality[]).map((c) => (
                    <SelectItem key={c} value={c}>
                      {CRITICALITY_META[c].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="p-life">Lifecycle</FieldLabel>
              <Select value={lifecycle} onValueChange={(v) => setLifecycle(v as Lifecycle)}>
                <SelectTrigger id="p-life" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(LIFECYCLE_META) as Lifecycle[]).map((l) => (
                    <SelectItem key={l} value={l}>
                      {LIFECYCLE_META[l].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="p-sunset">Sunset date</FieldLabel>
              <Input id="p-sunset" type="date" value={sunsetAt} onChange={(e) => setSunsetAt(e.target.value)} />
              <FieldDescription>Products past this date appear in the dashboard attention list until retired.</FieldDescription>
            </Field>
          </FieldGroup>
        </FormSection>

        <FormSection title="Tags and links">
          <TagsInput value={tags} onChange={setTags} />
          <LinksEditor value={links} onChange={setLinks} errors={errors.links} />
        </FormSection>
      </FormPage>
    </PageContainer>
  )
}
