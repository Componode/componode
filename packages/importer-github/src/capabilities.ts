import type { Logger } from "@componode/core";

export type CapabilityStatus = "OK" | "FORBIDDEN" | "ERROR" | "UNAVAILABLE";

export type CapabilityResult<T> =
  | { status: "OK"; data: T; message?: string }
  | { status: Exclude<CapabilityStatus, "OK">; data?: undefined; message?: string };

export interface CapabilityMarker {
  status: CapabilityStatus;
  message?: string;
}

export type CapabilityMap = Record<string, CapabilityMarker>;

function statusFromError(err: unknown): Exclude<CapabilityStatus, "OK"> {
  const status = (err as { status?: number })?.status;
  if (status === 403) return "FORBIDDEN";
  if (status === 404) return "UNAVAILABLE";
  return "ERROR";
}

export async function withCapability<T>(
  fn: () => Promise<T>,
): Promise<CapabilityResult<T>> {
  try {
    const data = await fn();
    return { status: "OK", data };
  } catch (err) {
    return {
      status: statusFromError(err),
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

export function capabilityMarker<T>(result: CapabilityResult<T>): CapabilityMarker {
  return {
    status: result.status,
    ...(result.message ? { message: result.message } : {}),
  };
}

export function warnIfDegraded(
  logger: Logger,
  key: string,
  marker: CapabilityMarker,
): void {
  if (marker.status !== "OK") {
    logger.warn(`GitHub capability "${key}" unavailable`, {
      status: marker.status,
      message: marker.message ?? null,
    });
  }
}

// Worst-status-wins ordering for capability rollups: unexpected failures
// outrank permission gaps, which outrank missing endpoints, which outrank OK.
const CAPABILITY_STATUS_RANK: Record<CapabilityStatus, number> = {
  OK: 0,
  UNAVAILABLE: 1,
  FORBIDDEN: 2,
  ERROR: 3,
};

export function capabilityStatusRank(status: CapabilityStatus): number {
  return CAPABILITY_STATUS_RANK[status];
}

/** Returns the worse of two markers; ties keep `a` (first-seen wins). */
export function worstCapabilityMarker(
  a: CapabilityMarker,
  b: CapabilityMarker,
): CapabilityMarker {
  return CAPABILITY_STATUS_RANK[b.status] > CAPABILITY_STATUS_RANK[a.status]
    ? b
    : a;
}
