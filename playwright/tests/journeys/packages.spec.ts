import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { apiLogin, loginPage, type ApiCall } from '../fixtures/auth.js';

const BASE = 'https://app.componode-pw.test';

interface SeedResult {
  bomSlug: string;
  bomStaleSlug: string;
  sbomConfigId: string;
}

function seed(): SeedResult {
  return JSON.parse(readFileSync('/pw-private/out/seed-result.json', 'utf8'));
}

async function triggerAndWait(api: ApiCall, configId: string) {
  const trig = await api('POST', `/api/v1/importer-configs/${configId}/trigger`, {});
  if (trig.status >= 400) throw new Error(`trigger failed ${trig.status}`);
  const runId: string = trig.body.runId ?? trig.body.id;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const run = await api('GET', `/api/v1/importer-configs/${configId}/runs/${runId}`);
    const status = run.body.status ?? run.body.run?.status;
    if (status && !['PENDING', 'RUNNING'].includes(status)) return status;
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error('run timeout');
}

/**
 * Spec 074 — packages explorer. The seed gives a shared package
 * (`pw-shared-lib` at 2.0.0 on the stale component, 1.9.0 on the BOM
 * target) so the rollup merges versions and consumers span components.
 * The sbom-file run adds its CycloneDX packages on top.
 */
