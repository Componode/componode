import { CheckIcon, MinusIcon } from "lucide-react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ux/components/ui/tooltip"
import { cn } from "@/ux/lib/utils"

const FACETS = [
  { key: "owner", label: "Owner" },
  { key: "description", label: "Description" },
  { key: "dependencies", label: "Dependencies" },
] as const

type Completeness = Record<(typeof FACETS)[number]["key"], boolean>

/** Spec 023: per-facet completeness — never collapsed into a score. */
export function CompletenessIndicator({ value }: { value: Completeness }) {
  const missing = FACETS.filter((f) => !value[f.key])
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex items-center gap-1" aria-label={missing.length ? `Missing: ${missing.map((m) => m.label).join(", ")}` : "Complete"}>
          {FACETS.map((f) => (
            <span
              key={f.key}
              className={cn(
                "inline-flex size-4 items-center justify-center rounded-sm",
                value[f.key] ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
              )}
            >
              {value[f.key] ? <CheckIcon className="size-3" /> : <MinusIcon className="size-3" />}
            </span>
          ))}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <ul className="flex flex-col gap-0.5">
          {FACETS.map((f) => (
            <li key={f.key}>
              {f.label}: {value[f.key] ? "set" : "missing"}
            </li>
          ))}
        </ul>
      </TooltipContent>
    </Tooltip>
  )
}
