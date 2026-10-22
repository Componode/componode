import type { FastifyInstance } from "fastify";
import promClient from "prom-client";

function getOrCreateCounter<T extends string>(
  name: string,
  help: string,
  labelNames: T[],
): promClient.Counter<T> {
  const existing = promClient.register.getSingleMetric(name) as promClient.Counter<T> | undefined;
  if (existing) return existing;
  return new promClient.Counter({ name, help, labelNames });
}

function getOrCreateHistogram<T extends string>(
  name: string,
  help: string,
  labelNames: T[],
  buckets: number[],
): promClient.Histogram<T> {
  const existing = promClient.register.getSingleMetric(name) as promClient.Histogram<T> | undefined;
  if (existing) return existing;
  return new promClient.Histogram({ name, help, labelNames, buckets });
}

function getOrCreateGauge<T extends string>(
  name: string,
  help: string,
  labelNames?: T[],
): promClient.Gauge<T> {
  const existing = promClient.register.getSingleMetric(name) as promClient.Gauge<T> | undefined;
  if (existing) return existing;
  return new promClient.Gauge({ name, help, labelNames: labelNames ?? [] });
}

const httpRequestsTotal = getOrCreateCounter(
  "http_requests_total",
  "Total HTTP requests",
  ["method", "route", "status"],
);

const httpRequestDurationSeconds = getOrCreateHistogram(
  "http_request_duration_seconds",
  "HTTP request duration",
  ["method", "route"],
  [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
);

const authEventsTotal = getOrCreateCounter(
  "auth_events_total",
  "Authentication events",
  ["event", "outcome"],
);

const dbPoolSize = getOrCreateGauge("db_pool_size", "Database connection pool size");
const dbPoolAvailable = getOrCreateGauge(
  "db_pool_available",
  "Available database connections",
);

const dbQueryDurationSeconds = getOrCreateHistogram(
  "db_query_duration_seconds",
  "Database query duration",
  ["operation"],
  [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1],
);

const rateLimitEventsTotal = getOrCreateCounter(
  "rate_limit_events_total",
  "Rate limit events",
  ["endpoint"],
);

// Importer metrics
const importRunsTotal = getOrCreateCounter(
  "import_runs_total",
  "Total importer runs",
  ["importer", "status"],
);

const importRunDurationSeconds = getOrCreateHistogram(
  "import_run_duration_seconds",
  "Importer run duration",
  ["importer"],
  [0.1, 0.5, 1, 2.5, 5, 10, 30, 60, 120, 300],
);

const importRunAssetsYieldedTotal = getOrCreateCounter(
  "import_run_assets_yielded_total",
  "Total assets yielded by importer runs",
  ["importer"],
);

const importRunErrorsTotal = getOrCreateCounter(
  "import_run_errors_total",
  "Total errors during importer runs",
  ["importer", "errorType"],
);

// Catalog metrics
const componentsTotal = getOrCreateGauge(
  "components_total",
  "Total number of components in the catalog",
);

const componentGroupsTotal = getOrCreateGauge(
  "component_groups_total",
  "Total number of component groups",
);

// Edge suggestion metrics (ADR-113)
const suggestionPassesTotal = getOrCreateCounter(
  "suggestion_passes_total",
  "Total edge suggestion generation passes",
  ["scope"],
);

const suggestionPassDurationSeconds = getOrCreateHistogram(
  "suggestion_pass_duration_seconds",
  "Edge suggestion generation pass duration",
  ["scope"],
  [0.05, 0.1, 0.5, 1, 2.5, 5, 10, 30, 60],
);

const suggestionStagedTotal = getOrCreateCounter(
  "suggestion_staged_total",
  "Total edge suggestion pairs staged or rescored",
  [],
);

const suggestionSupersededTotal = getOrCreateCounter(
  "suggestion_superseded_total",
  "Total edge suggestion pairs tombstoned by coverage",
  [],
);

const suggestionPassErrorsTotal = getOrCreateCounter(
  "suggestion_pass_errors_total",
  "Total failed edge suggestion generation passes",
  [],
);

// Import Agent metrics (ADR-116, spec 025)
const importAgentsConnected = getOrCreateGauge(
  "import_agents_connected",
  "Import agents holding a live stream session",
);

const agentSessionsTotal = getOrCreateCounter(
  "agent_sessions_total",
  "Total agent stream sessions closed",
  ["agent", "reason"],
);

const agentStreamRejectedTotal = getOrCreateCounter(
  "agent_stream_rejected_total",
  "Rejected agent stream/enrollment attempts (bad credential, bad token, version mismatch)",
  ["reason"],
);

const agentCredentialTestsTotal = getOrCreateCounter(
  "agent_credential_tests_total",
  "Remote credential tests dispatched to import agents",
  ["agent", "result"],
);

// Collect default Node.js metrics (event loop, GC, memory, CPU) once per process.
const collectDefaultMetrics = promClient.collectDefaultMetrics;
if (!promClient.register.getSingleMetric("process_cpu_user_seconds_total")) {
  collectDefaultMetrics();
}

export const metrics = {
  httpRequestsTotal,
  httpRequestDurationSeconds,
  authEventsTotal,
  dbPoolSize,
  dbPoolAvailable,
  dbQueryDurationSeconds,
  rateLimitEventsTotal,
  importRunsTotal,
  importRunDurationSeconds,
  importRunAssetsYieldedTotal,
  importRunErrorsTotal,
  componentsTotal,
  componentGroupsTotal,
  suggestionPassesTotal,
  suggestionPassDurationSeconds,
  suggestionStagedTotal,
  suggestionSupersededTotal,
  suggestionPassErrorsTotal,
  importAgentsConnected,
  agentSessionsTotal,
  agentStreamRejectedTotal,
  agentCredentialTestsTotal,
};

export async function metricsPlugin(app: FastifyInstance): Promise<void> {
  // Instrument HTTP request duration and count
  app.addHook("onResponse", async (req, reply) => {
    const route = req.routeOptions?.url ?? req.url;
    const method = req.method;
    const status = String(reply.statusCode);
    const duration = reply.elapsedTime / 1000;

    httpRequestsTotal.inc({ method, route, status });
    httpRequestDurationSeconds.observe({ method, route }, duration);
  });
}

export { promClient };
