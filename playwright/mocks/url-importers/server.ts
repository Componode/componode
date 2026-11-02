import { startDataServer, startControlServer, makeScenarioStore, RequestLog, json, text, env } from '../lib/mock.js';

// Single-endpoint URL importers (web-url, api-url): one GET per run.
// Scenarios: baseline, empty, changed, error, malformed, hang.

const SCENARIOS = ['baseline', 'empty', 'changed', 'error', 'malformed', 'hang'] as const;
const store = makeScenarioStore([...SCENARIOS], 'baseline');
const log = new RequestLog();

function webBody(scenario: string): { status: number; body: string } {
  switch (scenario) {
    case 'empty': return { status: 200, body: '' };
    case 'changed': return { status: 200, body: '<html>Componode PW web fixture v2 — changed</html>' };
    case 'error': return { status: 503, body: 'service unavailable' };
    case 'malformed': return { status: 200, body: '\u0000\u0001binary-payload' };
    default: return { status: 200, body: '<html>Componode PW web fixture v1</html>' };
  }
}

function apiBody(scenario: string): { status: number; body: string } {
  switch (scenario) {
    case 'empty': return { status: 200, body: 'null' };
    case 'changed': return { status: 200, body: JSON.stringify({ name: 'pw-api-fixture', version: 2, changed: true }) };
    case 'error': return { status: 500, body: JSON.stringify({ error: 'internal' }) };
    case 'malformed': return { status: 200, body: '{not valid json' };
    default: return { status: 200, body: JSON.stringify({ name: 'pw-api-fixture', version: 1 }) };
  }
}

const server = startDataServer({
  port: Number(env('MOCK_PORT', '9080')),
  handler: async (req, body, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const host = req.headers.host ?? '';
    const isApi = host.startsWith('api-fixture') || url.pathname.startsWith('/api');
    log.add({ method: req.method ?? 'GET', path: url.pathname, scenario: store.current });
    if (store.current === 'hang') {
      await new Promise((r) => setTimeout(r, 60_000));
      return text(res, 200, '');
    }
    const out = isApi ? apiBody(store.current) : webBody(store.current);
    res.writeHead(out.status, { 'content-type': isApi ? 'application/json' : 'text/html' });
    res.end(out.body);
  },
});

const control = startControlServer(Number(env('MOCK_CONTROL_PORT', '9444')), {
  getScenario: () => store.current,
  setScenario: (name) => {
    if (!(SCENARIOS as readonly string[]).includes(name)) return false;
    store.current = name as (typeof SCENARIOS)[number];
    return true;
  },
  scenarios: () => [...SCENARIOS],
  log,
});

console.log(`url-importers mock on :${env('MOCK_PORT', '9080')} control :${env('MOCK_CONTROL_PORT', '9444')}`);
void server; void control; void json;
