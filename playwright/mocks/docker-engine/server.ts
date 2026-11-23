import { startDataServer, startControlServer, makeScenarioStore, RequestLog, json, env } from '../lib/mock.js';

// Fake Docker Engine API over mTLS — only the read-only endpoints the
// importer calls. Accepts both versioned (/v1.41/x) and unversioned paths.
// Scenarios: baseline | swarm | old-api | empty | malformed | error |
// sbom | sbom-reduced.
// `sbom` adds OCI-registry behaviour: the nginx image gains a RepoDigest
// pointing at the companion registry listener (MOCK_REGISTRY_PORT, plain
// TLS — the referrers client presents no client cert) which serves a
// CycloneDX attestation with a dependencies[] graph (spec 078).
// `sbom-reduced` serves the same document minus the express → accepts
// dependency, so a second run retires exactly that one edge (T015).

const SCENARIOS = ['baseline', 'swarm', 'old-api', 'empty', 'malformed', 'error', 'sbom', 'sbom-reduced'] as const;
type Scenario = (typeof SCENARIOS)[number];
const store = makeScenarioStore([...SCENARIOS], 'baseline');
const log = new RequestLog();

const INFO = {
  ID: 'pw-engine-0001', Containers: 2, ContainersRunning: 2, Images: 3,
  Driver: 'overlay2', DockerRootDir: '/var/lib/docker', Name: 'pw-engine',
  ServerVersion: '24.0.7', OperatingSystem: 'pw-linux', Architecture: 'x86_64',
  KernelVersion: '6.6.0-pw', CgroupDriver: 'systemd',
  Runtimes: { runc: {}, 'io.containerd.runc.v2': {} },
  RegistryConfig: { Mirrors: ['https://mirror.pw.test'] },
  // Exclusion sentinels (spec 064): the importer must never surface these.
  Plugins: { Volume: [{ Name: 'local' }] },
  SecurityOptions: ['name=apparmor'],
  Warnings: ['experimental feature enabled'],
  HTTPProxy: 'http://proxy.corp:3128', HTTPSProxy: 'http://proxy.corp:3128',
  NoProxy: 'localhost',
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
    // Compose workload: project+service labels → joins the pw-app app
    // group (spec 070); pw-web deliberately stays standalone.
    Status: 'Up 2 hours',
    Labels: { 'com.docker.compose.project': 'pw-app', 'com.docker.compose.service': 'worker' },
    Ports: [],
  },
];

const IMAGES = [
  { Id: 'sha256:img1'.padEnd(71, 'a'), RepoTags: ['nginx:1.25'], Created: 1699000000, Size: 187000000, Labels: {} },
  { Id: 'sha256:img2'.padEnd(71, 'b'), RepoTags: ['busybox:1.36'], Created: 1699000000, Size: 4500000, Labels: {} },
];

// Per-image inspect payloads (spec 064): allowlisted OCI labels plus
// sentinel fields (Env, non-allowlisted label) the importer must drop.
// Index-parallel to IMAGES.
const IMAGE_INSPECTS: unknown[] = [
  {
    Architecture: 'amd64', Os: 'linux',
    Config: {
      Labels: {
        'org.opencontainers.image.source': 'https://github.com/nginx/nginx',
        'org.opencontainers.image.revision': 'a1b2c3d',
        'org.opencontainers.image.version': '1.25.4',
        'org.opencontainers.image.vendor': 'NGINX',
        'org.opencontainers.image.licenses': 'BSD-2-Clause',
        'org.opencontainers.image.description': 'nginx web server',
        'org.opencontainers.image.title': 'nginx',
        'org.opencontainers.image.url': 'https://nginx.org',
        'org.opencontainers.image.documentation': 'https://docs.nginx.com',
        'org.opencontainers.image.source-label': 'org.opencontainers.image.source=nginx',
        'com.example.internal': 'must-not-appear',
      },
      User: 'nginx',
      ExposedPorts: { '80/tcp': {} },
      Entrypoint: ['/docker-entrypoint.sh'],
      WorkingDir: '/usr/share/nginx/html',
      Volumes: { '/var/cache/nginx': {} },
      Env: ['NGINX_VERSION=1.25.4'],
    },
  },
  {
    Architecture: 'arm64', Os: 'linux',
    Config: { Labels: {}, Env: ['PATH=/usr/bin'] },
  },
];

