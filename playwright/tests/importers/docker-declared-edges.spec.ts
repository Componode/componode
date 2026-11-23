import { test, expect } from '@playwright/test';
import { apiLogin, loginPage, type ApiCall } from '../fixtures/auth.js';

const BASE = 'https://app.componode-pw.test';
const CTL = 'http://mock-control:9090';
// Dedicated target — same engine endpoint (source identity is
// `docker-engine:{/info.ID}`, shared with sibling specs), but its own
// importer config so this spec's opted-in runs are the only edge-
// declaring runs and helper queries stay unambiguous.
const TARGET_ID = 'pw-engine-sbom';
const CONFIG_LABEL = 'pw-docker-edges';
const WORKLOAD = 'pw-web';
const EXPRESS_SLUG = 'pkg-npm-express';
const ACCEPTS_SLUG = 'pkg-npm-accepts';
const PW_LIB_SLUG = 'pkg-npm-pw-lib';
const HIDE_SLUG = (project: string) =>
  project === 'chromium-narrow' ? 'pkg-npm-pw-hide-narrow' : 'pkg-npm-pw-hide-desktop';
const HIDE_NAME = (project: string) =>
  project === 'chromium-narrow' ? 'pw-hide-narrow' : 'pw-hide-desktop';

async function scenario(name: string) {
  await fetch(`${CTL}/scenario/mock-docker-engine`, { method: 'POST', body: JSON.stringify({ name }) });
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

async function dockerCredentialId(api: ApiCall): Promise<string> {
  const res = await api('GET', '/api/v1/credentials');
  const items = res.body.data ?? res.body.credentials ?? res.body.items ?? [];
  const cred = items.find((c: any) => String(c.label ?? '').startsWith('pw-docker-'));
  if (!cred) throw new Error('no pw-docker credential seeded');
  return cred.id;
}

/**
 * Spec 078 — docker as the third declared-edge carrier (ADR-133). The
 * `sbom` mock scenario gives the nginx image a RepoDigest at the mock's
 * plain-TLS registry listener, which serves a CycloneDX attestation whose
 * dependencies[] graph declares subject → package, package → package, and
 * package → subject edges. The spec's own docker config (dedicated target,
 * `includeSbom` + `importDeclaredEdges`) materializes IMPORTER edges: the
 * pw-web workload and the docker-image component each depend on the
 * document's packages, express → accepts is a library edge, and
 * pw-lib → docker-image closes package → subject.
 */
test.describe('docker declared edges', () => {
  let edgesConfigId = '';

  test.beforeAll(async ({ request }, testInfo) => {
    // Importer config + docker-target writes are ADMIN-only.
    const api = await apiLogin(request, BASE, 'ADMIN');
    const credId = await dockerCredentialId(api);

    // Reuse the spec's dedicated target across projects.
    const targets = await api('GET', '/api/v1/docker-targets');
    const targetList = targets.body.data ?? targets.body.targets ?? targets.body.items ?? [];
    if (!targetList.find((t: any) => t.targetId === TARGET_ID)) {
      const created = await api('POST', '/api/v1/docker-targets', {
        targetId: TARGET_ID,
        label: 'PW SBOM Engine',
        profile: {
          transport: 'tcp', host: 'mock-docker-engine', port: 2376,
          caCertKey: 'caCert', clientCertKey: 'clientCert', clientKeyKey: 'clientKey',
        },
      });
      expect(created.status).toBeLessThan(300);
    }

    const list = await api('GET', '/api/v1/importer-configs');
    const configs = list.body.data ?? list.body.configs ?? list.body.items ?? [];
    let configId: string | undefined = configs.find(
      (c: any) => c.label === `${CONFIG_LABEL}-${testInfo.project.name}`,
    )?.id;
    const wantedScope = {
      targetId: TARGET_ID,
      includeImages: true,
      includeSbom: true,
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
        importerName: 'docker',
        label: `${CONFIG_LABEL}-${testInfo.project.name}`,
        scope: wantedScope,
        credentialIds: [credId],
        enabled: true,
      });
      expect(created.status).toBeLessThan(300);
      configId = created.body.id ?? created.body.config?.id ?? created.body.importerConfig?.id;
    }
    if (!configId) throw new Error('docker edges config missing after create');
    edgesConfigId = configId;

    await scenario('sbom');
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
    await scenario('baseline');
  });

  test('opt-in switch renders the review-bypass copy and persists through the form', async ({ page, request }, testInfo) => {
    // The refine rejects importDeclaredEdges without includeSbom at the
    // API boundary before the browser assertions.
    const api = await apiLogin(request, BASE, 'ADMIN');
    const rejected = await api('POST', '/api/v1/importer-configs', {
      importerName: 'docker',
      label: `pw-docker-edges-invalid-${testInfo.project.name}`,
      scope: { targetId: TARGET_ID, includeSbom: false, importDeclaredEdges: true },
      enabled: false,
    });
    expect(rejected.status).toBe(400);

    await loginPage(page, 'ADMIN');
    await page.goto('/importers/new');
    await page.locator('#i-provider').click();
    await page.getByRole('option', { name: 'Docker' }).click();
    await page.locator('#i-target').click();
    await page.getByRole('option', { name: /PW SBOM Engine/ }).click();

    // includeSbom precedes importDeclaredEdges — the dependent switch is
    // meaningless without the SBOM fetch it gates.
    await expect(page.getByText('Import declared edges')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/added to the catalog without review/)).toBeVisible();

    const label = `pw-docker-edges-ui-${testInfo.project.name}`;
    await page.locator('#i-label').fill(label);
    await page.locator('#i-scope-includeSbom').click();
    await page.locator('#i-scope-importDeclaredEdges').click();
    // The mTLS target profile requires caCert/clientCert/clientKey at save —
    // link the seeded pw-docker credential or create is rejected.
    await page.locator('#i-cred').click();
    await page.getByRole('option', { name: /pw-docker-/ }).click();
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
    expect(createdScope?.includeSbom).toBe(true);
    expect(createdScope?.importDeclaredEdges).toBe(true);
  });

  test('viewer sees subject → package edges with provenance on the library', async ({ page }) => {
    await loginPage(page, 'VIEWER');
    // Both carriers — the pw-web workload and the docker-image component —
    // render as dependedOnBy rows on the library's page.
    await page.goto(`/components/${EXPRESS_SLUG}?tab=relationships`);

    const workloadRow = page.getByRole('button', {
      name: new RegExp(`^${WORKLOAD}, depends on express.*Added by importer`, 'i'),
    });
    await expect(workloadRow).toBeVisible({ timeout: 30_000 });
    const imageRow = page.getByRole('button', {
      name: /pw-web@sha256:[a-f]+, depends on express.*Added by importer/i,
    });
    await expect(imageRow).toBeVisible();

    await workloadRow.click();
    await expect(page.getByTestId('edge-provenance-importer')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Source', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Import run', exact: true })).toBeVisible();
    await expect(page.getByTestId('hide-edge')).not.toBeVisible();
  });

  test('package edges render: library → library and library → image', async ({ page }) => {
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

    // pw-lib → root resolves to the docker-image component — a
    // package → subject edge rendered on pw-lib's outgoing depends-on
    // lane ("pw-lib → targets").
    await page.goto(`/components/${PW_LIB_SLUG}?tab=relationships`);
    await expect(
      page.getByRole('button', {
        name: /pw-web@sha256:[a-f]+, depended on by pw-lib.*Added by importer/i,
      }),
    ).toBeVisible({ timeout: 30_000 });
  });

  test('editor hides an importer edge and it is not recreated by the next run', async ({ page, request }, testInfo) => {
    // Two full re-runs inside the test — double the default timeout.
    test.setTimeout(180_000);
    // One durable suppression per project: desktop hides pw-web →
    // pw-hide-desktop, narrow hides pw-web → pw-hide-narrow. The
    // `^pw-web ` anchor excludes the docker-image carrier's row for the
    // same pair (image names start with the registry host).
    const slug = HIDE_SLUG(testInfo.project.name);
    const name = HIDE_NAME(testInfo.project.name);
    const api = await apiLogin(request, BASE, 'EDITOR');
    await loginPage(page, 'EDITOR');
    await page.goto(`/components/${slug}?tab=relationships`);

    const row = page.getByRole('button', {
      name: new RegExp(`^${WORKLOAD}, depends on ${name}.*Added by importer`, 'i'),
    });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.click();
    await page.getByTestId('hide-edge').click();
    await expect(page.getByText(/won't be recreated by future imports/i)).toBeVisible();
    await page.getByTestId('hide-edge-confirm').click();
    await expect(page.getByText('Edge hidden')).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByRole('button', { name: new RegExp(`^${WORKLOAD}, depends on`, 'i') }),
    ).not.toBeVisible();

    // Re-run twice — the suppressed pair stays hidden while the other
    // edges re-materialize with zero duplicates.
    await scenario('sbom');
    await triggerAndWait(api, edgesConfigId);
    await scenario('sbom');
    await triggerAndWait(api, edgesConfigId);
    await page.reload();
    await expect(
      page.getByRole('button', { name: new RegExp(`^${WORKLOAD}, depends on`, 'i') }),
    ).not.toBeVisible({ timeout: 30_000 });
    await page.goto(`/components/${EXPRESS_SLUG}?tab=relationships`);
    await expect(
      page.getByRole('button', {
        name: new RegExp(`^${WORKLOAD}, depends on express.*Added by importer`, 'i'),
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
    await page.getByRole('option', { name: 'Docker' }).click();
    await page.locator('#i-target').click();
    await page.getByRole('option', { name: /PW SBOM Engine/ }).click();
    await expect(page.locator('#i-scope-includeSbom')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Import declared edges')).not.toBeVisible();

    await loginPage(page, 'VIEWER');
    await page.goto(`/components/${EXPRESS_SLUG}?tab=relationships`);
    const row = page.getByRole('button', { name: new RegExp(`^${WORKLOAD}, depends on express`, 'i') });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(row).not.toContainText('Added by importer');
    await row.click();
    await expect(page.getByTestId('edge-provenance-importer')).not.toBeVisible();
    await expect(page.getByTestId('hide-edge')).not.toBeVisible();
  });

  test('a dependency removed from the SBOM retires exactly that edge (T015)', async ({ page, request }) => {
    // One re-run on the reduced graph — the `sbom-reduced` scenario drops
    // only express → accepts, so that pair alone retires while the
    // subject edges and every other package edge persist (US2 / SC-002).
    test.setTimeout(180_000);
    const api = await apiLogin(request, BASE, 'ADMIN');
    await scenario('sbom-reduced');
    await triggerAndWait(api, edgesConfigId);
    await scenario('sbom'); // restore for the next project's beforeAll

    await loginPage(page, 'VIEWER');
    await page.goto(`/components/${EXPRESS_SLUG}?tab=relationships`);
    // express → accepts retired: no outgoing library lane remains.
    await expect(
      page.getByTestId('libraries-summary-dependsOn'),
    ).not.toBeVisible({ timeout: 30_000 });
    // subject → express persists on both carriers.
    await expect(
      page.getByRole('button', {
        name: new RegExp(`^${WORKLOAD}, depends on express.*Added by importer`, 'i'),
      }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', {
        name: /pw-web@sha256:[a-f]+, depends on express.*Added by importer/i,
      }),
    ).toBeVisible();
    // pw-lib → image survives too.
    await page.goto(`/components/${PW_LIB_SLUG}?tab=relationships`);
    await expect(
      page.getByRole('button', {
        name: /pw-web@sha256:[a-f]+, depended on by pw-lib.*Added by importer/i,
      }),
    ).toBeVisible();
  });

  test('turning the opt-in off leaves existing importer edges untouched (AS6)', async ({ page, request }, testInfo) => {
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
    await scenario('sbom');
    await triggerAndWait(api, edgesConfigId);

    await loginPage(page, 'VIEWER');
    await page.goto(`/components/${EXPRESS_SLUG}?tab=relationships`);
    await expect(
      page.getByRole('button', {
        name: new RegExp(`^${WORKLOAD}, depends on express.*Added by importer`, 'i'),
      }),
    ).toBeVisible({ timeout: 30_000 });
    await page.goto(`/components/${PW_LIB_SLUG}?tab=relationships`);
    await expect(
      page.getByRole('button', {
        name: /pw-web@sha256:[a-f]+, depended on by pw-lib.*Added by importer/i,
      }),
    ).toBeVisible();
  });
});
