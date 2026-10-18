import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type SunsetTone = "neutral" | "warning" | "destructive";

export interface SunsetState {
  label: string;
  tone: SunsetTone;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Three-state derivation for the sunset badge (spec 017, US4):
 * - >30d out or RETIRED → neutral `Sunset {date}`
 * - ≤30d out            → warning `Sunset in {n}d`
 * - past + still ACTIVE → destructive `Sunset overdue`
 * A RETIRED entity never shows overdue — it already transitioned.
 */
export function sunsetBadge(
  sunsetAt: string | null | undefined,
  lifecycle: string,
  now: Date = new Date(),
): SunsetState | null {
  if (!sunsetAt) return null;
  const date = new Date(sunsetAt);
  if (Number.isNaN(date.getTime())) return null;
  if (lifecycle === "RETIRED") {
    return { label: `Sunset ${formatDate(date)}`, tone: "neutral" };
  }
  const days = Math.ceil((date.getTime() - now.getTime()) / DAY_MS);
  if (days < 0) return { label: "Sunset overdue", tone: "destructive" };
  if (days <= 30) return { label: `Sunset in ${days}d`, tone: "warning" };
  return { label: `Sunset ${formatDate(date)}`, tone: "neutral" };
}

const TONE_STYLES: Record<SunsetTone, string> = {
  neutral: "bg-muted text-muted-foreground border-border",
  warning: "bg-warning/15 text-warning border-warning/30",
  destructive: "bg-destructive/15 text-destructive border-destructive/30",
};

export function SunsetBadge({
  sunsetAt,
  lifecycle,
  className,
}: {
  sunsetAt: string | null | undefined;
  lifecycle: string;
  className?: string;
}) {
  const state = sunsetBadge(sunsetAt, lifecycle);
  if (!state) return null;
  return (
    <Badge
      variant="outline"
      className={cn(TONE_STYLES[state.tone], className)}
      title={new Date(sunsetAt!).toISOString()}
    >
      {state.label}
    </Badge>
  );
}