// Per-container inspect enrichment (spec 064): image id, bounded
// HostConfig/Healthcheck, real Networks/Ports — plus sentinels the
// importer must never surface (Config.Env, Healthcheck.Test, Binds,
// host paths in Mounts).
const CONTAINER_INSPECT_EXTRA: Record<string, Record<string, unknown>> = {
  c001: {
    Image: IMAGES[0].Id,
    RepoDigests: ['nginx@sha256:feedfacecafe'],
    Config: {
      Image: 'nginx:1.25',
      Labels: CONTAINERS[0].Labels,
      Env: ['PATH=/usr/bin', 'APP_SECRET=do-not-leak'],
      Healthcheck: {
        Test: ['CMD', 'curl', '-f', 'http://localhost/'],
        Interval: 30000000000, Timeout: 10000000000,
        Retries: 3, StartPeriod: 5000000000,
      },
    },
    HostConfig: {
      Memory: 536870912, NanoCpus: 1500000000, PidsLimit: 100,
      RestartPolicy: { Name: 'unless-stopped', MaximumRetryCount: 5 },
      Privileged: true, ReadonlyRootfs: true,
      LogConfig: { Type: 'json-file', Config: { 'max-size': '10m' } },
      Binds: ['/host/secrets:/run/secrets:ro'],
    },
    NetworkSettings: {
      Ports: { '80/tcp': [{ HostIp: '0.0.0.0', HostPort: '8080' }] },
      Networks: {
        bridge: { IPAddress: '172.17.0.2' },
        'pw-overlay': { IPAddress: '10.0.0.5' },
      },
    },
    Mounts: [{ Type: 'bind', Source: '/host/data', Destination: '/data' }],
  },
  c002: {
    Image: IMAGES[1].Id,
    Config: {
      Image: 'busybox:1.36',
      Labels: CONTAINERS[1].Labels,
      Env: ['PATH=/usr/bin'],
    },
    NetworkSettings: { Ports: {}, Networks: { bridge: { IPAddress: '172.17.0.3' } } },
    Mounts: [],
  },
};

const SERVICES = [
  {
    ID: 'svc-1', Version: { Index: 10 }, CreatedAt: '2026-01-01T00:00:00Z', UpdatedAt: '2026-01-01T00:00:00Z',
    Spec: {
      Name: 'pw-svc', Labels: { 'com.docker.stack.namespace': 'pw-stack' },
      TaskTemplate: { ContainerSpec: { Image: 'nginx:1.25' } },
      Mode: { Replicated: { Replicas: 2 } },
      EndpointSpec: { Ports: [{ Protocol: 'tcp', TargetPort: 80, PublishedPort: 8080, PublishMode: 'ingress' }] },
      Networks: [{ Target: 'pw-overlay' }, { Target: 'bridge' }],
    },
    Endpoint: { Ports: [] },
    ServiceStatus: { RunningTasks: 2, DesiredTasks: 2 },
    UpdateStatus: { State: 'completed' },
  },
  {
    ID: 'svc-2', Version: { Index: 11 }, CreatedAt: '2026-01-02T00:00:00Z', UpdatedAt: '2026-01-02T00:00:00Z',
    Spec: {
      Name: 'pw-batch', Labels: {},
      TaskTemplate: { ContainerSpec: { Image: 'busybox:1.36', Command: ['sh', '-c', 'job'] } },
      Mode: { ReplicatedJob: { MaxConcurrent: 1, TotalCompletions: 5 } },
      EndpointSpec: { Ports: [] },
      Networks: [{ Target: 'pw-overlay' }],
    },
    Endpoint: { Ports: [] },
    ServiceStatus: { RunningTasks: 1, DesiredTasks: 5, CompletedTasks: 3 },
  },
];

const NODES = [
  { ID: 'node-1', Version: { Index: 9 }, CreatedAt: '2026-01-01T00:00:00Z', UpdatedAt: '2026-01-01T00:00:00Z', Spec: { Role: 'manager', Availability: 'active' }, Description: { Hostname: 'pw-mgr', Platform: { OS: 'linux', Architecture: 'x86_64' } }, Status: { State: 'ready', Addr: '10.0.0.1' }, ManagerStatus: { Leader: true, Reachability: 'reachable' } },
];