test.describe('packages explorer', () => {
  test.beforeAll(async ({ request }) => {
    const api = await apiLogin(request, BASE, 'EDITOR');
    const status = await triggerAndWait(api, seed().sbomConfigId);
    expect(status).toBe('COMPLETED');
  });

  test('rollup groups versions per package and the page is URL-driven @smoke', async ({ page }) => {
    await loginPage(page, 'VIEWER');
    await page.goto('/packages?q=pw-shared');
    const row = page.getByTestId('package-row-pkg:npm/pw-shared-lib');
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(row).toContainText('pw-shared-lib');
    await expect(row).toContainText('pkg:npm/pw-shared-lib');
    await expect(row.getByTestId('version-chip-2.0.0')).toBeVisible();
    await expect(row.getByTestId('version-chip-1.9.0')).toBeVisible();
    // Two components report the package.
    await expect(row.locator('td').nth(4)).toHaveText('2');
  });

  test('purl-prefix search matches the normalized identity', async ({ page }) => {
    await loginPage(page, 'VIEWER');
    await page.goto('/packages?q=pkg:npm');
    await expect(page.getByTestId('package-row-pkg:npm/pw-shared-lib')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('package-row-pkg:npm/pw-stale-lib')).toBeVisible();
  });

  test('ecosystem and scope filters narrow the list via URL params', async ({ page }) => {
    await loginPage(page, 'VIEWER');
    // scope=TRANSITIVE matches only the seeded transitive entry.
    await page.goto('/packages?scope=TRANSITIVE');
    await expect(page.getByTestId('package-row-pkg:npm/pw-stale-trans')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('package-row-pkg:npm/pw-shared-lib')).toHaveCount(0);

    // A nonsense ecosystem filters everything out → no-match state.
    await page.goto('/packages?q=pw-&ecosystem=deb');
    await expect(page.getByText('No packages match')).toBeVisible({ timeout: 30_000 });

    // Pagination params round-trip through the URL into the API call.
    await page.goto('/packages?size=25&page=1&sort=name&order=asc');
    await expect(page.getByTestId('package-row-pkg:npm/pw-shared-lib')).toBeVisible({ timeout: 30_000 });
  });

  test('row expansion lists consumers; version chip filters them', async ({ page }) => {
    const { bomSlug, bomStaleSlug } = seed();
    await loginPage(page, 'VIEWER');
    await page.goto('/packages?q=pw-shared');
    await page.getByTestId('package-row-pkg:npm/pw-shared-lib').click();

    const panel = page.getByTestId('consumers-pkg:npm/pw-shared-lib');
    await expect(panel).toBeVisible({ timeout: 30_000 });
    // Both consuming components appear — each link targets its BOM tab.
    const bomLink = panel.locator(`a[href*="/components/${bomSlug}?tab=bom"]`);
    const staleLink = panel.locator(`a[href*="/components/${bomStaleSlug}?tab=bom"]`);
    await expect(bomLink).toBeVisible();
    await expect(staleLink).toBeVisible();

    // Version chip → ?version= URL filter → single-version consumers.
    await page.getByTestId('version-chip-1.9.0').click();
    await expect(page).toHaveURL(/version=1\.9\.0/);
    await expect(panel.getByTestId('consumers-version-filter')).toBeVisible();
    await expect(bomLink).toBeVisible();
    await expect(staleLink).toHaveCount(0);
  });

  test('BOM row menu "See where it\'s used" deep-links into /packages', async ({ page }) => {
    const { bomStaleSlug } = seed();
    await loginPage(page, 'VIEWER');
    await page.goto(`/components/${bomStaleSlug}?tab=bom`);
    await page.getByRole('button', { name: 'Actions for pw-stale-lib' }).click();
    await page.getByRole('menuitem', { name: /See where it/ }).click();
    await expect(page).toHaveURL(/\/packages\?q=pkg/);
    await expect(page.getByTestId('package-row-pkg:npm/pw-stale-lib')).toBeVisible({ timeout: 30_000 });
  });

  test('Ctrl+K shows a Packages result group', async ({ page }) => {
    await loginPage(page, 'VIEWER');
    await page.goto('/');
    // A rendered sidebar button proves React mounted its keydown listener —
    // pressing Ctrl+K before hydration silently drops the shortcut.
    await expect(page.getByRole('button', { name: /Search… ⌘K/ })).toBeVisible({ timeout: 30_000 });
    await page.keyboard.press('Control+k');
    await page.getByPlaceholder(/Search products, components/).fill('pw-shared');
    const group = page.getByRole('dialog').getByText('Packages');
    await expect(group).toBeVisible({ timeout: 15_000 });
    const item = page.getByRole('option', { name: /pw-shared-lib · npm · 2 components/ });
    await expect(item).toBeVisible();
    await item.click();
    await expect(page).toHaveURL(/\/packages\?q=pkg/);
    await expect(page.getByTestId('package-row-pkg:npm/pw-shared-lib')).toBeVisible({ timeout: 30_000 });
  });

  test('no-results and no-inventory empty states are distinct', async ({ page }) => {
    await loginPage(page, 'VIEWER');
    await page.goto('/packages?q=zzz-no-such-package');
    await expect(page.getByText('No packages match')).toBeVisible({ timeout: 30_000 });
    // Clearing back to the unfiltered list shows real rows (inventory exists).
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await expect(page.getByTestId('package-row-pkg:npm/pw-shared-lib')).toBeVisible({ timeout: 30_000 });
  });

  test('nav places Packages under Catalog for every signed-in role', async ({ page }) => {
    await loginPage(page, 'VIEWER');
    await page.goto('/');
    await page.getByRole('link', { name: 'Packages' }).click();
    await expect(page).toHaveURL(/\/packages$/);
    await expect(page.getByRole('heading', { name: 'Packages' })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/does not scan for vulnerabilities/)).toBeVisible();
  });

  test('flag off renders zero explorer surface (FR-018)', async ({ page }) => {
    // Flags are compile-time — the e2e override is read at module load.
    await page.addInitScript(() => {
      window.localStorage.setItem('componode.flag.packagesExplorer', 'false');
    });
    await loginPage(page, 'VIEWER');
    await page.goto('/');
    // Sidebar: no Packages entry under Catalog.
    await expect(page.getByRole('link', { name: 'Packages' })).toHaveCount(0);
    // Route: /packages redirects — no route content appears (SC-005).
    await page.goto('/packages');
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { name: 'Packages' })).toHaveCount(0);
    // Ctrl+K: neither the Navigate entry nor a Packages result group.
    await expect(page.getByRole('button', { name: /Search… ⌘K/ })).toBeVisible({ timeout: 30_000 });
    await page.keyboard.press('Control+k');
    await page.getByPlaceholder(/Search products, components/).fill('PW');
    await expect(page.getByRole('dialog').getByText('Components')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('dialog').getByText('Packages', { exact: true })).toHaveCount(0);
  });
});
