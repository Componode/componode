import { startDataServer, startControlServer, makeScenarioStore, RequestLog, json, env } from '../lib/mock.js';

// Fake Kubernetes API over plain HTTP — only the read-only endpoints the
// importer calls: the namespaced pod list plus the one-hop ReplicaSet owner
// lookup. Scenarios: baseline | pods-empty.
//
// Spec 079 — the `web` container's image points at the mock-docker-engine
// OCI registry listener (sbom scenario serves a CycloneDX attestation with
// a dependencies[] graph), so an `includePodImageSbom` run produces real
// entries + edges for the owning Deployment workload. The `sidecar`
// container is a digestless tag ref — partial coverage: its SBOM stays
// UNAVAILABLE while the resolved image still carries the workload.
const SCENARIOS = ['baseline', 'pods-empty'] as const;
type Scenario = (typeof SCENARIOS)[number];
const store = makeScenarioStore([...SCENARIOS], 'baseline');
const log = new RequestLog();

// Must match the docker-engine mock's SBOM_IMAGE_REF — that mock's registry
// listener serves the CycloneDX doc (subject → packages, express → accepts,
// pw-lib → subject) when its own scenario is `sbom`.
const REGISTRY = env('MOCK_REGISTRY', 'mock-docker-engine:5000');
const SBOM_IMAGE = `${REGISTRY}/pw-web@sha256:${'a'.repeat(64)}`;

const PODS = {
  apiVersion: 'v1',
  kind: 'PodList',
  items: [
    {
      metadata: {
        name: 'web-abc',
        namespace: 'prod',
        ownerReferences: [
          { apiVersion: 'apps/v1', kind: 'ReplicaSet', name: 'web-abc' },
        ],
      },
      spec: {
        containers: [
          { name: 'web', image: SBOM_IMAGE },
          { name: 'sidecar', image: 'busybox:latest' },
        ],
      },
      status: {
        containerStatuses: [
          { name: 'web', imageID: `docker-pullable://${SBOM_IMAGE}` },
          { name: 'sidecar', imageID: 'docker-pullable://busybox:latest' },
        ],
      },
    },
  ],
};

// web-abc → Deployment `web` — the one-hop ReplicaSet lookup the collector
// does to map pods onto the configured `apps/v1:Deployment` workload.
const REPLICA_SETS: Record<string, unknown> = {
  'web-abc': {
    metadata: {
      name: 'web-abc',
      ownerReferences: [{ apiVersion: 'apps/v1', kind: 'Deployment', name: 'web' }],
    },
  },
};

const server = startDataServer({
  port: Number(env('MOCK_PORT', '6443')),
  handler: (req, _body, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    log.add({ method: req.method ?? 'GET', path: url.pathname, scenario: store.current });
    const s: Scenario = store.current;
    const p = url.pathname;

    if (p.match(/^\/api\/v1\/namespaces\/[^/]+\/pods$/)) {
      return json(res, 200, s === 'pods-empty' ? { apiVersion: 'v1', kind: 'PodList', items: [] } : PODS);
    }
    const rs = p.match(/^\/apis\/apps\/v1\/namespaces\/[^/]+\/replicasets\/([^/]+)$/);
    if (rs) {
      const body = REPLICA_SETS[decodeURIComponent(rs[1]!)];
      if (!body) return json(res, 404, { kind: 'Status', code: 404, message: 'replicaset not found' });
      return json(res, 200, body);
    }
    return json(res, 404, { kind: 'Status', code: 404, message: `mock-k8s: no route ${p}` });
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

console.log(`kubernetes mock http :${env('MOCK_PORT', '6443')} control :${env('MOCK_CONTROL_PORT', '9444')}`);
void server; void control;
