import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { CRITICALITY_META, type ProductCriticality } from "@componode/core";

/**
 * Product criticality badge (spec 017, US3). Color reads the same way as
 * StatusBadge: destructive = most urgent, muted = least.
 */
const CRITICALITY_STYLES: Record<ProductCriticality, string> = {
  CRITICAL: "bg-destructive/15 text-destructive border-destructive/30",
  HIGH: "bg-warning/15 text-warning border-warning/30",
  MEDIUM: "bg-primary/15 text-primary border-primary/30",
  LOW: "bg-muted text-muted-foreground border-border",
};

export function CriticalityBadge({
  criticality,
  className,
}: {
  criticality: string | null | undefined;
  className?: string;
}) {
  if (!criticality || !(criticality in CRITICALITY_STYLES)) return null;
  const key = criticality as ProductCriticality;
  return (
    <Badge
      variant="outline"
      className={cn("font-normal", CRITICALITY_STYLES[key], className)}
      title={CRITICALITY_META[key].description}
    >
      {CRITICALITY_META[key].label}
    </Badge>
  );
}
