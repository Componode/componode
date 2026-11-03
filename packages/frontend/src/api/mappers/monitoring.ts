/**
 * URL Check monitoring mappers (spec 051) — API contracts from
 * `@componode/core` become the view models in `ux/lib/view-types`.
 * Components never read API contracts directly (docs/ux.md).
 */
import type {
  MonitoringSetup,
  SuccessPolicy,
  UrlCheck,
  UrlCheckLatest,
  UrlCheckListItem,
  UrlCheckMetrics,
  UrlCheckObservation,
  UrlCheckSummary,
} from "@/api/types";
import type {
  UrlCheckAuthMode,
  UrlCheckStatus,
  UrlCheckVantage,
} from "@/ux/lib/domain";
import type {
  MonitoringSetupView,
  UrlCheckAuthConfigView,
  UrlCheckLatestView,
  UrlCheckMetricsView,
  UrlCheckObservationView,
  UrlCheckSummaryView,
  UrlCheckView,
} from "@/ux/lib/view-types";
import { narrow } from "@/api/mappers/catalog";

const VANTAGES: readonly string[] = ["HUB", "AGENT"];
const OUTCOMES: readonly string[] = ["SUCCESS", "FAILURE", "MISSED"];
const METHODS: readonly string[] = ["GET", "HEAD"];
const AUTH_MODES: readonly string[] = [
  "NONE",
  "BASIC",
  "BEARER",
  "CUSTOM_HEADERS",
];
const TARGET_WINDOWS: readonly string[] = ["24H", "7D", "30D"];

/**
 * FR-015/FR-024: every metric and status is phrased as "reachable from"
 * this vantage — the Hub or the executing Import Agent's name.
 */
export function vantageLabel(
  vantage: string | null | undefined,
  agentName: string | null | undefined,
): string {
  return vantage === "AGENT" ? (agentName ?? "Import agent") : "Hub";
}

/** Derived card/badge status — never the importer-reported instance status. */
export function checkStatusOf(check: {
  enabled: boolean;
  autoDisabledAt?: string | null;
  latest: { outcome: string } | null;
}): UrlCheckStatus {
  if (!check.enabled)
    return check.autoDisabledAt != null ? "AUTO_DISABLED" : "DISABLED";
  if (!check.latest) return "NO_DATA";
  return check.latest.outcome === "SUCCESS" ? "UP" : "DOWN";
}

/** "200–299, 301" — compact accepted-statuses rendering. */
export function successPolicyLabel(policy: SuccessPolicy): string {
  const parts = [
    ...(policy.ranges ?? []).map((r) =>
      r.min === r.max ? `${r.min}` : `${r.min}–${r.max}`,
    ),
    ...(policy.codes ?? []).map(String),
  ];
  return parts.length ? parts.join(", ") : "—";
}

/** Inverse of successPolicyLabel — prefill for the editor input. */
export function statusesInputOf(policy: SuccessPolicy): string {
  const parts = [
    ...(policy.ranges ?? []).map((r) =>
      r.min === r.max ? `${r.min}` : `${r.min}-${r.max}`,
    ),
    ...(policy.codes ?? []).map(String),
  ];
  return parts.join(",");
}

/**
 * Parse the editor's accepted-statuses input ("200-299,301") into a
 * SuccessPolicy. Returns { policy } on success, { error } otherwise.
 */
export function parseStatusesInput(input: string): {
  policy?: SuccessPolicy;
  error?: string;
} {
  const trimmed = input.trim();
  const codes: number[] = [];
  const ranges: { min: number; max: number }[] = [];
  for (const raw of trimmed.split(",")) {
    const part = raw.trim();
    if (!part) continue;
    const range = part.match(/^(\d{3})\s*-\s*(\d{3})$/);
    if (range) {
      const min = Number(range[1]);
      const max = Number(range[2]);
      if (min < 100 || max > 599)
        return { error: `Range "${part}" must stay within 100–599.` };
      if (min > max) return { error: `Range "${part}" starts above its end.` };
      ranges.push({ min, max });
      continue;
    }
    if (/^\d{3}$/.test(part)) {
      const code = Number(part);
      if (code < 100 || code > 599)
        return { error: `Status "${part}" must be within 100–599.` };
      codes.push(code);
      continue;
    }
    return {
      error: `Can't parse "${part}" — use codes or ranges like 200-299,301.`,
    };
  }
  if (codes.length + ranges.length === 0) {
    return { error: "Accept at least one status — e.g. 200-299." };
  }
  return { policy: { codes, ranges } };
}

