import { startDataServer, startControlServer, makeScenarioStore, RequestLog, json, env } from '../lib/mock.js';

// Fake Docker Engine API over mTLS — only the read-only endpoints the
// importer calls. Accepts both versioned (/v1.41/x) and unversioned paths.
// Scenarios: baseline | swarm | old-api | empty | malformed | error.

const SCENARIOS = ['baseline', 'swarm', 'old-api', 'empty', 'malformed', 'error'] as const;
type Scenario = (typeof SCENARIOS)[number];
const store = makeScenarioStore([...SCENARIOS], 'baseline');
const log = new RequestLog();

const INFO = {
  ID: 'pw-engine-0001', Containers: 2, ContainersRunning: 2, Images: 3,
  Driver: 'overlay2', DockerRootDir: '/var/lib/docker', Name: 'pw-engine',
  ServerVersion: '24.0.7', OperatingSystem: 'pw-linux', Architecture: 'x86_64',
  Swarm: { LocalNodeState: 'inactive' },
};

const INFO_SWARM = {
  ...INFO,
  Swarm: {
    LocalNodeState: 'active', ControlAvailable: true,
    NodeID: 'node-1', NodeAddr: '10.0.0.1', Cluster: { ID: 'pw-cluster' },
    Managers: 1, Nodes: 2,
  },
};

const CONTAINERS = [
  {
    Id: 'c001'.padEnd(64, '0'), Names: ['/pw-web'], Image: 'nginx:1.25',
    ImageID: 'sha256:img1', Command: 'nginx', Created: 1700000000, State: 'running',
    Status: 'Up 2 hours',
    Labels: { 'com.docker.compose.service': 'web', 'componode.env': 'prod' },
    Ports: [{ PrivatePort: 80, Type: 'tcp' }],
  },
  {
    Id: 'c002'.padEnd(64, '0'), Names: ['/pw-worker'], Image: 'busybox:1.36',
    ImageID: 'sha256:img2', Command: 'sleep 3600', Created: 1700000000, State: 'running',
    Status: 'Up 2 hours', Labels: {}, Ports: [],
  },
];

const IMAGES = [
  { Id: 'sha256:img1'.padEnd(71, 'a'), RepoTags: ['nginx:1.25'], Created: 1699000000, Size: 187000000, Labels: {} },
  { Id: 'sha256:img2'.padEnd(71, 'b'), RepoTags: ['busybox:1.36'], Created: 1699000000, Size: 4500000, Labels: {} },
];

const SERVICES = [
  {
    ID: 'svc-1', Version: { Index: 10 }, CreatedAt: '2026-01-01T00:00:00Z', UpdatedAt: '2026-01-01T00:00:00Z',
    Spec: { Name: 'pw-svc', Labels: {}, TaskTemplate: { ContainerSpec: { Image: 'nginx:1.25' } }, Mode: { Replicated: { Replicas: 2 } } },
    Endpoint: { Ports: [] },
  },
];

const NODES = [
  { ID: 'node-1', Version: { Index: 9 }, CreatedAt: '2026-01-01T00:00:00Z', UpdatedAt: '2026-01-01T00:00:00Z', Spec: { Role: 'manager', Availability: 'active' }, Description: { Hostname: 'pw-mgr', Platform: { OS: 'linux', Architecture: 'x86_64' } }, Status: { State: 'ready', Addr: '10.0.0.1' }, ManagerStatus: { Leader: true, Reachability: 'reachable' } },
];

const SECRETS = [
  { ID: 'sec-1', Version: { Index: 8 }, CreatedAt: '2026-01-01T00:00:00Z', UpdatedAt: '2026-01-01T00:00:00Z', Spec: { Name: 'pw-secret', Labels: {} } },
];

const server = startDataServer({
  port: Number(env('MOCK_PORT', '2376')),
  tls: {
    certPath: env('MOCK_TLS_CERT'),
    keyPath: env('MOCK_TLS_KEY'),
    caPath: env('MOCK_TLS_CA'),
    requireClientCert: true,
  },
  handler: (req, body, res) => {
    const raw = req.url ?? '/';
    // Strip the /vX.Y API-version prefix — the importer may request either.
    const path = raw.replace(/^\/v\d+(\.\d+)?/, '');
    const url = new URL(path, 'http://x');
    log.add({ method: req.method ?? 'GET', path: url.pathname + url.search, scenario: store.current });
    const s: Scenario = store.current;

    if (s === 'malformed') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"broken": ');
      return;
    }
    if (s === 'error') return json(res, 500, { message: 'mock engine error' });

    const p = url.pathname;
    if (p === '/_ping') {
      res.writeHead(200).end('OK');
      return;
    }
    if (p === '/info') return json(res, 200, s === 'swarm' ? INFO_SWARM : INFO);
    if (p === '/version') {
      return json(res, 200, {
        Version: '24.0.7', ApiVersion: s === 'old-api' ? '1.40' : '1.43',
        MinAPIVersion: '1.24', GitCommit: 'pw', GoVersion: 'go1.22', Os: 'linux', Arch: 'amd64',
      });
    }
    if (p === '/containers/json') return json(res, 200, s === 'empty' ? [] : CONTAINERS);
    const inspect = p.match(/^\/containers\/([^/]+)\/json$/);
    if (inspect) {
      const c = CONTAINERS.find((x) => x.Id.startsWith(inspect[1]!));
      if (!c) return json(res, 404, { message: 'No such container' });
      return json(res, 200, {
        ...c, State: { Status: 'running', Running: true, StartedAt: '2026-01-01T00:00:00Z' },
        Config: { Labels: c.Labels, Env: ['PATH=/usr/bin'] }, Name: c.Names[0],
        NetworkSettings: { Networks: {} }, Mounts: [],
      });
    }
    if (p === '/images/json') return json(res, 200, s === 'empty' ? [] : IMAGES);
    if (p === '/services') return json(res, 200, s === 'swarm' ? SERVICES : []);
    if (p === '/nodes') return json(res, 200, s === 'swarm' ? NODES : []);
    if (p === '/secrets') return json(res, 200, s === 'swarm' ? SECRETS : []);
    return json(res, 404, { message: `mock-engine: no route ${p}` });
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
  log,
});

console.log(`docker-engine mock mtls :${env('MOCK_PORT', '2376')} control :${env('MOCK_CONTROL_PORT', '9444')}`);
void server; void control;