const SECRETS = [
  { ID: 'sec-1', Version: { Index: 8 }, CreatedAt: '2026-01-01T00:00:00Z', UpdatedAt: '2026-01-01T00:00:00Z', Spec: { Name: 'pw-secret', Labels: {} } },
];

// Infrastructure inventory fixtures (spec 065): NETWORK + STORAGE
// components. Sentinels the importer must never surface — IPAM,
// Options, endpoint addressing, Mountpoint, volume Options/Status,
// and non-allowlisted labels.
const NETWORKS = [
  {
    Id: 'net-pw-overlay', Name: 'pw-overlay', Created: '2026-01-01T00:00:00Z',
    Scope: 'swarm', Driver: 'overlay', EnableIPv6: false, Internal: true,
    Attachable: true, Ingress: true, ConfigOnly: false,
    Labels: { 'com.docker.compose.project': 'pw-app', 'com.acme.internal': 'drop-me' },
  },
  {
    Id: 'net-bridge', Name: 'bridge', Created: '2026-01-01T00:00:00Z',
    Scope: 'local', Driver: 'bridge', EnableIPv6: false, Internal: false,
    Attachable: false, Ingress: false, ConfigOnly: false, Labels: {},
  },
];

// Per-network inspect payloads — index-parallel to NETWORKS. The list
// shape omits Containers on API >= 1.28; inspect carries them plus the
// excluded IPAM/Options/addressing sentinels.
const NETWORK_INSPECTS: Record<string, unknown> = {
  'net-pw-overlay': {
    ...NETWORKS[0],
    IPAM: { Driver: 'default', Config: [{ Subnet: '10.90.0.0/24', Gateway: '10.90.0.1' }] },
    Options: { 'com.docker.network.driver.overlay.enable_ipv6': 'false' },
    Containers: {
      'ep-aaa': { Name: 'pw-web', EndpointID: 'ep-aaa-secret', MacAddress: '02:42:ac:00:00:01', IPv4Address: '10.90.0.2/24', IPv6Address: '', GlobalIPv6Address: '' },
      'ep-bbb': { Name: 'pw-worker', EndpointID: 'ep-bbb-secret', MacAddress: '02:42:ac:00:00:02', IPv4Address: '10.90.0.3/24' },
    },
  },
  'net-bridge': {
    ...NETWORKS[1],
    IPAM: { Driver: 'default', Config: [{ Subnet: '172.17.0.0/16', Gateway: '172.17.0.1' }] },
    Options: { 'com.docker.network.bridge.name': 'docker0', 'com.docker.network.bridge.enable_ip_masquerade': 'true' },
    Containers: {
      'ep-ccc': { Name: 'pw-standalone', EndpointID: 'ep-ccc-secret', MacAddress: '02:42:ac:11:00:01', IPv4Address: '172.17.0.2/16' },
    },
  },
};

const VOLUMES = [
  {
    Name: 'pw-data', Driver: 'local', CreatedAt: '2026-01-01T00:00:00Z',
    Scope: 'local',
    Labels: { 'com.docker.compose.project': 'pw-app' },
    // Exclusion sentinels — never surfaced.
    Mountpoint: '/var/lib/docker/volumes/pw-data/_data',
    Options: { type: 'nfs', o: 'addr=10.9.9.9,rw', device: ':/srv/pw' },
    Status: { 'com.docker.compose.project.working_dir': '/srv/pw' },
  },
  {
    Name: 'pw-cache', Driver: 'local', CreatedAt: '2026-01-02T00:00:00Z',
    Scope: 'local', Labels: {},
    Mountpoint: '/var/lib/docker/volumes/pw-cache/_data',
    Options: {}, Status: {},
  },
  {
    // pw-orphan: present in /volumes but absent from /system/df — the
    // join-gap case (usage fields must be omitted, not zeroed).
    Name: 'pw-orphan', Driver: 'local', CreatedAt: '2026-01-03T00:00:00Z',
    Scope: 'local', Labels: {},
    Mountpoint: '/var/lib/docker/volumes/pw-orphan/_data',
    Options: {}, Status: {},
  },
];

