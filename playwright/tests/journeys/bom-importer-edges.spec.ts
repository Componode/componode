import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { apiLogin, loginPage, type ApiCall } from '../fixtures/auth.js';

const BASE = 'https://app.componode-pw.test';
const LIB_SLUG = 'pkg-npm-pw-edge-lib';
const LIB2_SLUG = 'pkg-npm-pw-edge-lib2';

interface SeedResult {
  githubConfigId: string;
}

function seed(): SeedResult {
  return JSON.parse(readFileSync('/pw-private/out/seed-result.json', 'utf8'));
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
 * Spec 076 — importer-native declared edges (Phase 3, ADR-133). The seeded
 * GitHub config is patched to opt in (`includeDependencyGraph` +
 * `importDeclaredEdges`); the mock serves an SPDX dependency graph for
 * svc-alpha so the completed run materializes svc-alpha → pw-edge-lib,
 * svc-alpha → pw-edge-lib2, and pw-edge-lib → pw-edge-dep IMPORTER edges
 * plus importer-native LIBRARY components. Suppressions are durable, so
 * each Playwright project hides its own pair (desktop → lib, narrow → lib2).
 */
test.describe('bom importer edges', () => {
  test.beforeAll(async ({ request }) => {
    // Importer config writes are ADMIN-only; edge hiding stays EDITOR.
    const api = await apiLogin(request, BASE, 'ADMIN');
    const configId = seed().githubConfigId;
    const cfg = await api('GET', `/api/v1/importer-configs/${configId}`);
    const scope = cfg.body.config?.scope ?? cfg.body.scope ?? {};
    const patch = await api('PATCH', `/api/v1/importer-configs/${configId}`, {
      scope: { ...scope, includeDependencyGraph: true, importDeclaredEdges: true },
    });
    expect(patch.status).toBe(200);
    await triggerAndWait(api, configId);

    // Wait until the edge pass has written both edges — the pass runs
    // after the terminal COMPLETED write.
    const deadline = Date.now() + 30_000;
    let lib: any = null;
    let lib2: any = null;
    while (Date.now() < deadline) {
      lib = lib ?? (await findComponent(api, 'pw-edge-lib', LIB_SLUG));
      lib2 = lib2 ?? (await findComponent(api, 'pw-edge-lib2', LIB2_SLUG));
      if (lib && lib2) break;
      await new Promise((r) => setTimeout(r, 1500));
    }
    expect(lib, `importer-native library ${LIB_SLUG}`).toBeTruthy();
    expect(lib2, `importer-native library ${LIB2_SLUG}`).toBeTruthy();
  });

  test('opt-in switch renders the review-bypass copy in the importer form', async ({ page }) => {
    await loginPage(page, 'ADMIN');
    await page.goto('/importers/new');
    await page.locator('#i-provider').click();
    await page.getByRole('option', { name: 'GitHub' }).click();
    await expect(page.getByText('Import declared edges')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/added to the catalog without review/)).toBeVisible();
  });

  test('viewer sees Added-by-importer markers, provenance badge, and Source/run links', async ({ page }, testInfo) => {
    const slug = testInfo.project.name === 'chromium-narrow' ? LIB2_SLUG : LIB_SLUG;
    await loginPage(page, 'VIEWER');
    await page.goto(`/components/${slug}?tab=relationships`);

    const row = page.getByRole('button', { name: /svc-alpha.*Added by importer/i });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.click();

    await expect(page.getByTestId('edge-provenance-importer')).toBeVisible();
    // exact — the sidebar carries an "Importer sources" nav link.
    await expect(page.getByRole('link', { name: 'Source', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Import run', exact: true })).toBeVisible();
    // Viewers see provenance but can never hide an edge.
    await expect(page.getByTestId('hide-edge')).not.toBeVisible();
  });

  test('flag-off hides every provenance surface', async ({ page }, testInfo) => {
    const slug = testInfo.project.name === 'chromium-narrow' ? LIB2_SLUG : LIB_SLUG;
    await page.goto('/');
    await page.evaluate(() => {
      window.localStorage.setItem('componode.flag.bomImporterEdges', 'false');
    });
    await loginPage(page, 'VIEWER');
    await page.goto(`/components/${slug}?tab=relationships`);
    const row = page.getByRole('button', { name: /svc-alpha.*depends on/i });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(row).not.toContainText('Added by importer');
    await row.click();
    await expect(page.getByTestId('edge-provenance-importer')).not.toBeVisible();
    await expect(page.getByTestId('hide-edge')).not.toBeVisible();
  });

  test('editor hides an importer edge and it is not recreated by the next run', async ({ page, request }, testInfo) => {
    // One durable suppression per project: desktop hides svc-alpha→pw-edge-lib,
    // narrow hides svc-alpha→pw-edge-lib2 — the pairs never collide.
    const slug = testInfo.project.name === 'chromium-narrow' ? LIB2_SLUG : LIB_SLUG;
    const api = await apiLogin(request, BASE, 'EDITOR');
    await loginPage(page, 'EDITOR');
    await page.goto(`/components/${slug}?tab=relationships`);

    const row = page.getByRole('button', { name: /svc-alpha.*Added by importer/i });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.click();
    await page.getByTestId('hide-edge').click();
    await expect(page.getByText(/won't be recreated by future imports/i)).toBeVisible();
    await page.getByTestId('hide-edge-confirm').click();
    await expect(page.getByText('Edge hidden')).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByRole('button', { name: /svc-alpha.*depends on/i }),
    ).not.toBeVisible();

    // Re-run — the suppressed pair must stay suppressed.
    await triggerAndWait(api, seed().githubConfigId);
    await page.reload();
    await expect(
      page.getByRole('button', { name: /svc-alpha.*Added by importer/i }),
    ).not.toBeVisible({ timeout: 30_000 });
  });
});
