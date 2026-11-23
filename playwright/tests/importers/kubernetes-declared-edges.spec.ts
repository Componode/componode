import { test, expect } from '@playwright/test';
import { apiLogin, loginPage, type ApiCall } from '../fixtures/auth.js';

const BASE = 'https://app.componode-pw.test';
const CTL = 'http://mock-control:9090';
// Dedicated config — its own source identity (the k8s endpoint), so this
// spec's opted-in runs are the only edge-declaring runs and helper queries
// stay unambiguous.
const ENDPOINT = 'http://mock-kubernetes:6443';
const CONFIG_LABEL = 'pw-k8s-edges';
// The pod's ReplicaSet chain resolves to Deployment `web`; the workload
// asset is named `{apiVersion:Kind}:{namespace}` by the importer.
const WORKLOAD = 'apps/v1:Deployment:prod';
const EXPRESS_SLUG = 'pkg-npm-express';
const ACCEPTS_SLUG = 'pkg-npm-accepts';
const PW_LIB_SLUG = 'pkg-npm-pw-lib';
const HIDE_SLUG = (project: string) =>
  project === 'chromium-narrow' ? 'pkg-npm-pw-hide-narrow' : 'pkg-npm-pw-hide-desktop';
const HIDE_NAME = (project: string) =>
  project === 'chromium-narrow' ? 'pw-hide-narrow' : 'pw-hide-desktop';

async function scenario(target: string, name: string) {
  await fetch(`${CTL}/scenario/${target}`, { method: 'POST', body: JSON.stringify({ name }) });
}

async function triggerAndWait(api: ApiCall, configId: string) {
  const trig = await api('POST', `/api/v1/importer-configs/${configId}/trigger`, {});
  if (trig.status >= 400) throw new Error(`trigger failed ${trig.status}`);
  const runId: string = trig.body.runId ?? trig.body.id;
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const run = await api('GET', `/api/v1/importer-configs/${configId}/runs/${runId}`);
    const status = run.body.status ?? run.body.run?.status;
    if (status && !['PENDING', 'RUNNING'].includes(status)) return runId;
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error('run timeout');
}

async function findComponent(api: ApiCall, fragment: string, slug: string) {
  // LIBRARY rows hide behind `libraries=true`.
  const res = await api(
    'GET',
    `/api/v1/components?search=${encodeURIComponent(fragment)}&libraries=true&pageSize=50`,
  );
  const items = res.body.data ?? res.body.components ?? res.body.items ?? [];
  return items.find((c: any) => c.slug === slug || c.name === fragment);
}

/**
 * Spec 079 — kubernetes as the fourth declared-edge carrier (ADR-133). The
 * mock cluster's pod runs the same pw-web image the docker-engine registry
 * serves a CycloneDX attestation for (subject → packages, express →
 * accepts, pw-lib → subject). With `includePodImageSbom` +
 * `importDeclaredEdges` the run materializes IMPORTER edges: the
 * `apps/v1:Deployment:prod` workload depends on the document's packages and
 * express → accepts is a library edge. Unlike docker, no image component is
 * emitted — pw-lib → docker-image:{digest} stays unresolved and is dropped
 * by same-run target resolution.
 */
