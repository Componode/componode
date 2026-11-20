import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { apiLogin, loginPage, secrets, type ApiCall } from '../fixtures/auth.js';

const BASE = 'https://app.componode-pw.test';

interface SeedResult {
  bomSlug: string;
  bomStaleSlug: string;
  sbomConfigId: string;
  probeComponentId: string;
}

function seed(): SeedResult {
  return JSON.parse(readFileSync('/pw-private/out/seed-result.json', 'utf8'));
}

async function triggerAndWait(api: ApiCall, configId: string): Promise<{ status: string; runId: string }> {
  const trig = await api('POST', `/api/v1/importer-configs/${configId}/trigger`, {});
  if (trig.status >= 400) throw new Error(`trigger failed ${trig.status}: ${JSON.stringify(trig.body)}`);
  const runId: string = trig.body.runId ?? trig.body.id;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const run = await api('GET', `/api/v1/importer-configs/${configId}/runs/${runId}`);
    const status = run.body.status ?? run.body.run?.status;
    if (status && !['PENDING', 'RUNNING'].includes(status)) return { status, runId };
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error('run timeout');
}

test.describe('component bill of materials', () => {
  // One real sbom-file run populates PW BOM Target; every UI assertion
  // below reads its output. Run once for the whole file.
  test.beforeAll(async ({ request }) => {
    const api = await apiLogin(request, BASE, 'EDITOR');
    const { status } = await triggerAndWait(api, seed().sbomConfigId);
    expect(status).toBe('COMPLETED');
  });

  test('Packages tab lists inventory and the tab state round-trips the URL @smoke', async ({ page }) => {
    const { bomSlug } = seed();
    await loginPage(page, 'VIEWER');
    await page.goto(`/components/${bomSlug}`);

    await page.getByRole('tab', { name: /Packages/ }).click();
    await expect(page).toHaveURL(/tab=bom/);
    await expect(page.getByText('express', { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('lodash', { exact: true })).toBeVisible();
    await expect(page.getByText('golang.org/x/sys', { exact: true })).toBeVisible();

    // Direct navigation to ?tab=bom renders the same selected state.
    await page.goto(`/components/${bomSlug}?tab=bom`);
    await expect(page.getByRole('tab', { name: /Packages/ })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByText('express', { exact: true })).toBeVisible();
  });

  test('tree view nests child entries under their parent', async ({ page }) => {
    const { bomSlug } = seed();
    await loginPage(page, 'VIEWER');
    await page.goto(`/components/${bomSlug}?tab=bom&view=tree`);

    const grid = page.getByRole('treegrid', { name: 'Bill of materials' });
    await expect(grid).toBeVisible({ timeout: 30_000 });

    // Sorted by name, express is the only expandable top-level row —
    // expanding reveals the nested `accepts` child from the CDX document.
    const expressRow = grid.getByRole('row').filter({ hasText: 'express' });
    await expressRow.getByRole('button', { name: /Expand row/ }).click();
    await expect(grid.getByRole('row').filter({ hasText: 'accepts' })).toHaveAttribute('aria-level', '2');

    // The view toggle round-trips through the URL in both directions.
    await page.getByRole('radio', { name: 'Flat view' }).click();
    await expect(page).not.toHaveURL(/view=tree/);
    await page.getByRole('radio', { name: 'Tree view' }).click();
    await expect(page).toHaveURL(/view=tree/);
    await expect(grid).toBeVisible();
  });

  test('export menu offers the three formats with the lossiness notice', async ({ page }) => {
    const { bomSlug } = seed();
    await loginPage(page, 'VIEWER');
    await page.goto(`/components/${bomSlug}?tab=bom`);

    await page.getByRole('button', { name: 'Export' }).click({ timeout: 30_000 });
    const menu = page.getByRole('menu');
    await expect(menu.getByText(/can't express Build, Dev and Test scopes/)).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: /Componode JSON/ })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: /CycloneDX 1\.5/ })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: /SPDX 2\.3/ })).toBeVisible();

    await menu.getByRole('menuitem', { name: /CycloneDX 1\.5/ }).click();
    await expect(page.getByRole('status')).toHaveText(/Downloaded .+-bom\.cdx\.json/, { timeout: 15_000 });
  });

  test('stale multi-source inventory warns and attributes each source', async ({ page }) => {
    const { bomStaleSlug } = seed();
    await loginPage(page, 'VIEWER');
    await page.goto(`/components/${bomStaleSlug}?tab=bom`);

    // Stale: the "Last reported" control carries the stale explanation.
    const staleControl = page
      .locator('dt', { hasText: 'Last reported' })
      .locator('xpath=following-sibling::dd')
      .getByRole('button');
    await expect(staleControl).toHaveAttribute('title', /No import run has reported this inventory since/, { timeout: 30_000 });

    // Two sources → the popover lists each with its own timestamp.
    await staleControl.click();
    await expect(page.getByRole('link', { name: 'PW Stale Source A' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'PW Stale Source B' })).toBeVisible();

    // Per-row provenance rides in the package cell's hover text.
    await expect(page.getByTitle(/Reported by PW Stale Source A/).first()).toBeAttached();
  });

  test('components without inventory render the empty state', async ({ page }) => {
    // /components/:slug is slug-routed — the probe component's slug carries
    // the per-run id from the workload secrets.
    const probeSlug = `pw-probe-${secrets().PWP_RUN_ID}`;
    await loginPage(page, 'VIEWER');
    await page.goto(`/components/${probeSlug}?tab=bom`);
    await expect(page.getByText('No bill of materials reported')).toBeVisible({ timeout: 30_000 });
  });

  test('run detail shows the Packages tile with BOM counters', async ({ page, request }) => {
    const { sbomConfigId } = seed();
    const api = await apiLogin(request, BASE, 'EDITOR');
    const { status, runId } = await triggerAndWait(api, sbomConfigId);
    expect(status).toBe('COMPLETED');

    await loginPage(page, 'VIEWER');
    await page.goto(`/importers/${sbomConfigId}/runs/${runId}`);
    await expect(page.getByText('Bill-of-materials entries this run reported.')).toBeVisible({ timeout: 30_000 });
  });

  test('components list BOM filter narrows by inventory presence', async ({ page }) => {
    await loginPage(page, 'VIEWER');

    await page.goto('/components?bom=has&q=PW%20BOM');
    await expect(page.getByRole('link', { name: 'PW BOM Target' })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('link', { name: 'PW BOM Stale' })).toBeVisible();

    await page.goto('/components?bom=none&q=PW%20BOM');
    await expect(page.getByRole('link', { name: 'PW BOM Target' })).not.toBeVisible();
    await expect(page.getByRole('link', { name: 'PW BOM Stale' })).not.toBeVisible();
  });

  test('importer form exposes the BOM collection fields', async ({ page }) => {
    await loginPage(page, 'ADMIN');
    await page.goto('/importers/new');

    const pickImporter = async (label: string) => {
      await page.locator('#i-provider').click();
      await page.getByRole('option', { name: label }).click();
    };

    await pickImporter('GitHub');
    await expect(page.getByText('Include dependency graph')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/bill of materials/).first()).toBeVisible();

    await pickImporter('Docker');
    await expect(page.getByText(/SBOM attestations\/referrers/)).toBeVisible();

    await pickImporter('Kubernetes');
    await expect(page.getByText(/SBOM of each container image running in pods/)).toBeVisible();

    await pickImporter('SBOM File');
    await expect(page.getByText(/HTTPS URL of a CycloneDX JSON or SPDX JSON document/)).toBeVisible();
    await expect(page.getByText(/Slug of the catalog component this SBOM describes/)).toBeVisible();
  });
});
