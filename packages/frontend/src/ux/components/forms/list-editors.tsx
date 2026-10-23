
import { PlusIcon, XIcon } from "lucide-react"
import * as React from "react"
import { Badge } from "@/ux/components/ui/badge"
import { Button } from "@/ux/components/ui/button"
import { Field, FieldDescription, FieldLabel } from "@/ux/components/ui/field"
import { Input } from "@/ux/components/ui/input"
import type { Link } from "@/ux/lib/mock-data"

/** Free-form tags. Enter or comma adds; backspace on empty input removes the last. Lowercased and de-duplicated. */
export function TagsInput({
  value,
  onChange,
  id = "tags",
}: {
  value: string[]
  onChange: (next: string[]) => void
  id?: string
}) {
  const [draft, setDraft] = React.useState("")

  function commit() {
    const tag = draft.trim().toLowerCase()
    if (tag && !value.includes(tag)) onChange([...value, tag])
    setDraft("")
  }

  return (
    <Field>
      <FieldLabel htmlFor={id}>Tags</FieldLabel>
      <div className="flex flex-wrap items-center gap-1.5 rounded-md border bg-background px-2 py-1.5 focus-within:ring-2 focus-within:ring-ring/50">
        {value.map((tag) => (
          <Badge key={tag} variant="secondary" className="gap-1">
            {tag}
            <button
              type="button"
              aria-label={`Remove tag ${tag}`}
              className="rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => onChange(value.filter((t) => t !== tag))}
            >
              <XIcon className="size-3" />
            </button>
          </Badge>
        ))}
        <input
          id={id}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault()
              commit()
            } else if (e.key === "Backspace" && !draft && value.length) {
              onChange(value.slice(0, -1))
            }
          }}
          placeholder={value.length ? "" : "Add a tag and press Enter"}
          className="min-w-32 flex-1 bg-transparent py-0.5 text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>
      <FieldDescription>Used for filtering. Lowercase, no spaces recommended.</FieldDescription>
    </Field>
  )
}

/** Title + URL rows. Rows left completely empty are dropped on save; half-filled rows are a validation error. */
export function LinksEditor({
  value,
  onChange,
  errors,
}: {
  value: Link[]
  onChange: (next: Link[]) => void
  errors?: Record<number, string>
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Links</span>
        <Button type="button" variant="outline" size="sm" onClick={() => onChange([...value, { title: "", url: "" }])}>
          <PlusIcon data-icon="inline-start" />
          Add link
        </Button>
      </div>
      {value.length === 0 && (
        <p className="text-sm text-muted-foreground">Runbooks, dashboards, repositories. Shown on the product page.</p>
      )}
      <ul className="flex flex-col gap-3">
        {value.map((link, i) => (
          <li key={i} className="flex flex-col gap-1">
            <div className="flex items-start gap-2">
              <Input
                aria-label={`Link ${i + 1} title`}
                placeholder="Title"
                value={link.title}
                onChange={(e) => onChange(value.map((l, j) => (j === i ? { ...l, title: e.target.value } : l)))}
                className="w-1/3"
              />
              <Input
                aria-label={`Link ${i + 1} URL`}
                placeholder="https://"
                inputMode="url"
                value={link.url}
                aria-invalid={errors?.[i] ? true : undefined}
                onChange={(e) => onChange(value.map((l, j) => (j === i ? { ...l, url: e.target.value } : l)))}
                className="flex-1"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remove link ${i + 1}`}
                onClick={() => onChange(value.filter((_, j) => j !== i))}
              >
                <XIcon />
              </Button>
            </div>
            {errors?.[i] && <p className="text-sm text-destructive">{errors[i]}</p>}
          </li>
        ))}
      </ul>
    </div>
  )
}

export function validateLinks(links: Link[]): Record<number, string> {
  const errors: Record<number, string> = {}
  links.forEach((l, i) => {
    const title = l.title.trim()
    const url = l.url.trim()
    if (!title && !url) return
    if (!title || !url) {
      errors[i] = "Both a title and a URL are required."
      return
    }
    try {
      const parsed = new URL(url)
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") errors[i] = "Use an http or https URL."
    } catch {
      errors[i] = "Enter a valid URL, including https://"
    }
  })
  return errors
}
