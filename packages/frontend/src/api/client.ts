const API_BASE = "/api/v1";

function getCsrfToken(): string | null {
  const match = document.cookie.match(/componode_csrf=([^;]+)/);
  return match?.[1] ?? null;
}

export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
  "invalid-params"?: { name?: string; reason?: string }[];
}

/** Human-readable error for VALIDATION_FAILED: first zod issue "field: message". */
export function describeApiError(err: ApiError, fallback = "Request failed"): string {
  const issues = Array.isArray(err.details)
    ? (err.details as { path?: (string | number)[]; message?: string }[])
    : [];
  if (err.code === "VALIDATION_FAILED" && issues.length > 0) {
    const first = issues[0]!;
    const field = first.path?.length ? `${first.path.join(".")}: ` : "";
    return `${field}${first.message ?? err.message}`;
  }
  return err.message ?? fallback;
}

/**
 * Field-keyed messages from a VALIDATION_FAILED payload: prefers the
 * RFC 9457-style `invalid-params` ({name, reason}), then the zod `details`
 * array (path.join(".") → message), then a `details` object map. Returns {}
 * for non-validation errors or payloads without per-field detail.
 */
export function fieldErrors(err: ApiError): Record<string, string> {
  if (err.code !== "VALIDATION_FAILED") return {};
  const out: Record<string, string> = {};
  for (const p of err["invalid-params"] ?? []) {
    if (p.name && p.reason) out[p.name] = p.reason;
  }
  if (Object.keys(out).length === 0 && Array.isArray(err.details)) {
    for (const issue of err.details as { path?: (string | number)[]; keys?: string[]; message?: string }[]) {
      // unrecognized_keys issues carry the rejected names in `keys` and an
      // empty `path` — map each key so "Unrecognized key: \"x\"" binds to x.
      for (const k of issue.keys ?? []) {
        if (issue.message) out[k] = issue.message;
      }
      const key = issue.path?.join(".");
      if (key && issue.message) out[key] = issue.message;
    }
  }
  if (
    Object.keys(out).length === 0 &&
    err.details !== null &&
    typeof err.details === "object" &&
    !Array.isArray(err.details)
  ) {
    for (const [k, v] of Object.entries(err.details)) {
      if (typeof v === "string") out[k] = v;
    }
  }
  return out;
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const method = options.method ?? "GET";
  const isStateChanging = ["POST", "PUT", "PATCH", "DELETE"].includes(method);

  const headers: Record<string, string> = {
    ...(options.body !== undefined
      ? { "Content-Type": "application/json" }
      : {}),
    ...((options.headers as Record<string, string>) ?? {}),
  };

  if (isStateChanging) {
    const csrfToken = getCsrfToken();
    if (csrfToken) {
      headers["x-csrf-token"] = csrfToken;
    }
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
    credentials: "include",
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const data = await response.json();

  if (!response.ok) {
    throw data as ApiError;
  }

  return data as T;
}

export { apiFetch as api };
