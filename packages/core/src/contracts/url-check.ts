import type {
  UrlCheckAuthMode,
  UrlCheckErrorType,
  UrlCheckMethod,
  UrlCheckOutcome,
  UrlCheckVantage,
  UrlCheckWindowParam,
} from "../constants/url-check.js";

// Shared per-Component monitoring configuration (ADR-123 item 4).
export interface MonitoringSetup {
  id: string;
  componentId: string;
  cadenceSeconds: number;
  vantage: UrlCheckVantage;
  agentId: string | null;
  // Display name of the executing agent (null for HUB vantage).
  agentName: string | null;
  createdAt: string;
  updatedAt: string;
}

// Accepted statuses: explicit codes and/or inclusive ranges. Default is
// {"codes":[],"ranges":[{"min":200,"max":299}]} (ADR-123 item 6).
export interface SuccessPolicy {
  codes: number[];
  ranges: Array<{ min: number; max: number }>;
}

// authConfig maps logical fields to credential KEY NAMES — never values.
export interface BasicAuthConfig {
  usernameKey: string;
  passwordKey: string;
}
export interface BearerAuthConfig {
  tokenKey: string;
}
export interface CustomHeadersAuthConfig {
  headers: Array<{ name: string; key: string }>;
}
export type UrlCheckAuthConfig =
  BasicAuthConfig | BearerAuthConfig | CustomHeadersAuthConfig;

export interface UrlCheck {
  id: string;
  setupId: string;
  componentInstanceId: string;
  // ImporterConfig-declared check identity (spec 058); null = legacy/manual.
  managedKey: string | null;
  credentialId: string | null;
  name: string;
  url: string;
  method: UrlCheckMethod;
  enabled: boolean;
  // null → inherit the monitoring setup's cadenceSeconds.
  cadenceSeconds: number | null;
  successPolicy: SuccessPolicy;
  authMode: UrlCheckAuthMode;
  authConfig: UrlCheckAuthConfig | null;
  availabilityTarget: number | null;
  targetWindow: "24H" | "7D" | "30D" | null;
  nextProbeAt: string | null;
  // null → inherit URL_CHECK_AUTO_DISABLE_AFTER; 0 → never auto-disable
  // (spec 056, ADR-124 Amendment 3).
  autoDisableAfter: number | null;
  // Server-managed: consecutive non-SUCCESS observations (FAILURE|MISSED).
  consecutiveFailures: number;
  // Set only by the auto-disable transition; distinguishes auto-disable
  // from a manual disable. Cleared on re-enable.
  autoDisabledAt: string | null;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UrlCheckObservation {
  id: string;
  urlCheckId: string;
  scheduledAt: string;
  outcome: UrlCheckOutcome;
  httpStatus: number | null;
  durationMs: number | null;
  errorType: UrlCheckErrorType | null;
  vantage: UrlCheckVantage;
  agentId: string | null;
  createdAt: string;
}

// Latest-observation summary embedded in list responses.
export interface UrlCheckLatest {
  scheduledAt: string;
  outcome: UrlCheckOutcome;
  httpStatus: number | null;
  durationMs: number | null;
  errorType: UrlCheckErrorType | null;
  vantage: UrlCheckVantage;
}

// Compact 24h rollup embedded in the Component checks list (spec 053) —
// same formula semantics as UrlCheckMetrics so the surfaces cannot drift.
export interface UrlCheckSummary {
  // Fixed rolling window for the compact summary.
  window: "24h";
  // SUCCESS / (SUCCESS + FAILURE + MISSED); null when nothing scheduled.
  availability: number | null;
  // percentile_cont(0.95) over SUCCESS durations; null when none.
  p95: number | null;
  // Share of scheduled slots that never ran (monitor-side downtime).
  coverageGap: number;
  counts: { success: number; failure: number; missed: number };
}

export interface UrlCheckListItem extends UrlCheck {
  // ImporterConfig owning this managed check — the only edit surface.
  managedByConfigId: string | null;
  latest: UrlCheckLatest | null;
  // Always present; null inner fields are the no-data signal.
  summary: UrlCheckSummary;
  // ≤12 most recent observations, scheduledAt desc — the dot-strip payload.
  recent: UrlCheckObservation[];
}

export interface UrlCheckMetrics {
  window: UrlCheckWindowParam;
  // SUCCESS / (SUCCESS + FAILURE + MISSED); null when nothing was scheduled.
  availability: number | null;
  // FAILURE / (SUCCESS + FAILURE); null when nothing executed.
  errorRate: number | null;
  // Share of scheduled slots that never ran (monitor-side downtime).
  coverageGap: number;
  // Request-start → response-headers percentiles over SUCCESS observations.
  p50: number | null;
  p95: number | null;
  p99: number | null;
  counts: { success: number; failure: number; missed: number };
  latest: UrlCheckLatest | null;
  vantage: UrlCheckVantage;
  agentName: string | null;
  target: { availability: number; window: "24H" | "7D" | "30D" } | null;
}