// GET /system/df usage join — pw-data reports real usage; pw-cache
// reports the -1 "not available" sentinels; pw-orphan has no df entry.
const DF_VOLUMES = [
  { ...VOLUMES[0], UsageData: { Size: 5242880, RefCount: 2, Reclaimable: true } },
  { ...VOLUMES[1], UsageData: { Size: -1, RefCount: -1 } },
];

// --- spec 078 — OCI registry fixture (sbom scenario) ----------------------
// The importer's referrers path resolves `https://{registry}/v2/...` from
// the image's RepoDigests, so the digest below points at this mock's own
// second listener (plain TLS — the fetch carries no client cert, unlike
// the engine's mTLS endpoint). Registry = `mock-docker-engine:<port>`,
// which `parseRepoDigest` classifies by the `:` in the first segment.
const REGISTRY_PORT = env('MOCK_REGISTRY_PORT', '5000');
const REGISTRY_REPO = 'pw-web';
const SBOM_DIGEST = `sha256:${'a'.repeat(64)}`;
const SBOM_MANIFEST_DIGEST = `sha256:${'b'.repeat(64)}`;
const SBOM_BLOB_DIGEST = `sha256:${'c'.repeat(64)}`;
const SBOM_IMAGE_REF = `mock-docker-engine:${REGISTRY_PORT}/${REGISTRY_REPO}@${SBOM_DIGEST}`;

// subject root → pw-app, express, pw-hide-desktop, pw-hide-narrow;
// express → accepts (library→library); pw-lib → root (package→subject,
// resolves to docker-image:{digest} on the image carrier).
const SBOM_CDX_DOC = {
  bomFormat: 'CycloneDX',
  specVersion: '1.5',
  metadata: {
    component: { type: 'container', name: 'pw-web', 'bom-ref': 'root' },
    tools: [{ name: 'pw-mock', version: '1.0.0' }],
  },
  components: [
    ['pw-app', '1.0.0'], ['express', '4.21.0'], ['accepts', '1.3.8'],
    ['pw-hide-desktop', '1.0.0'], ['pw-hide-narrow', '1.0.0'], ['pw-lib', '2.0.0'],
  ].map(([name, version]) => ({
    type: 'library',
    'bom-ref': `pkg:npm/${name}@${version}`,
    purl: `pkg:npm/${name}@${version}`,
    name,
    version,
  })),
  dependencies: [
    {
      ref: 'root',
      dependsOn: [
        'pkg:npm/pw-app@1.0.0', 'pkg:npm/express@4.21.0',
        'pkg:npm/pw-hide-desktop@1.0.0', 'pkg:npm/pw-hide-narrow@1.0.0',
      ],
    },
    { ref: 'pkg:npm/express@4.21.0', dependsOn: ['pkg:npm/accepts@1.3.8'] },
    { ref: 'pkg:npm/pw-lib@2.0.0', dependsOn: ['root'] },
  ],
};

