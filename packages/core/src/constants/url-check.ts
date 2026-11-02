// URL Check monitoring enums and defaults (ADR-123, spec 051).

export const URL_CHECK_METHODS = ["GET", "HEAD"] as const;
export type UrlCheckMethod = (typeof URL_CHECK_METHODS)[number];

export const URL_CHECK_AUTH_MODES = [
  "NONE",
  "BASIC",
  "BEARER",
  "CUSTOM_HEADERS",
] as const;
export type UrlCheckAuthMode = (typeof URL_CHECK_AUTH_MODES)[number];

export const URL_CHECK_VANTAGES = ["HUB", "AGENT"] as const;
export type UrlCheckVantage = (typeof URL_CHECK_VANTAGES)[number];

// Observation outcome: SUCCESS = response satisfied the check's success
// policy; FAILURE = probe ran but failed (transport error or policy);
// MISSED = a scheduled slot could not execute (monitor-side downtime such
// as an offline agent or hub restart) — counts against availability and is
// shown as a coverage gap.
export const URL_CHECK_OUTCOMES = ["SUCCESS", "FAILURE", "MISSED"] as const;
export type UrlCheckOutcome = (typeof URL_CHECK_OUTCOMES)[number];

// Normalized failure reasons. HTTP_STATUS = response received but not in
// the success policy. POLICY_BLOCKED = URL rejected by ADR-106 validation at
// run time. AGENT_OFFLINE marks MISSED rows from agent dispatch failure.
// SATURATED marks MISSED rows where probe work exceeded a configured bound —
// per-agent deferral overflow on the hub or an at-cap agent refusal (spec
// 052): monitor-side capacity, not an endpoint or connectivity failure.
export const URL_CHECK_ERROR_TYPES = [
  "DNS",
  "CONNECT",
  "TLS",
  "TIMEOUT",
  "HTTP_STATUS",
  "POLICY_BLOCKED",
  "AGENT_OFFLINE",
  "ABORTED",
  "SATURATED",
  "OTHER",
] as const;
export type UrlCheckErrorType = (typeof URL_CHECK_ERROR_TYPES)[number];

export const URL_CHECK_WINDOWS = ["24H", "7D", "30D"] as const;
export type UrlCheckWindow = (typeof URL_CHECK_WINDOWS)[number];

// Query-string spellings for the metrics endpoint.
export const URL_CHECK_WINDOW_PARAMS = ["24h", "7d", "30d"] as const;
export type UrlCheckWindowParam = (typeof URL_CHECK_WINDOW_PARAMS)[number];

export const URL_CHECK_DEFAULT_CADENCE_SECONDS = 300;
export const URL_CHECK_MIN_CADENCE_SECONDS = 60;
export const URL_CHECK_MAX_CADENCE_SECONDS = 86400;
export const URL_CHECK_RETENTION_DAYS = 30;
export const URL_CHECK_DEFAULT_TIMEOUT_MS = 30000;
export const URL_CHECK_MAX_PROBE_TIMEOUT_MS = 60000;
export const URL_CHECK_PROBE_CONCURRENCY_DEFAULT = 10;
export const URL_CHECK_PROBE_RATE_LIMIT_DEFAULT = 20;
export const URL_CHECK_SWEEP_INTERVAL_MS_DEFAULT = 15000;

// Agent-vantage bounds (spec 052, FR-001/002/003/006). The hub bound is
// deliberately tighter than the agent cap so correct lockstep configs
// never trigger an at-cap refusal.
export const URL_CHECK_AGENT_CONCURRENCY_DEFAULT = 4;
export const URL_CHECK_AGENT_RATE_LIMIT_DEFAULT = 20;
export const URL_CHECK_AGENT_QUEUE_MAX_DEFAULT = 100;
export const URL_CHECK_MAX_PROBES_DEFAULT = 8;

// Repeated-failure policy (spec 056, ADR-124 Amendment 3): a check
// auto-disables after this many consecutive non-SUCCESS observations —
// FAILURE and MISSED both count; SUCCESS resets the streak. The env
// tunable URL_CHECK_AUTO_DISABLE_AFTER supplies the global default and a
// per-check autoDisableAfter overrides it; 0 means never auto-disable.
// ~1 hour of unbroken failure at the default 300s cadence.
export const URL_CHECK_AUTO_DISABLE_AFTER_DEFAULT = 12;
export const URL_CHECK_AUTO_DISABLE_AFTER_MAX = 1000;
