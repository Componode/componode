import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * Fixed enum→color map per docs/ux.md §6. Status color means the same thing
 * everywhere: healthy=success, in-progress=primary, neutral=secondary,
 * warning=warning, bad=destructive, inactive=muted.
 */
const STATUS_STYLES: Record<string, string> = {
  // Healthy / active
  ACTIVE:
    "bg-success/15 text-success border-success/30 dark:bg-success/20",
  RUNNING:
    "bg-success/15 text-success border-success/30 dark:bg-success/20",
  COMPLETED:
    "bg-success/15 text-success border-success/30 dark:bg-success/20",
  // In progress
  PENDING: "bg-warning/15 text-warning border-warning/30",
  QUEUED: "bg-warning/15 text-warning border-warning/30",
  // Bad
  ERROR: "bg-destructive/15 text-destructive border-destructive/30",
  GONE: "bg-destructive/15 text-destructive border-destructive/30",
  FAILED: "bg-destructive/15 text-destructive border-destructive/30",
  REVOKED: "bg-destructive/15 text-destructive border-destructive/30",
  EXPIRED: "bg-destructive/15 text-destructive border-destructive/30",
  // Warning
  EXPIRING: "bg-warning/15 text-warning border-warning/30",
  // Neutral / inactive
  STOPPED: "bg-secondary text-secondary-foreground border-border",
  CANCELLED: "bg-secondary text-secondary-foreground border-border",
  INTERRUPTED: "bg-secondary text-secondary-foreground border-border",
  RETIRED: "bg-muted text-muted-foreground border-border",
};

export function StatusBadge({
  status,
  className,
}: {
  status: string;
  className?: string;
}) {
  return (
    <Badge
      variant="outline"
      className={cn("gap-1.5", STATUS_STYLES[status] ?? "bg-muted text-muted-foreground border-border", className)}
    >
      <span
        data-status-dot
        aria-hidden="true"
        className="size-1.5 rounded-full bg-current"
      />
      {status}
    </Badge>
  );
}