const WINDOW_LABELS: Record<UrlCheckMetrics["window"], string> = {
  "24h": "24 hours",
  "7d": "7 days",
  "30d": "30 days",
};

export function mapMonitoringSetup(s: MonitoringSetup): MonitoringSetupView {
  return {
    id: s.id,
    cadenceSeconds: s.cadenceSeconds,
    vantage: narrow<UrlCheckVantage>(s.vantage, VANTAGES, "HUB"),
    agentId: s.agentId ?? null,
    agentName: s.agentName ?? null,
    vantageLabel: vantageLabel(s.vantage, s.agentName),
  };
}

function mapLatest(
  l: UrlCheckLatest | null | undefined,
): UrlCheckLatestView | null {
  if (!l) return null;
  return {
    scheduledAt: l.scheduledAt,
    outcome: narrow<UrlCheckLatestView["outcome"]>(
      l.outcome,
      OUTCOMES,
      "FAILURE",
    ),
    httpStatus: l.httpStatus ?? null,
    durationMs: l.durationMs ?? null,
    errorType: l.errorType ?? null,
    vantage: narrow<UrlCheckVantage>(l.vantage, VANTAGES, "HUB"),
  };
}

const HEADER_NAME_RE = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/;
const CREDENTIAL_KEY_RE = /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/;

export interface UrlCheckAuthDraft {
  isApi: boolean;
  authMode: UrlCheckAuthMode;
  credentialId: string;
  usernameKey: string;
  passwordKey: string;
  tokenKey: string;
  headers: { name: string; key: string }[];
}

/** Shared create/edit auth + target rules; credential fields carry key names only. */
export function validateUrlCheckDraft(d: UrlCheckAuthDraft): string | null {
  if (!d.isApi || d.authMode === "NONE") return null;
  if (!d.credentialId)
    return "Select a credential for the chosen auth mode.";
  if (
    d.authMode === "BASIC" &&
    (!CREDENTIAL_KEY_RE.test(d.usernameKey) ||
      !CREDENTIAL_KEY_RE.test(d.passwordKey))
  ) {
    return "Username and password keys must be credential key names.";
  }
  if (d.authMode === "BEARER" && !CREDENTIAL_KEY_RE.test(d.tokenKey)) {
    return "Token key must be a credential key name.";
  }
  if (d.authMode === "CUSTOM_HEADERS") {
    const rows = d.headers.filter((h) => h.name.trim() || h.key.trim());
    if (rows.length === 0) return "Add at least one custom header row.";
    for (const h of rows) {
      if (!HEADER_NAME_RE.test(h.name.trim())) {
        return `"${h.name}" is not a valid header name.`;
      }
      if (h.name.trim().toLowerCase() === "authorization") {
        return "Authorization is reserved for Basic and Bearer modes.";
      }
      if (!CREDENTIAL_KEY_RE.test(h.key.trim())) {
        return `Credential key "${h.key}" is not a valid key name.`;
      }
    }
  }
  return null;
}

export function urlCheckAuthConfigOf(d: UrlCheckAuthDraft) {
  const mode = d.isApi ? d.authMode : "NONE";
  return mode === "BASIC"
    ? { usernameKey: d.usernameKey.trim(), passwordKey: d.passwordKey.trim() }
    : mode === "BEARER"
      ? { tokenKey: d.tokenKey.trim() }
      : mode === "CUSTOM_HEADERS"
        ? {
            headers: d.headers
              .filter((h) => h.name.trim() && h.key.trim())
              .map((h) => ({ name: h.name.trim(), key: h.key.trim() })),
          }
        : null;
}

const EMPTY_SUMMARY: UrlCheckSummaryView = {
  window: "24h",
  windowLabel: "24 hours",
  availability: null,
  p95: null,
  coverageGap: 0,
  counts: { success: 0, failure: 0, missed: 0 },
};

/** Compact 24h summary — null fields stay null (no fabricated figures). */
function mapSummary(
  s: UrlCheckSummary | null | undefined,
): UrlCheckSummaryView {
  if (!s) return EMPTY_SUMMARY;
  return {
    window: "24h",
    windowLabel: "24 hours",
    availability: s.availability ?? null,
    p95: s.p95 ?? null,
    coverageGap: s.coverageGap ?? 0,
    counts: s.counts ?? { success: 0, failure: 0, missed: 0 },
  };
}