test.describe('kubernetes declared edges', () => {
  let edgesConfigId = '';

  test.beforeAll(async ({ request }, testInfo) => {
    // Importer-config writes are ADMIN-only.
    const api = await apiLogin(request, BASE, 'ADMIN');

    const list = await api('GET', '/api/v1/importer-configs');
    const configs = list.body.data ?? list.body.configs ?? list.body.items ?? [];
    let configId: string | undefined = configs.find(
      (c: any) => c.label === `${CONFIG_LABEL}-${testInfo.project.name}`,
    )?.id;
    const wantedScope = {
      endpoint: ENDPOINT,
      namespace: 'prod',
      resourceTypes: ['apps/v1:Deployment'],
      includePodImageSbom: true,
      importDeclaredEdges: true,
    };
    if (configId) {
      // Reuse across suite re-runs: AS6 leaves the opt-in off, so
      // reassert the declaring scope before the seeding run.
      const cfg = await api('GET', `/api/v1/importer-configs/${configId}`);
      const scope = cfg.body.config?.scope ?? cfg.body.scope ?? {};
      await api('PATCH', `/api/v1/importer-configs/${configId}`, {
        scope: { ...scope, ...wantedScope },
      });
    } else {
      const created = await api('POST', '/api/v1/importer-configs', {
        importerName: 'kubernetes',
        label: `${CONFIG_LABEL}-${testInfo.project.name}`,
        scope: wantedScope,
        enabled: true,
      });
      expect(created.status).toBeLessThan(300);
      configId = created.body.id ?? created.body.config?.id ?? created.body.importerConfig?.id;
    }
    if (!configId) throw new Error('k8s edges config missing after create');
    edgesConfigId = configId;

    // Two mocks in the chain: the cluster fixture always serves the pod
    // (baseline); the image's SBOM comes from the docker-engine registry
    // listener, which only answers in the `sbom` scenario.
    await scenario('mock-kubernetes', 'baseline');
    await scenario('mock-docker-engine', 'sbom');
    await triggerAndWait(api, edgesConfigId);

    // Wait out the post-completion edge pass: the importer-native
    // libraries land alongside the edges.
    const deadline = Date.now() + 30_000;
    let express: any = null;
    while (Date.now() < deadline) {
      express = express ?? (await findComponent(api, 'express', EXPRESS_SLUG));
      if (express) break;
      await new Promise((r) => setTimeout(r, 1500));
    }
    expect(express, 'importer-native library pkg-npm-express').toBeTruthy();
  });

  test.afterAll(async () => {
    await scenario('mock-kubernetes', 'baseline');
    await scenario('mock-docker-engine', 'baseline');
  });

  test('opt-in switch renders the review-bypass copy and persists through the form', async ({ page, request }, testInfo) => {
    // The refine rejects importDeclaredEdges without includePodImageSbom
    // at the API boundary before the browser assertions.
    const api = await apiLogin(request, BASE, 'ADMIN');
    const rejected = await api('POST', '/api/v1/importer-configs', {
      importerName: 'kubernetes',
      label: `pw-k8s-edges-invalid-${testInfo.project.name}`,
      scope: {
        endpoint: ENDPOINT,
        namespace: 'prod',
        resourceTypes: ['apps/v1:Deployment'],
        includePodImageSbom: false,
        importDeclaredEdges: true,
      },
      enabled: false,
    });
    expect(rejected.status).toBe(400);

    await loginPage(page, 'ADMIN');
    await page.goto('/importers/new');
    await page.locator('#i-provider').click();
    await page.getByRole('option', { name: 'Kubernetes' }).click();
    await page.locator('#i-scope-endpoint').fill(ENDPOINT);
    await page.locator('#i-scope-namespace').fill('prod');

    // includePodImageSbom precedes importDeclaredEdges — the dependent
    // switch is meaningless without the SBOM fetch it gates.
    await expect(page.getByText('Import declared edges')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/added to the catalog without review/)).toBeVisible();

    const label = `pw-k8s-edges-ui-${testInfo.project.name}`;
    await page.locator('#i-label').fill(label);
    await page.locator('#i-scope-includePodImageSbom').click();
    await page.locator('#i-scope-importDeclaredEdges').click();
    await page.getByRole('button', { name: 'Create importer' }).click();

    const deadline = Date.now() + 15_000;
    let createdScope: any = null;
    while (Date.now() < deadline) {
      const list = await api('GET', '/api/v1/importer-configs');
      const configs = list.body.data ?? list.body.configs ?? list.body.items ?? [];
      const found = configs.find((c: any) => c.label === label);
      if (found) {
        createdScope = found.scope;
        break;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    expect(createdScope?.includePodImageSbom).toBe(true);
    expect(createdScope?.importDeclaredEdges).toBe(true);
  });

  test('viewer sees workload → package edges with provenance on the library', async ({ page }) => {
    await loginPage(page, 'VIEWER');
    // One carrier row only — the workload. The package → subject edge has
    // no image asset to land on and never materializes.
    await page.goto(`/components/${EXPRESS_SLUG}?tab=relationships`);

    const workloadRow = page.getByRole('button', {
      name: new RegExp(`${WORKLOAD}, depends on express.*Added by importer`, 'i'),
    });
    await expect(workloadRow).toBeVisible({ timeout: 30_000 });

    await workloadRow.click();
    await expect(page.getByTestId('edge-provenance-importer')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Source', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Import run', exact: true })).toBeVisible();
    await expect(page.getByTestId('hide-edge')).not.toBeVisible();
  });

  test('package edges render: library → library, package → subject dropped', async ({ page }) => {
    await loginPage(page, 'VIEWER');

    // express → accepts: library → library rolls into the bounded summary.
    await page.goto(`/components/${EXPRESS_SLUG}?tab=relationships`);
    await expect(page.getByTestId('libraries-summary-dependsOn')).toContainText(
      '1 library',
      { timeout: 30_000 },
    );
    await page.goto(`/components/${ACCEPTS_SLUG}?tab=relationships`);
    await expect(page.getByTestId('libraries-summary-dependedOnBy')).toContainText(
      '1 library',
    );

    // pw-lib is still an importer-native library (it's in the BOM), but
    // its `→ SUBJECT` edge targets docker-image:{digest} — kubernetes
    // emits no image asset, so same-run resolution drops it: no outgoing
    // depended-on-by row at all.
    await page.goto(`/components/${PW_LIB_SLUG}?tab=relationships`);
    await expect(
      page.getByRole('button', { name: /depended on by pw-lib/i }),
    ).not.toBeVisible({ timeout: 30_000 });
  });

  test('editor hides an importer edge and it is not recreated by the next run', async ({ page, request }, testInfo) => {
    // Two full re-runs inside the test — double the default timeout.
    test.setTimeout(180_000);
    const slug = HIDE_SLUG(testInfo.project.name);
    const name = HIDE_NAME(testInfo.project.name);
    const api = await apiLogin(request, BASE, 'EDITOR');
    await loginPage(page, 'EDITOR');
    await page.goto(`/components/${slug}?tab=relationships`);

    const row = page.getByRole('button', {
      name: new RegExp(`${WORKLOAD}, depends on ${name}.*Added by importer`, 'i'),
    });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.click();
    await page.getByTestId('hide-edge').click();
    await expect(page.getByText(/won't be recreated by future imports/i)).toBeVisible();
    await page.getByTestId('hide-edge-confirm').click();
    await expect(page.getByText('Edge hidden')).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByRole('button', { name: new RegExp(`${WORKLOAD}, depends on ${name}`, 'i') }),
    ).not.toBeVisible();

    // Re-run twice — the suppressed pair stays hidden while the other
    // edges re-materialize with zero duplicates.
    await scenario('mock-docker-engine', 'sbom');
    await triggerAndWait(api, edgesConfigId);
    await scenario('mock-docker-engine', 'sbom');
    await triggerAndWait(api, edgesConfigId);
    await page.reload();
    await expect(
      page.getByRole('button', { name: new RegExp(`${WORKLOAD}, depends on ${name}`, 'i') }),
    ).not.toBeVisible({ timeout: 30_000 });
    await page.goto(`/components/${EXPRESS_SLUG}?tab=relationships`);
    await expect(
      page.getByRole('button', {
        name: new RegExp(`${WORKLOAD}, depends on express.*Added by importer`, 'i'),
      }),
    ).toHaveCount(1);
  });

  test('flag-off hides the opt-in switch and every provenance surface', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      window.localStorage.setItem('componode.flag.bomImporterEdges', 'false');
    });
    await loginPage(page, 'ADMIN');
    await page.goto('/importers/new');
    await page.locator('#i-provider').click();
    await page.getByRole('option', { name: 'Kubernetes' }).click();
    await expect(page.locator('#i-scope-includePodImageSbom')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Import declared edges')).not.toBeVisible();

    await loginPage(page, 'VIEWER');
    await page.goto(`/components/${EXPRESS_SLUG}?tab=relationships`);
    const row = page.getByRole('button', {
      name: new RegExp(`${WORKLOAD}, depends on express`, 'i'),
    });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(row).not.toContainText('Added by importer');
    await row.click();
    await expect(page.getByTestId('edge-provenance-importer')).not.toBeVisible();
    await expect(page.getByTestId('hide-edge')).not.toBeVisible();
  });

  test('a dependency removed from the SBOM retires exactly that edge', async ({ page, request }) => {
    // One re-run on the reduced graph — the `sbom-reduced` scenario drops
    // only express → accepts, so that pair alone retires while the
    // subject edges and every other package edge persist (SC-002).
    test.setTimeout(180_000);
    const api = await apiLogin(request, BASE, 'ADMIN');
    await scenario('mock-docker-engine', 'sbom-reduced');
    await triggerAndWait(api, edgesConfigId);
    await scenario('mock-docker-engine', 'sbom'); // restore for the next project's beforeAll

    await loginPage(page, 'VIEWER');
    await page.goto(`/components/${EXPRESS_SLUG}?tab=relationships`);
    // express → accepts retired: no outgoing library lane remains.
    await expect(
      page.getByTestId('libraries-summary-dependsOn'),
    ).not.toBeVisible({ timeout: 30_000 });
    // subject → express persists on the workload carrier.
    await expect(
      page.getByRole('button', {
        name: new RegExp(`${WORKLOAD}, depends on express.*Added by importer`, 'i'),
      }),
    ).toBeVisible();
  });

  test('turning the opt-in off leaves existing importer edges untouched (AS6)', async ({ page, request }) => {
    // A non-declaring run must not retire: with importDeclaredEdges off
    // no asset carries `relationships`, so the edge pass never runs and
    // every previously imported edge persists (field-presence gate).
    test.setTimeout(180_000);
    const api = await apiLogin(request, BASE, 'ADMIN');
    const cfg = await api('GET', `/api/v1/importer-configs/${edgesConfigId}`);
    const scope = cfg.body.config?.scope ?? cfg.body.scope ?? {};
    const patch = await api('PATCH', `/api/v1/importer-configs/${edgesConfigId}`, {
      scope: { ...scope, importDeclaredEdges: false },
    });
    expect(patch.status).toBe(200);
    await scenario('mock-docker-engine', 'sbom');
    await triggerAndWait(api, edgesConfigId);

    await loginPage(page, 'VIEWER');
    await page.goto(`/components/${EXPRESS_SLUG}?tab=relationships`);
    await expect(
      page.getByRole('button', {
        name: new RegExp(`${WORKLOAD}, depends on express.*Added by importer`, 'i'),
      }),
    ).toBeVisible({ timeout: 30_000 });
  });
});
