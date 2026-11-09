
import { SearchIcon, XIcon } from "lucide-react"
import type * as React from "react"
import { Button } from "@/ux/components/ui/button"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/ux/components/ui/input-group"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/ux/components/ui/select"

export interface FilterDef {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
  /**
   * "Unset" sentinel — the value `dirty` compares against and `Clear`
   * restores via `onChange`. Defaults to `"all"`, which also renders the
   * leading "All" option. Set a domain-native sentinel to suppress "All":
   * e.g. a Hidden/Shown toggle declares `emptyValue: "hide"` with options
   * `[{value:"hide",label:"Hidden"},{value:"show",label:"Shown"}]` — the
   * dropdown then contains only its real choices and the control never
   * snaps back. Must be non-empty (Radix `Select.Item` rejects empty
   * values) and should appear in `options` so the trigger can label it.
   */
  emptyValue?: string
}

interface ListToolbarProps {
  query: string
  onQueryChange: (q: string) => void
  placeholder?: string
  filters?: FilterDef[]
  /** Right-aligned slot, e.g. view toggle or bulk actions. */
  end?: React.ReactNode
  resultCount: number
  total: number
}

const emptyValueOf = (f: FilterDef) => f.emptyValue || "all"

/**
 * Standard list toolbar. Rules:
 * – Search first, then up to 3 single-select filters. Anything more goes in a "More filters" sheet.
 * – Filters declare their "unset" sentinel via `emptyValue` (default `"all"`). Only
 *   `"all"`-sentinel filters get the injected "All" option — hide/show-style
 *   filters render their own options only (spec 068 gone-instances fix).
 * – "Clear" appears only when something is actually filtered: the query is
 *   non-empty or a filter differs from its own `emptyValue`.
 */
export function ListToolbar({ query, onQueryChange, placeholder = "Search…", filters = [], end, resultCount, total }: ListToolbarProps) {
  const dirty = query !== "" || filters.some((f) => f.value !== emptyValueOf(f))
  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
      <div className="flex flex-1 flex-wrap items-center gap-2">
        <InputGroup className="w-full md:max-w-xs">
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput
            type="search"
            aria-label={placeholder}
            placeholder={placeholder}
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
          />
          {query && (
            <InputGroupAddon align="inline-end">
              <InputGroupButton size="icon-xs" aria-label="Clear search" onClick={() => onQueryChange("")}>
                <XIcon />
              </InputGroupButton>
            </InputGroupAddon>
          )}
        </InputGroup>
        {filters.map((f) => {
          const empty = emptyValueOf(f)
          // "All" is the label for the "all" sentinel only — custom sentinels
          // (e.g. "hide") mean the filter's own options are the whole domain.
          const showAll = empty === "all" && !f.options.some((o) => o.value === "all")
          return (
            <Select key={f.id} value={f.value} onValueChange={f.onChange}>
              <SelectTrigger aria-label={f.label} className="w-auto min-w-36">
                <span className="text-muted-foreground">{f.label}:</span>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {showAll && <SelectItem value="all">All</SelectItem>}
                  {f.options.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          )
        })}
        {dirty && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              onQueryChange("")
              for (const f of filters) f.onChange(emptyValueOf(f))
            }}
          >
            Clear
          </Button>
        )}
      </div>
      <div className="flex items-center gap-3">
        <p className="tabular text-sm text-muted-foreground" aria-live="polite">
          {resultCount === total ? `${total} results` : `${resultCount} of ${total}`}
        </p>
        {end}
      </div>
    </div>
  )
}
