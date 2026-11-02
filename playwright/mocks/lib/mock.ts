import http from 'node:http';
import https from 'node:https';
import { readFileSync } from 'node:fs';

/** Sanitized request log — method/path/action/scenario only, never headers or bodies. */
export interface RequestEntry {
  method: string;
  path: string;
  action?: string;
  scenario: string;
  at: string;
}

export class RequestLog {
  private entries: RequestEntry[] = [];

  add(entry: Omit<RequestEntry, 'at'>): void {
    this.entries.push({ ...entry, at: new Date().toISOString() });
  }

  list(): RequestEntry[] {
    return this.entries;
  }

  clear(): void {
    this.entries = [];
  }
}

export function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolvePromise(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export function json(
  res: http.ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(payload);
}

export function text(res: http.ServerResponse, status: number, body: string): void {
  res.writeHead(status, { 'content-type': 'text/plain' });
  res.end(body);
}

export interface ScenarioStore<T extends string> {
  current: T;
  available: readonly T[];
}

export function makeScenarioStore<T extends string>(profiles: readonly T[], initial: T): ScenarioStore<T> {
  return { current: initial, available: profiles };
}

export interface ControlHooks {
  getScenario(): string;
  setScenario(name: string): boolean;
  scenarios(): string[];
  log: { list(): unknown[]; clear(): void };
}

/**
 * Test-only control plane. Exposes scenario selection and sanitized request
 * logs on a dedicated port that is only reachable inside the workload
 * network — it is never published to the host.
 */
export function startControlServer(port: number, hooks: ControlHooks): http.Server {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://internal');
    if ((req.method === 'GET' || req.method === 'HEAD') && url.pathname === '/__control/health') {
      return json(res, 200, { ok: true });
    }
    if (url.pathname === '/__control/scenario' && req.method === 'GET') {
      return json(res, 200, { scenario: hooks.getScenario(), available: hooks.scenarios() });
    }
    if (url.pathname === '/__control/scenario' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)) || '{}') as { name?: string };
      if (!body.name || !hooks.setScenario(body.name)) {
        return json(res, 400, { code: 'UNKNOWN_SCENARIO', available: hooks.scenarios() });
      }
      return json(res, 200, { scenario: hooks.getScenario() });
    }
    if (url.pathname === '/__control/requests' && req.method === 'GET') {
      return json(res, 200, { requests: hooks.log.list() });
    }
    if (url.pathname === '/__control/reset' && req.method === 'POST') {
      hooks.log.clear();
      return json(res, 200, { cleared: true });
    }
    return json(res, 404, { code: 'NOT_FOUND' });
  });
  server.listen(port);
  return server;
}

export interface DataServerOptions {
  port: number;
  tls?: { certPath: string; keyPath: string; caPath?: string; requireClientCert?: boolean };
  handler: (req: http.IncomingMessage, body: string, res: http.ServerResponse) => void | Promise<void>;
}

export function startDataServer(opts: DataServerOptions): http.Server | https.Server {
  const listener = async (req: http.IncomingMessage, res: http.ServerResponse) => {
    try {
      const body = await readBody(req);
      await opts.handler(req, body, res);
    } catch (err) {
      json(res, 500, { code: 'MOCK_ERROR', message: (err as Error).message });
    }
  };
  if (!opts.tls) {
    const server = http.createServer(listener);
    server.listen(opts.port);
    return server;
  }
  const server = https.createServer(
    {
      cert: readFileSync(opts.tls.certPath),
      key: readFileSync(opts.tls.keyPath),
      ca: opts.tls.caPath ? readFileSync(opts.tls.caPath) : undefined,
      requestCert: opts.tls.requireClientCert ?? false,
      rejectUnauthorized: opts.tls.requireClientCert ?? false,
    },
    listener,
  );
  server.listen(opts.port);
  return server;
}

/** Standard control wiring for a single-scenario mock. */
export function wireMock(opts: {
  store: ScenarioStore<string>;
  log: RequestLog;
  controlPort: number;
}): http.Server {
  return startControlServer(opts.controlPort, {
    getScenario: () => opts.store.current,
    setScenario: (name) => {
      if (!opts.store.available.includes(name)) return false;
      opts.store.current = name;
      return true;
    },
    scenarios: () => [...opts.store.available],
    log: opts.log,
  });
}

export function env(name: string, fallback?: string): string {
  const v = process.env[name];
  if (v === undefined || v === '') {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing required env ${name}`);
  }
  return v;
}
