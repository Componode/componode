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
  | BasicAuthConfig
  | BearerAuthConfig
  | CustomHeadersAuthConfig;

export interface UrlCheck {
  id: string;
  setupId: string;
  componentInstanceId: string;
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

export interface UrlCheckListItem extends UrlCheck {
  latest: UrlCheckLatest | null;
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
