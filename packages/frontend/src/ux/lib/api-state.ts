import type { ApiError } from "@/api/client";

/** Query error classifiers for the staged UX state matrix. */

export function isNotFound(err: unknown): boolean {
  const code = (err as ApiError | undefined)?.code;
  return typeof code === "string" && code.endsWith("NOT_FOUND");
}

export function isForbidden(err: unknown): boolean {
  return (err as ApiError | undefined)?.code === "AUTH_FORBIDDEN";
}

export function errorMessage(err: unknown): string {
  return (err as ApiError | undefined)?.message ?? "Something went wrong.";
}
