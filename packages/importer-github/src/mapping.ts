import type { Environment } from "@componode/core";

export const DEFAULT_ENVIRONMENT_MAPPING: Record<string, Environment> = {
  prod: "PRODUCTION",
  production: "PRODUCTION",
  live: "PRODUCTION",
  staging: "STAGING",
  stage: "STAGING",
  dev: "DEV",
  develop: "DEV",
  test: "TEST",
  qa: "TEST",
  demo: "DEMO",
};

export function resolveEnvironment(
  name: string,
  overrides?: Record<string, Environment>,
): Environment | null {
  const merged = { ...DEFAULT_ENVIRONMENT_MAPPING, ...overrides };
  return merged[name.trim().toLowerCase()] ?? null;
}
