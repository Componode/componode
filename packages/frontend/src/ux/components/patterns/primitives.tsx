
import { CheckIcon, CopyIcon } from "lucide-react"
import * as React from "react"
import { toast } from "sonner"
import { Button } from "@/ux/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ux/components/ui/tooltip"
import { formatDateTime, relativeTime } from "@/ux/lib/format"
import { useUxPrefs } from "@/ux/lib/prefs"
import { cn } from "@/ux/lib/utils"

/** Relative by default, absolute on hover. Always render machine time in `dateTime`. Null renders an em dash — never happened. */
export function RelativeTime({ iso, className }: { iso: string | null; className?: string }) {
  const { relativeTime: relPref } = useUxPrefs()
  if (iso == null) {
    return <span className={cn("text-muted-foreground", className)}>—</span>
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <time dateTime={iso} className={cn("tabular whitespace-nowrap", className)}>
          {relPref ? relativeTime(iso) : formatDateTime(iso)}
        </time>
      </TooltipTrigger>
      <TooltipContent>{formatDateTime(iso)}</TooltipContent>
    </Tooltip>
  )
}

export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = React.useState(false)
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={label}
          onClick={() => {
            navigator.clipboard?.writeText(value)
            setCopied(true)
            toast.success("Copied to clipboard")
            setTimeout(() => setCopied(false), 1500)
          }}
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

/** Identifiers (ARNs, slugs, external IDs) are always mono, truncated, and copyable. */
export function MonoValue({ value, className, copy = true }: { value: string; className?: string; copy?: boolean }) {
  return (
    <span className={cn("inline-flex min-w-0 max-w-full items-center gap-1", className)}>
      <code className="truncate font-mono text-xs text-muted-foreground" title={value}>
        {value}
      </code>
      {copy && <CopyButton value={value} label="Copy identifier" />}
    </span>
  )
}

/** Key/value grid for detail pages. Labels left, values right, consistent rhythm. */
export function DescriptionList({ items, className }: { items: { label: string; value: React.ReactNode }[]; className?: string }) {
  return (
    <dl className={cn("grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-[minmax(8rem,auto)_1fr]", className)}>
      {items.map((item) => (
        <React.Fragment key={item.label}>
          <dt className="text-sm text-muted-foreground">{item.label}</dt>
          <dd className="min-w-0 text-sm">{item.value}</dd>
        </React.Fragment>
      ))}
    </dl>
  )
}
