import { Check, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ProductCompleteness } from "@/api/types";

const FACETS = [
  { key: "owner", label: "Owner" },
  { key: "description", label: "Desc" },
  { key: "dependencies", label: "Deps" },
] as const;

/**
 * Spec 023 US4: per-facet completeness indicators — owner, description,
 * and dependency surface rendered independently (FR-014: never combined
 * into a score). Missing facets get the warning tone; satisfied facets
 * stay muted so gaps draw the eye.
 */
export function CompletenessChip({
  completeness,
  className,
}: {
  completeness: ProductCompleteness | undefined;
  className?: string;
}) {
  if (!completeness) return null;
  return (
    <span
      className={cn("inline-flex items-center gap-1", className)}
      data-testid="completeness-chip"
      role="group"
      aria-label="Completeness"
    >
      {FACETS.map((f) => {
        const ok = completeness[f.key];
        return (
          <span
            key={f.key}
            data-facet={f.key}
            data-ok={ok}
            title={`${f.label}: ${ok ? "present" : "missing"}`}
            className={cn(
              "inline-flex items-center gap-0.5 rounded border px-1 py-0.5 text-[10px] leading-none",
              ok
                ? "border-border bg-muted/50 text-muted-foreground"
                : "border-warning/30 bg-warning/15 text-warning",
            )}
          >
            {ok ? (
              <Check className="h-2.5 w-2.5" aria-hidden="true" />
            ) : (
              <Minus className="h-2.5 w-2.5" aria-hidden="true" />
            )}
            {f.label}
          </span>
        );
      })}
    </span>
  );
}
