
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

/**
 * Standard list toolbar. Rules:
 * – Search first, then up to 3 single-select filters. Anything more goes in a "More filters" sheet.
 * – Filters default to "All" (value "all") and sync to URL search params in production.
 * – A "Clear" action appears only when something is filtered.
 */
export function ListToolbar({ query, onQueryChange, placeholder = "Search…", filters = [], end, resultCount, total }: ListToolbarProps) {
  const dirty = query !== "" || filters.some((f) => f.value !== "all")
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
        {filters.map((f) => (
          <Select key={f.id} value={f.value} onValueChange={f.onChange}>
            <SelectTrigger aria-label={f.label} className="w-auto min-w-36">
              <span className="text-muted-foreground">{f.label}:</span>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="all">All</SelectItem>
                {f.options.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        ))}
        {dirty && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              onQueryChange("")
              for (const f of filters) f.onChange("all")
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