// `sbom-reduced` — identical inventory and subject edges; only the
// express → accepts dependency is gone, so a re-run retires exactly
// that pair while every other edge persists (T015 / SC-002).
const SBOM_CDX_DOC_REDUCED = {
  ...SBOM_CDX_DOC,
  dependencies: SBOM_CDX_DOC.dependencies.filter(
    (d) => d.ref !== 'pkg:npm/express@4.21.0',
  ),
};

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
      const extra = CONTAINER_INSPECT_EXTRA[c.Id.slice(0, 4)] ?? {};
      return json(res, 200, {
        ...c, ...extra,
        State: { Status: 'running', Running: true, StartedAt: '2026-01-01T00:00:00Z' },
        Name: c.Names[0],
      });
    }
    if (p === '/images/json') {
      if (s === 'empty') return json(res, 200, []);
      // sbom: the nginx image carries the registry RepoDigest so the
      // emitted docker-image asset can resolve its SBOM (spec 078).
      if (s === 'sbom' || s === 'sbom-reduced') return json(res, 200, [{ ...IMAGES[0]!, RepoDigests: [SBOM_IMAGE_REF] }, IMAGES[1]]);
      return json(res, 200, IMAGES);
    }
    const imgInspect = p.match(/^\/images\/([^/]+)\/json$/);
    if (imgInspect) {
      const id = decodeURIComponent(imgInspect[1]!);
      // Match by Id prefix (engine convention) or RepoTag — the importer
      // resolves workload SBOMs via getImage(<Config.Image>) by tag.
      const idx = IMAGES.findIndex(
        (i) => i.Id === id || i.Id.startsWith(id) || (i.RepoTags ?? []).includes(id),
      );
      if (idx < 0) return json(res, 404, { message: 'No such image' });
      return json(res, 200, {
        Id: IMAGES[idx]!.Id,
        ...(IMAGE_INSPECTS[idx] as object),
        ...((s === 'sbom' || s === 'sbom-reduced') && idx === 0 ? { RepoDigests: [SBOM_IMAGE_REF] } : {}),
      });
    }
    if (p === '/services') return json(res, 200, s === 'swarm' ? SERVICES : []);
    if (p === '/nodes') return json(res, 200, s === 'swarm' ? NODES : []);
    if (p === '/secrets') return json(res, 200, s === 'swarm' ? SECRETS : []);
    if (p === '/networks') return json(res, 200, s === 'empty' ? [] : NETWORKS);
    const netInspect = p.match(/^\/networks\/([^/]+)$/);
    if (netInspect) {
      const n = NETWORK_INSPECTS[decodeURIComponent(netInspect[1]!)];
      if (!n) return json(res, 404, { message: 'No such network' });
      return json(res, 200, n);
    }
    if (p === '/volumes') return json(res, 200, { Volumes: s === 'empty' ? [] : VOLUMES });
    if (p === '/system/df') {
      return json(res, 200, { Images: [], Containers: [], Volumes: s === 'empty' ? [] : DF_VOLUMES, BuildCache: [] });
    }
    return json(res, 404, { message: `mock-engine: no route ${p}` });
  },
});

// Spec 078 — OCI registry companion on a second listener. Plain TLS on the
// same engine cert (no client-cert requirement — the importer's referrers
// fetch presents none). Serves the referrers index → attestation manifest →
// CycloneDX blob chain for SBOM_IMAGE_REF's repo; only in `sbom` scenario.
const registry = startDataServer({
  port: Number(REGISTRY_PORT),
  tls: {
    certPath: env('MOCK_TLS_CERT', 'docker-engine.crt'),
    keyPath: env('MOCK_TLS_KEY', 'docker-engine.key'),
    requireClientCert: false,
  },
  handler: (req, _body, res) => {
    const p = (req.url ?? '/').split('?')[0]!;
    log.add({ method: req.method ?? 'GET', path: p, scenario: store.current });
    const sc = store.current;
    if (sc !== 'sbom' && sc !== 'sbom-reduced') return json(res, 404, { message: 'mock-registry: no routes outside sbom scenarios' });
    const m = p.match(/^\/v2\/(.+)\/(referrers|manifests|blobs)\/([^/]+)$/);
    if (!m) return json(res, 404, { message: `mock-registry: no route ${p}` });
    const [, repo, kind, digest] = m;
    if (repo !== REGISTRY_REPO) return json(res, 404, { message: 'no such repository' });
    if (kind === 'referrers' && digest === SBOM_DIGEST) {
      return json(res, 200, {
        schemaVersion: 2,
        manifests: [{
          mediaType: 'application/vnd.oci.image.manifest.v1+json',
          digest: SBOM_MANIFEST_DIGEST,
          size: 200,
          artifactType: 'application/vnd.cyclonedx+json',
        }],
      });
    }
    if (kind === 'manifests' && digest === SBOM_MANIFEST_DIGEST) {
      return json(res, 200, {
        schemaVersion: 2,
        layers: [{ digest: SBOM_BLOB_DIGEST, size: 500 }],
      });
    }
    if (kind === 'blobs' && digest === SBOM_BLOB_DIGEST) {
      return json(res, 200, sc === 'sbom-reduced' ? SBOM_CDX_DOC_REDUCED : SBOM_CDX_DOC);
    }
    return json(res, 404, { message: 'mock-registry: not found' });
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

console.log(`docker-engine mock mtls :${env('MOCK_PORT', '2376')} registry :${REGISTRY_PORT} control :${env('MOCK_CONTROL_PORT', '9444')}`);
void server; void registry; void control;
