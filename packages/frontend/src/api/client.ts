const API_BASE = "/api/v1";

function getCsrfToken(): string | null {
  const match = document.cookie.match(/componode_csrf=([^;]+)/);
  return match?.[1] ?? null;
}

export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
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
