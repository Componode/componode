import { StatusBadge } from "@/components/states/status-badge";
import type { ProductHealth, ProductHealthStatus } from "@componode/core";

/**
 * Derived product health badge (ADR-112, spec 019). `null`/absence renders a
 * muted "—" (FR-015); when a perEnv breakdown is available it appears as a
 * native tooltip (FR-017).
 */
export function HealthBadge({
  status,
  perEnv,
}: {
  status: ProductHealthStatus | null | undefined;
  perEnv?: ProductHealth["perEnv"];
}) {
  if (!status) {
    return (
      <span className="text-muted-foreground" title="No health data">
        —
      </span>
    );
  }
  const breakdown = perEnv
    ? Object.entries(perEnv)
        .map(([env, s]) => `${env}: ${s}`)
        .join(", ")
    : undefined;
  return (
    <span title={breakdown || undefined}>
      <StatusBadge status={status} className="font-normal" />
    </span>
  );
}