function mapCheckBase(
  c: UrlCheck & { managedByConfigId?: string | null },
): Omit<UrlCheckView, "latest" | "status"> {
  const policy: SuccessPolicy = c.successPolicy ?? {
    codes: [],
    ranges: [{ min: 200, max: 299 }],
  };
  return {
    id: c.id,
    setupId: c.setupId,
    componentInstanceId: c.componentInstanceId,
    managedKey: c.managedKey ?? null,
    managedByConfigId: c.managedByConfigId ?? null,
    credentialId: c.credentialId ?? null,
    name: c.name,
    url: c.url,
    method: narrow<UrlCheckView["method"]>(c.method, METHODS, "GET"),
    enabled: c.enabled,
    cadenceSeconds: c.cadenceSeconds ?? null,
    successPolicy: policy,
    successPolicyLabel: successPolicyLabel(policy),
    authMode: narrow<UrlCheckView["authMode"]>(c.authMode, AUTH_MODES, "NONE"),
    authConfig: (c.authConfig as UrlCheckAuthConfigView | null) ?? null,
    availabilityTarget: c.availabilityTarget ?? null,
    targetWindow:
      c.targetWindow == null
        ? null
        : narrow<NonNullable<UrlCheckView["targetWindow"]>>(
            c.targetWindow,
            TARGET_WINDOWS,
            "24H",
          ),
    nextProbeAt: c.nextProbeAt ?? null,
    autoDisableAfter: c.autoDisableAfter ?? null,
    consecutiveFailures: c.consecutiveFailures ?? 0,
    autoDisabledAt: c.autoDisabledAt ?? null,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    // Overridden by mapUrlCheckListItem; the detail path has no list summary.
    summary: EMPTY_SUMMARY,
    recent: [],
  };
}

export function mapUrlCheckListItem(c: UrlCheckListItem): UrlCheckView {
  const latest = mapLatest(c.latest);
  const status = checkStatusOf({
    enabled: c.enabled,
    autoDisabledAt: c.autoDisabledAt,
    latest,
  });
  return {
    ...mapCheckBase(c),
    managedByConfigId: c.managedByConfigId ?? null,
    latest,
    status,
    summary: mapSummary(c.summary),
    recent: (c.recent ?? []).map(mapUrlCheckObservation),
  };
}

/** Detail view — pass an already-mapped latest (e.g. from the metrics read). */
export function mapUrlCheck(
  c: UrlCheck,
  latest: UrlCheckLatestView | null = null,
): UrlCheckView {
  const status = checkStatusOf({
    enabled: c.enabled,
    autoDisabledAt: c.autoDisabledAt,
    latest,
  });
  return { ...mapCheckBase(c), latest, status };
}

export function mapUrlCheckObservation(
  o: UrlCheckObservation,
): UrlCheckObservationView {
  return {
    id: o.id,
    scheduledAt: o.scheduledAt,
    outcome: narrow<UrlCheckObservationView["outcome"]>(
      o.outcome,
      OUTCOMES,
      "FAILURE",
    ),
    httpStatus: o.httpStatus ?? null,
    durationMs: o.durationMs ?? null,
    errorType: o.errorType ?? null,
    vantage: narrow<UrlCheckVantage>(o.vantage, VANTAGES, "HUB"),
    agentId: o.agentId ?? null,
  };
}

export function mapUrlCheckMetrics(m: UrlCheckMetrics): UrlCheckMetricsView {
  return {
    window: m.window,
    windowLabel: WINDOW_LABELS[m.window] ?? m.window,
    availability: m.availability ?? null,
    errorRate: m.errorRate ?? null,
    coverageGap: m.coverageGap ?? 0,
    p50: m.p50 ?? null,
    p95: m.p95 ?? null,
    p99: m.p99 ?? null,
    counts: m.counts ?? { success: 0, failure: 0, missed: 0 },
    latest: mapLatest(m.latest),
    vantage: narrow<UrlCheckVantage>(m.vantage, VANTAGES, "HUB"),
    vantageLabel: vantageLabel(m.vantage, m.agentName),
    target: m.target ?? null,
  };
}
