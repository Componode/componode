import { startDataServer, startControlServer, makeScenarioStore, RequestLog, json, text, env } from '../lib/mock.js';

// URL Check probe target — receives real Hub/Agent probes for all four auth
// modes. Records only header names and credential-match booleans, never raw
// secret values. Scenarios: baseline | fail | slow.

const SCENARIOS = ['baseline', 'fail', 'slow'] as const;
type Scenario = (typeof SCENARIOS)[number];
const store = makeScenarioStore([...SCENARIOS], 'baseline');
const log = new RequestLog();

const EXPECTED = {
  basicUser: env('PWP_URLCHECK_BASIC_USER', 'unset'),
  basicPassword: env('PWP_URLCHECK_BASIC_PASSWORD', 'unset'),
  bearerToken: env('PWP_URLCHECK_BEARER_TOKEN', 'unset'),
  headerValue: env('PWP_URLCHECK_HEADER_VALUE', 'unset'),
};

interface ProbeRecord {
  method: string;
  path: string;
  headerNames: string[];
  authMatch: boolean | null;
  scenario: string;
  at: string;
}

const probes: ProbeRecord[] = [];

function evaluate(req: import('node:http').IncomingMessage): boolean | null {
  const auth = req.headers.authorization;
  const custom = req.headers['x-pw-check'];
  if (auth?.startsWith('Basic ')) {
    return auth.slice(6) === Buffer.from(`${EXPECTED.basicUser}:${EXPECTED.basicPassword}`).toString('base64');
  }
  if (auth?.startsWith('Bearer ')) {
    return auth.slice(7) === EXPECTED.bearerToken;
  }
  if (typeof custom === 'string') {
    return custom === EXPECTED.headerValue;
  }
  if (!auth) return null; // NONE mode — nothing to compare
  return false;
}

const server = startDataServer({
  port: Number(env('MOCK_PORT', '9080')),
  handler: async (req, body, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const match = evaluate(req);
    probes.push({
      method: req.method ?? 'GET',
      path: url.pathname,
      headerNames: Object.keys(req.headers).sort(),
      authMatch: match,
      scenario: store.current,
      at: new Date().toISOString(),
    });
    log.add({ method: req.method ?? 'GET', path: url.pathname, scenario: store.current });
    const s: Scenario = store.current;
    if (s === 'slow') {
      await new Promise((r) => setTimeout(r, 35_000));
      return text(res, 200, 'slow');
    }
    if (s === 'fail') return text(res, 503, 'unavailable');
    return json(res, 200, { ok: true, service: 'pw-url-check-target' });
  },
});

const control = startControlServer(Number(env('MOCK_CONTROL_PORT', '9444')), {
  getScenario: () => store.current,
  setScenario: (name) => {
    if (!(SCENARIOS as readonly string[]).includes(name)) return false;
    store.current = name as Scenario;
    return true;
  },
  scenarios: () => [...SCENARIOS],
  log: {
    list: () => probes,
    clear: () => { probes.length = 0; log.clear(); },
    add: (e) => log.add(e),
  } as RequestLog,
});

console.log(`url-check-target mock :${env('MOCK_PORT', '9080')} control :${env('MOCK_CONTROL_PORT', '9444')}`);
void server; void control;
