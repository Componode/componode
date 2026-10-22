import { createServer, type Server } from "node:http";
import type { AgentOpsMetrics } from "./metrics.js";

// Agent-local operations listener (spec 028 US1, ADR-116 Amendment 3):
// unauthenticated, network-policy-restricted, GET-only — same posture as
// the hub's /metrics. Serves state and counters only; never secret
// material, paths, or env names (spec FR-004/SC-002).

export type OpsReadiness =
  | { ready: true; state: "connected"; activeJobs?: number }
  | { ready: false; state: "connecting" | "backoff" | "no-credential" };

export interface OpsServer {
  address(): { host: string; port: number };
  close(): Promise<void>;
}

const JSON_HEADERS = { "content-type": "application/json" };

export async function startOpsServer(opts: {
  host: string;
  port: number;
  metrics: AgentOpsMetrics;
  getReadiness: () => OpsReadiness;
  log: {
    warn: (o: object, m: string) => void;
    info?: (o: object, m: string) => void;
  };
}): Promise<OpsServer | null> {
  const server: Server = createServer((req, res) => {
    if (req.method !== "GET") {
      res.writeHead(405, JSON_HEADERS).end('{"error":"method not allowed"}');
      return;
    }
    const path = new URL(req.url ?? "/", "http://local").pathname;
    if (path === "/healthz") {
      // Liveness: the process is up — readiness is a separate signal so a
      // hub outage (reconnect backoff) never looks like a dead process.
      res
        .writeHead(200, JSON_HEADERS)
        .end(
          JSON.stringify({
            status: "ok",
            uptimeSeconds: opts.metrics.snapshot().uptimeSeconds,
          }),
        );
      return;
    }
    if (path === "/readyz") {
      const readiness = opts.getReadiness();
      res
        .writeHead(readiness.ready ? 200 : 503, JSON_HEADERS)
        .end(JSON.stringify(readiness));
      return;
    }
    if (path === "/metrics") {
      opts.metrics
        .render()
        .then((text) =>
          res
            .writeHead(200, {
              "content-type": "text/plain; version=0.0.4",
            })
            .end(text),
        )
        .catch(() =>
          res.writeHead(500, JSON_HEADERS).end('{"error":"metrics render failed"}'),
        );
      return;
    }
    res.writeHead(404, JSON_HEADERS).end('{"error":"not found"}');
  });

  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(opts.port, opts.host, resolve);
    });
  } catch (err) {
    // FR-005: observability must never take down the thing it observes.
    opts.log.warn(
      {
        err: (err as Error).message,
        host: opts.host,
        port: opts.port,
      },
      "ops listener failed to start — agent continues without it",
    );
    return null;
  }

  // FR-005: a runtime listener error after a successful bind must warn,
  // never crash the agent — keep a handler attached for the server's life.
  server.on("error", (err) => {
    opts.log.warn(
      { err: err.message },
      "ops listener error — agent continues",
    );
  });

  const bound = server.address();
  const port =
    typeof bound === "object" && bound !== null ? bound.port : opts.port;
  opts.log.info?.(
    { host: opts.host, port },
    "ops listener serving /healthz /readyz /metrics",
  );

  return {
    address: () => ({ host: opts.host, port }),
    close: () =>
      new Promise<void>((resolve) => {
        // Drop keep-alive scraper connections so close() can't hang.
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
