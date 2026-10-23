import type { EntityChange } from "@componode/core";
import type { ImportAgent as ApiImportAgent } from "@componode/core";
import type {
  Credential,
  ImportRun as ApiImportRun,
  ImportRunError,
  ImporterConfig as ApiImporterConfig,
} from "@/api/types";
import { narrow, narrowOrNull } from "@/api/mappers/catalog";
import type {
  CredentialStatus,
  DisconnectReason,
  Provider,
  RunStatus,
} from "@/ux/lib/domain";
import type {
  AgentSession,
  ImportAgent,
  ImportRun,
  ImporterConfig,
  RunChange,
  RunError,
} from "@/ux/lib/view-types";

const RUN_STATUSES: readonly string[] = [
  "PENDING",
  "RUNNING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "INTERRUPTED",
];

const DISCONNECT_REASONS: readonly string[] = [
  "client_close",
  "heartbeat_timeout",
  "revoked",
  "shutdown",
  "superseded",
  "replaced",
];

/** Importer package names → Provider enum used by the design system. */
const IMPORTER_PROVIDERS: Record<string, Provider> = {
  github: "GITHUB",
  aws: "AWS",
  azure: "AZURE",
  "alibaba-cloud": "ALIBABA_CLOUD",
  kubernetes: "KUBERNETES",
  "web-url": "WEB_URL",
  "api-url": "API_URL",
  "mcp-server": "MCP_SERVER",
};

export function importerProvider(name: string): Provider {
  return IMPORTER_PROVIDERS[name] ?? "OTHER";
}

/** Human label for a stored cron expression; mirrors the form presets. */
export function scheduleLabel(schedule: string | null): string {
  if (!schedule) return "Manual only";
  const labels: Record<string, string> = {
    "0 * * * *": "Every hour",
    "0 */6 * * *": "Every 6 hours",
    "0 2 * * *": "Daily at 02:00",
    "0 2 * * 1": "Weekly on Monday",
  };
  return labels[schedule] ?? `Cron ${schedule}`;
}

/** Seconds between run start and completion; null while running/pending. */
export function runDurationSec(
  startedAt: string | null,
  completedAt: string | null,
): number | null {
  if (!startedAt || !completedAt) return null;
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  return Number.isFinite(ms) && ms >= 0 ? Math.round(ms / 1000) : null;
}

/**
 * ImporterConfig API row → card view. `lastRun` and `history` are left to the
 * caller — per-day aggregates are not exposed by the API yet (gap G1), so
 * `history` stays empty until they land.
 */
export function mapImporterConfig(
  c: ApiImporterConfig,
  credentials: Pick<Credential, "id" | "label">[],
): ImporterConfig {
  const credential = credentials.find((cr) => c.credentialIds.includes(cr.id));
  return {
    id: c.id,
    importerName: importerProvider(c.importerName),
    label: c.label,
    schedule: c.schedule,
    scheduleLabel: scheduleLabel(c.schedule),
    enabled: c.enabled,
    credentialLabel: credential?.label ?? "None",
    agent: c.agent ? { id: c.agent.id, name: c.agent.name } : null,
    agentIncompatible: c.agentIncompatible,
    lastRun: null,
    history: [],
  };
}

export function mapImportRun(r: ApiImportRun): ImportRun {
  return {
    id: r.id,
    configId: r.configId,
    status: narrow<RunStatus>(r.status, RUN_STATUSES, "FAILED"),
    triggeredBy: r.triggeredBy ?? "system",
    startedAt: r.startedAt,
    durationSec: runDurationSec(r.startedAt, r.completedAt),
    assetsProcessed: r.assetsProcessed,
    assetsCreated: r.assetsCreated,
    assetsUpdated: r.assetsUpdated,
    instancesOrphaned: r.instancesOrphaned,
    componentsRetired: r.componentsRetired,
    currentPhase: r.currentPhase,
    cancelRequestedAt: r.cancelRequestedAt,
    errorMessage: r.errorMessage,
    agentId: r.agentId,
    agentName: r.agentName,
  };
}

/**
 * Agent row → view. `credentialState` is derived (the API carries the
 * underlying facts: revokedAt / hasCredential / pendingEnrollment).
 * `importerVersions` arrives as {name, version}[] — flattened to a record.
 */
