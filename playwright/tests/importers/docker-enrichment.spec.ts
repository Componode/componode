import { test, expect } from '@playwright/test';
import { apiLogin, loginPage } from '../fixtures/auth.js';

const BASE = 'https://app.componode-pw.test';
const CTL = 'http://mock-control:9090';

async function scenario(name: string) {
  await fetch(`${CTL}/scenario/mock-docker-engine`, { method: 'POST', body: JSON.stringify({ name }) });
}

async function triggerAndWait(api: any, configId: string): Promise<string> {
  const trig = await api('POST', `/api/v1/importer-configs/${configId}/trigger`, {});
  if (trig.status >= 400) throw new Error(`trigger failed ${trig.status}: ${JSON.stringify(trig.body)}`);
  const runId = trig.body.runId ?? trig.body.id;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const run = await api('GET', `/api/v1/importer-configs/${configId}/runs/${runId}`);
    const status = run.body.status ?? run.body.run?.status;
    if (status && !['PENDING', 'RUNNING'].includes(status)) {
      expect(status, `run ${runId}`).toBe('COMPLETED');
      return status;
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error('run timeout');
}

async function dockerConfigId(api: any): Promise<string> {
  const configs = await api('GET', '/api/v1/importer-configs');
  const list = configs.body.items ?? configs.body.configs ?? configs.body.data ?? configs.body;
  const cfg = list.find((c: any) => (c.importerName ?? c.importer) === 'docker');
  if (!cfg) throw new Error('no docker importer config seeded');
  return cfg.id;
}

async function runDockerImport(api: any) {
  await triggerAndWait(api, await dockerConfigId(api));
}

async function dockerComponents(api: any): Promise<any[]> {
  const res = await api('GET', '/api/v1/components?provider=DOCKER&pageSize=100');
  expect(res.status).toBe(200);
  return res.body.data ?? res.body.items ?? res.body.components ?? res.body;
}

async function componentDetail(api: any, id: string): Promise<any> {
  const res = await api('GET', `/api/v1/components/${id}`);
  expect(res.status).toBe(200);
  return res.body.component;
}

async function findComponent(api: any, resourceTypes: string[], predicate: (c: any) => boolean) {
  const list = await dockerComponents(api);
  for (const item of list.filter((c: any) => resourceTypes.includes(c.resourceType))) {
    const detail = await componentDetail(api, item.id);
    if (predicate(detail)) return detail;
  }
  return null;
}

test.describe('docker importer enrichment (spec 064)', () => {
  test('baseline run emits bounded engine, container, and image enrichment', async ({ request }) => {
    await scenario('baseline');
    const api = await apiLogin(request, BASE, 'EDITOR');
    await runDockerImport(api);

    const list = await dockerComponents(api);
    const engines = list.filter((c: any) => c.resourceType === 'docker-engine');
    expect(engines.length, 'exactly one docker-engine component').toBe(1);

    const engine = await componentDetail(api, engines[0].id);
    const ed = engine.details ?? {};
    expect(ed.serverVersion).toBe('24.0.7');
    expect(ed.apiVersion).toBe('1.43');
    expect(ed.os).toBe('pw-linux');
    expect(ed.arch).toBe('x86_64');
    expect(ed.kernelVersion).toBe('6.6.0-pw');
    expect(ed.cgroupDriver).toBe('systemd');
    expect([...(ed.runtimes ?? [])].sort()).toEqual(['io.containerd.runc.v2', 'runc']);
    expect(ed.registryMirrors).toEqual(['https://mirror.pw.test']);
    expect(ed.swarmNodeState).toBe('inactive');
    // Excluded engine fields never leave the boundary (sentinels live in /info).
    const engineJson = JSON.stringify(ed);
    for (const banned of ['DockerRootDir', '/var/lib/docker', 'proxy.corp', 'Plugins', 'SecurityOptions', 'Warnings', 'apparmor']) {
      expect(engineJson, `engine details leak ${banned}`).not.toContain(banned);
    }
    const engineInst = engine.instances[0];
    expect(engineInst.environment).toBe('OTHER');
    expect(engineInst.status).toBe('RUNNING');

    // Container pw-web: bounded hostConfig + healthcheck + ports/networks.
    const web = await findComponent(api, ['container', 'compose-service'], (c) =>
      (c.instances ?? []).some((i: any) => i.rawConfig?.containerName === 'pw-web'));
    expect(web, 'pw-web container component').toBeTruthy();
    const webInst = web.instances.find((i: any) => i.rawConfig?.containerName === 'pw-web');
    const rc = webInst.rawConfig;
    expect(rc.imageRef).toBe('nginx:1.25');
    expect(rc.imageId).toContain('sha256:img1');
    expect(rc.imageDigest).toBe('nginx@sha256:feedfacecafe');
    expect(rc.hostConfig).toEqual({
      memoryBytes: 536870912,
      nanoCpus: 1500000000,
      pidsLimit: 100,
      restartPolicy: { mode: 'unless-stopped', maxRetries: 5 },
      privileged: true,
      readOnlyRootfs: true,
      logDriver: 'json-file',
    });
    expect(rc.healthcheck).toEqual({
      intervalSeconds: 30, timeoutSeconds: 10, retries: 3, startPeriodSeconds: 5,
    });
    expect(rc.ports).toEqual([
      { container: '80/tcp', published: [{ hostIp: '0.0.0.0', hostPort: '8080' }] },
    ]);
    expect(rc.networks).toEqual(['bridge', 'pw-overlay']);
    // Sentinels: env vars, healthcheck Test, binds, mount sources, log opts.
    const rcJson = JSON.stringify(rc);
    for (const banned of ['do-not-leak', 'APP_SECRET', 'PATH=/usr/bin', '/host/secrets', '/host/data', 'max-size', 'curl']) {
      expect(rcJson, `container rawConfig leak ${banned}`).not.toContain(banned);
    }

    // pw-worker: no HostConfig/Healthcheck reported → keys absent.
    const worker = await findComponent(api, ['container', 'compose-service'], (c) =>
      (c.instances ?? []).some((i: any) => i.rawConfig?.containerName === 'pw-worker'));
    expect(worker, 'pw-worker container component').toBeTruthy();
    const workerRc = worker.instances.find((i: any) => i.rawConfig?.containerName === 'pw-worker').rawConfig;
    expect(workerRc.hostConfig).toBeUndefined();
    expect(workerRc.healthcheck).toBeUndefined();
    expect(workerRc.imageId).toContain('sha256:img2');

    // Image assets: allowlisted OCI provenance only.
    const images = list.filter((c: any) => c.resourceType === 'image');
    expect(images.map((c: any) => c.name)).toEqual(expect.arrayContaining(['nginx:1.25', 'busybox:1.36']));
    const nginx = await componentDetail(api, images.find((c: any) => c.name === 'nginx:1.25').id);
    const nd = nginx.details ?? {};
    expect(nd.ociLabels?.['org.opencontainers.image.source']).toBe('https://github.com/nginx/nginx');
    expect(nd.ociLabels?.['org.opencontainers.image.version']).toBe('1.25.4');
    expect(nd.ociLabels?.['com.example.internal']).toBeUndefined();
    expect(nd.exposedPorts).toEqual(['80/tcp']);
    expect(nd.user).toBe('nginx');
    expect(nd.entrypoint).toEqual(['/docker-entrypoint.sh']);
    expect(nd.workingDir).toBe('/usr/share/nginx/html');
    expect(nd.volumes).toEqual(['/var/cache/nginx']);
    expect(nd.architecture).toBe('amd64');
    expect(nd.os).toBe('linux');
    expect(nd.imageId).toContain('sha256:img1');
    const ndJson = JSON.stringify(nd);
    for (const banned of ['NGINX_VERSION', 'com.example.internal', 'Env']) {
      expect(ndJson, `image details leak ${banned}`).not.toContain(banned);
    }

    const busybox = await componentDetail(api, images.find((c: any) => c.name === 'busybox:1.36').id);
    const bd = busybox.details ?? {};
    expect(bd.ociLabels).toBeUndefined();
    expect(bd.architecture).toBe('arm64');
    expect(bd.os).toBe('linux');
  });

  test('swarm run enriches service mode, ports, and networks', async ({ request }) => {
    await scenario('swarm');
    const api = await apiLogin(request, BASE, 'EDITOR');
    await runDockerImport(api);

    const list = await dockerComponents(api);
    const engines = list.filter((c: any) => c.resourceType === 'docker-engine');
    const engine = await componentDetail(api, engines[0].id);
    expect(engine.details.swarmNodeState).toBe('active');
    expect(engine.details.swarmControlAvailable).toBe(true);
    expect(engine.details.swarmManagers).toBe(1);

    const svc = await findComponent(api, ['swarm-service'], (c) => c.name === 'pw-svc');
    expect(svc, 'pw-svc swarm service').toBeTruthy();
    expect(svc.category).toBe('CONTAINER_ORCHESTRATION');
    expect(svc.details.mode).toBe('replicated');
    const svcInst = svc.instances[0];
    expect(svcInst.rawConfig.swarmObservation.mode).toBe('replicated');
    expect(svcInst.rawConfig.swarmObservation.desired).toBe(2);
    expect(svcInst.rawConfig.swarmObservation.running).toBe(2);
    expect(svcInst.rawConfig.ports).toEqual([
      { protocol: 'tcp', target: 80, published: 8080, publishMode: 'ingress' },
    ]);
    expect(svcInst.rawConfig.networks).toEqual(['pw-overlay', 'bridge']);

    const job = await findComponent(api, ['swarm-service'], (c) => c.name === 'pw-batch');
    expect(job, 'pw-batch job service').toBeTruthy();
    expect(job.details.mode).toBe('replicated-job');
    expect(job.instances[0].rawConfig.swarmObservation.mode).toBe('replicated-job');
    expect(job.instances[0].rawConfig.swarmObservation.completed).toBe(3);
    expect(job.instances[0].rawConfig.swarmObservation.desired).toBe(5);
    expect(job.instances[0].rawConfig.networks).toEqual(['pw-overlay']);
  });

  test('component detail renders named enrichment sections', async ({ page, request }) => {
    await scenario('baseline');
    const api = await apiLogin(request, BASE, 'EDITOR');
    await runDockerImport(api);

    const list = await dockerComponents(api);
    const engineItem = list.find((c: any) => c.resourceType === 'docker-engine');
    const engine = await componentDetail(api, engineItem.id);

    await loginPage(page, 'EDITOR');
    await page.goto(`/components/${engine.slug}`);
    await expect(page.getByRole('heading', { name: 'Engine', exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('24.0.7')).toBeVisible();
    await expect(page.getByText('1.43')).toBeVisible();

    const web = await findComponent(api, ['container', 'compose-service'], (c) =>
      (c.instances ?? []).some((i: any) => i.rawConfig?.containerName === 'pw-web'));
    await page.goto(`/components/${web.slug}`);
    await page.getByRole('button', { name: 'Show details' }).first().click();
    // Container instances render Observation/Image/Host config/Health check/
    // Networks — the Ports section is swarm-shape only (frontend-surfaces
    // contract); container port bindings stay in rawConfig unrendered.
    for (const section of ['Observation', 'Image', 'Host config', 'Health check definition', 'Networks']) {
      await expect(page.getByRole('heading', { name: section, exact: true })).toBeVisible();
    }
    await expect(page.getByText('512 MiB')).toBeVisible();
    await expect(page.getByText(/unless-stopped \(max 5\)/)).toBeVisible();
    await expect(page.getByText('30s').first()).toBeVisible();
    await expect(page.getByText('pw-overlay').first()).toBeVisible();

    const images = list.filter((c: any) => c.resourceType === 'image');
    const nginxItem = images.find((c: any) => c.name === 'nginx:1.25');
    await page.goto(`/components/${nginxItem.slug}`);
    await expect(page.getByRole('heading', { name: 'Image provenance' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('nginx').first()).toBeVisible();
    await expect(page.getByText('/usr/share/nginx/html')).toBeVisible();

    // Swarm service: the Ports section renders the flat published-port shape.
    await scenario('swarm');
    await runDockerImport(api);
    const svc = await findComponent(api, ['swarm-service'], (c) => c.name === 'pw-svc');
    await page.goto(`/components/${svc.slug}`);
    await page.getByRole('button', { name: 'Show details' }).first().click();
    for (const section of ['Observation', 'Ports', 'Networks']) {
      await expect(page.getByRole('heading', { name: section, exact: true })).toBeVisible({ timeout: 15_000 });
    }
    await expect(page.getByText('tcp 80 → 8080 (ingress)')).toBeVisible();
  });
});
