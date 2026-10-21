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
  const e = err as { code?: string; statusCode?: number; status?: number };
  const status = e?.statusCode ?? e?.status;
  const name = String(e?.code ?? "");
  if (status === 403 || /forbidden|denied|unauthoriz|NoPermission|not\.authorized/i.test(name))
    return "FORBIDDEN";
  if (status === 404 || /notfound|not\.found/i.test(name)) return "UNAVAILABLE";
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
    logger.warn(`Alibaba Cloud capability "${key}" unavailable`, {
      status: marker.status,
      message: marker.message ?? null,
    });
  }
}
