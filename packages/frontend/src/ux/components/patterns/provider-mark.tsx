import { PROVIDER_META, type Provider } from "@/ux/lib/domain"
import { cn } from "@/ux/lib/utils"

/**
 * Monogram tile for a provider. Swap the inner text for the official SVG mark in
 * production (see theSVG / simple-icons); keep the tile size and radius unchanged.
 */
export function ProviderMark({
  provider,
  size = "md",
  className,
}: {
  provider: Provider
  size?: "sm" | "md" | "lg"
  className?: string
}) {
  const meta = PROVIDER_META[provider] ?? PROVIDER_META.OTHER
  return (
    <span
      title={meta.label}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-md border bg-background font-mono font-semibold tracking-tight text-muted-foreground",
        size === "sm" && "size-6 text-[9px]",
        size === "md" && "size-8 text-[10px]",
        size === "lg" && "size-10 text-xs",
        className,
      )}
    >
      <span aria-hidden="true">{meta.short}</span>
      <span className="sr-only">{meta.label}</span>
    </span>
  )
}
