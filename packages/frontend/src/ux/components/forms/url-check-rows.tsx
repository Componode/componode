import * as React from "react"
import { ChevronDownIcon, PlusIcon, XIcon } from "lucide-react"
import { Button } from "@/ux/components/ui/button"
import { Field, FieldLabel } from "@/ux/components/ui/field"
import { Input } from "@/ux/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ux/components/ui/select"
import { cn } from "@/ux/lib/utils"
import type { UrlCheckMethod } from "@/ux/lib/domain"

export interface UrlCheckRowDraft {
  key: string
  name: string
  url: string
  method: UrlCheckMethod
  /** Accepted-statuses input, e.g. "200-299,301" — parsed on submit. */
  statuses: string
  /** Cadence override in seconds; empty = inherit the monitoring default. */
  cadence: string
}

let nextKey = 0
export const emptyCheckRow = (): UrlCheckRowDraft => ({
  key: `row-${++nextKey}`,
  name: "",
  url: "",
  method: "GET",
  statuses: "200-299",
  cadence: "",
})

/**
 * Repeated check rows for the composite create flow (spec 051 US5).
 * Controlled: the parent page owns `rows` and validates on submit —
 * checks land on the instance created in the same transaction.
 */
export function UrlCheckRows({
  rows,
  onChange,
}: {
  rows: UrlCheckRowDraft[]
  onChange: (rows: UrlCheckRowDraft[]) => void
}) {
  const [advanced, setAdvanced] = React.useState<ReadonlySet<string>>(new Set())
  const toggleAdvanced = (key: string) =>
    setAdvanced((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const patch = (key: string, p: Partial<UrlCheckRowDraft>) =>
    onChange(rows.map((r) => (r.key === key ? { ...r, ...p } : r)))

  return (
    <div className="flex flex-col gap-4">
      {rows.map((row, index) => {
        const open = advanced.has(row.key)
        return (
          <div key={row.key} className="flex flex-col gap-3 rounded-lg border p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-muted-foreground">Check {index + 1}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={`Remove check ${index + 1}`}
                disabled={rows.length === 1}
                onClick={() => onChange(rows.filter((r) => r.key !== row.key))}
              >
                <XIcon className="size-3.5" />
              </Button>
            </div>
            <div className="grid gap-3 sm:grid-cols-[1fr_2fr_minmax(5rem,auto)]">
              <Field>
                <FieldLabel htmlFor={`ucr-name-${row.key}`}>Name</FieldLabel>
                <Input
                  id={`ucr-name-${row.key}`}
                  value={row.name}
                  onChange={(e) => patch(row.key, { name: e.target.value })}
                  placeholder="Storefront"
                  autoComplete="off"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={`ucr-url-${row.key}`}>URL</FieldLabel>
                <Input
                  id={`ucr-url-${row.key}`}
                  value={row.url}
                  onChange={(e) => patch(row.key, { url: e.target.value })}
                  placeholder="https://…"
                  autoComplete="off"
                  className="font-mono"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={`ucr-method-${row.key}`}>Method</FieldLabel>
                <Select value={row.method} onValueChange={(v) => patch(row.key, { method: v as UrlCheckMethod })}>
                  <SelectTrigger id={`ucr-method-${row.key}`} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="GET">GET</SelectItem>
                    <SelectItem value="HEAD">HEAD</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-expanded={open}
                onClick={() => toggleAdvanced(row.key)}
              >
                <ChevronDownIcon className={cn("size-4 transition-transform", open && "rotate-180")} data-icon="inline-start" />
                Advanced
              </Button>
            </div>
            {open && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor={`ucr-statuses-${row.key}`}>Accepted statuses</FieldLabel>
                  <Input
                    id={`ucr-statuses-${row.key}`}
                    value={row.statuses}
                    onChange={(e) => patch(row.key, { statuses: e.target.value })}
                    placeholder="200-299,301"
                    autoComplete="off"
                    className="font-mono"
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor={`ucr-cadence-${row.key}`}>Cadence override (seconds)</FieldLabel>
                  <Input
                    id={`ucr-cadence-${row.key}`}
                    value={row.cadence}
                    onChange={(e) => patch(row.key, { cadence: e.target.value })}
                    placeholder="Inherit default"
                    inputMode="numeric"
                    autoComplete="off"
                  />
                </Field>
              </div>
            )}
          </div>
        )
      })}
      <div>
        <Button type="button" variant="outline" size="sm" onClick={() => onChange([...rows, emptyCheckRow()])}>
          <PlusIcon data-icon="inline-start" />
          Add another URL
        </Button>
      </div>
    </div>
  )
}