export function mapImportAgent(a: ApiImportAgent): ImportAgent {
  const credentialState = a.revokedAt
    ? "REVOKED"
    : a.hasCredential
      ? "ACTIVE"
      : "PENDING_ENROLLMENT";
  return {
    id: a.id,
    name: a.name,
    status: narrow(a.status, ["CONNECTED", "OFFLINE", "NEVER_CONNECTED"], "OFFLINE"),
    credentialState,
    agentVersion: a.agentVersion,
    protocolVersion: a.protocolVersion,
    importerVersions: Object.fromEntries(
      a.importerVersions.map((v) => [v.name, v.version]),
    ),
    maxConcurrentJobs: a.maxConcurrentJobs,
    allowedImporters: a.allowedImporters,
    boundConfigs: a.boundConfigCount,
    lastSeenAt: a.lastSeenAt,
    enrollmentExpiresAt: null,
    createdBy: "",
    createdAt: a.createdAt,
    reportedStatus: a.reportedStatus
      ? {
          reportedAt: a.reportedStatus.reportedAt,
          receivedAt: a.reportedStatus.receivedAt,
          uptimeSeconds: a.reportedStatus.uptimeSeconds,
          activeJobs: a.reportedStatus.activeJobs,
          jobs: a.reportedStatus.jobs,
          assetsStreamed: a.reportedStatus.assetsStreamed,
          credentialTests: a.reportedStatus.credentialTests,
          secretResolutionFailures: a.reportedStatus.secretResolutionFailures,
          reconnects: a.reportedStatus.reconnects,
        }
      : null,
    lastHeartbeatAt: a.lastHeartbeatAt,
    lastDisconnectReason: narrowOrNull<DisconnectReason>(
      a.lastDisconnectReason,
      DISCONNECT_REASONS,
    ),
  };
}

export function mapAgentSession(s: {
  id: string;
  agentId: string;
  connectedAt: string;
  disconnectedAt: string | null;
  disconnectReason: string | null;
  remoteAddress: string | null;
  agentVersion: string | null;
}): AgentSession {
  return {
    id: s.id,
    agentId: s.agentId,
    connectedAt: s.connectedAt,
    disconnectedAt: s.disconnectedAt,
    reason: narrowOrNull<DisconnectReason>(s.disconnectReason, DISCONNECT_REASONS),
    remoteAddress: s.remoteAddress ?? "—",
    agentVersion: s.agentVersion ?? "—",
  };
}

/** EntityChange → RunChange row (gap G11: the API carries ids, not names). */
export function mapRunChange(c: EntityChange): RunChange {
  return {
    id: c.id,
    runId: c.importRunId ?? "",
    entityKind: narrow(
      c.entityType,
      ["component", "instance", "product"],
      "component",
    ),
    entityName: c.entityId ?? c.entityType,
    action: narrow(c.action, ["created", "updated", "orphaned", "retired"], "updated"),
    actor: c.createdByName ?? "importer",
    at: c.createdAt,
  };
}

export function mapRunError(e: ImportRunError): RunError {
  return {
    id: e.id,
    runId: e.runId,
    assetExternalId: e.assetExternalId,
    errorType: e.errorType,
    errorMessage: e.errorMessage,
    at: e.createdAt,
  };
}

export function mapCredentialStatus(status: string | null | undefined): CredentialStatus {
  return narrow<CredentialStatus>(status, ["ACTIVE", "REVOKED"], "ACTIVE");
}

const ROLES: readonly string[] = ["VIEWER", "EDITOR", "ADMIN"];

/** API User → view. `lastActiveAt` is not exposed by the API yet (null). */
export function mapUser(u: {
  id: string;
  username: string;
  role: string;
  displayName: string | null;
  email: string | null;
  isActive: boolean;
  createdAt: string;
}): import("@/ux/lib/view-types").User {
  return {
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    email: u.email,
    role: narrow(u.role, ROLES, "VIEWER"),
    isActive: u.isActive,
    lastActiveAt: null,
    createdAt: u.createdAt,
  };
}

/**
 * API Session → view. The API lists the caller's own sessions (or a user's,
 * for admins) — `username`/`displayName` come from the page context.
 * device/location are gap G2 placeholders; `current` is not derivable from
 * the API row (noted under G2).
 */
export function mapSession(
  s: {
    id: string;
    createdAt: string;
    lastSeenAt: string;
    expiresAt: string;
  },
  owner: { username: string; displayName: string },
): import("@/ux/lib/view-types").Session {
  return {
    id: s.id,
    username: owner.username,
    displayName: owner.displayName,
    device: "—",
    location: "—",
    createdAt: s.createdAt,
    lastSeenAt: s.lastSeenAt,
    expiresAt: s.expiresAt,
    current: false,
  };
}

/**
 * Credential → view. `keyHints` are already masked/non-reversible server-side
 * (ADR-107) — mapped verbatim, never raw values. `usedBy` comes from the
 * detail endpoint's dependents; list rows pass 0 until then.
 */
export function mapCredential(
  c: {
    id: string;
    slug: string;
    label: string;
    status: string;
    kind: string;
    keyHints: Record<string, string>;
    expiresAt: string | null;
    lastUsedAt: string | null;
    updatedBy?: string | null;
  },
  usedBy = 0,
): import("@/ux/lib/view-types").Credential {
  return {
    id: c.id,
    slug: c.slug,
    label: c.label,
    provider: "OTHER",
    status: mapCredentialStatus(c.status),
    keyHints: c.keyHints ?? {},
    expiresAt: c.expiresAt,
    lastUsedAt: c.lastUsedAt,
    usedBy,
    updatedBy: c.updatedBy ?? "—",
  };
}
