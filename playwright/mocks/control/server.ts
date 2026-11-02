import http from 'node:http';
import { readBody, json, env } from '../lib/mock.js';

// Scenario control facade — single entry point tests call. Fans out to each
// mock's internal /__control endpoints. Reachable only on the internal
// network; never published to the host and never forwards to a provider.

const TARGETS: Record<string, string> = {
  'mock-github': 'http://mock-github:9444',
  'mock-alibaba': 'http://mock-alibaba:9444',
  'mock-docker-engine': 'http://mock-docker-engine:9444',
  'mock-url-importers': 'http://mock-url-importers:9444',
  'mock-url-check-target': 'http://mock-url-check-target:9444',
};

async function call(target: string, path: string, method = 'GET', body?: string): Promise<{ status: number; body: string }> {
  const res = await fetch(`${TARGETS[target]}${path}`, { method, body, headers: { 'content-type': 'application/json' } });
  return { status: res.status, body: await res.text() };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  const p = url.pathname;

  if (req.method === 'GET' && p === '/__control/health') return json(res, 200, { ok: true });

  // GET /scenario/<target> / POST /scenario/<target> {name}
  const m = p.match(/^\/scenario\/([a-z-]+)$/);
  if (m && TARGETS[m[1]!]) {
    if (req.method === 'GET') {
      const r = await call(m[1]!, '/__control/scenario');
      res.writeHead(r.status, { 'content-type': 'application/json' });
      return res.end(r.body);
    }
    if (req.method === 'POST') {
      const body = await readBody(req);
      const r = await call(m[1]!, '/__control/scenario', 'POST', body);
      res.writeHead(r.status, { 'content-type': 'application/json' });
      return res.end(r.body);
    }
  }

  // GET /requests/<target> — sanitized request log or probe records.
  const r2 = p.match(/^\/requests\/([a-z-]+)$/);
  if (r2 && TARGETS[r2[1]!] && req.method === 'GET') {
    const r = await call(r2[1]!, '/__control/requests');
    res.writeHead(r.status, { 'content-type': 'application/json' });
    return res.end(r.body);
  }

  // POST /reset/<target>
  const r3 = p.match(/^\/reset\/([a-z-]+)$/);
  if (r3 && TARGETS[r3[1]!] && req.method === 'POST') {
    const r = await call(r3[1]!, '/__control/reset', 'POST');
    res.writeHead(r.status, { 'content-type': 'application/json' });
    return res.end(r.body);
  }

  if (p === '/targets' && req.method === 'GET') {
    return json(res, 200, { targets: Object.keys(TARGETS) });
  }

  return json(res, 404, { code: 'NOT_FOUND' });
});

const port = Number(env('MOCK_CONTROL_PORT', '9090'));
server.listen(port, () => console.log(`mock-control facade on :${port}`));
