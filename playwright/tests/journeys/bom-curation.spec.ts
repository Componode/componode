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
 * Spec 075 — BOM catalog curation (Phase 2). Setup uses the seeded shared
 * package `pw-shared-lib` plus the sbom-file import; each test drives the
 * curation API for its own arrangement and asserts the UI surfaces:
 * preview → add/link outcomes, the dependency suggestion segment, the
 * Show-libraries toggle, and Viewer-hidden write surfaces.
 */
test.describe('bom catalog curation', () => {
  test.beforeAll(async ({ request }) => {
    const api = await apiLogin(request, BASE, 'EDITOR');
    const status = await triggerAndWait(api, seed().sbomConfigId);
    expect(status).toBe('COMPLETED');
  });

  test('preview → link-all wires edges and the package shows Linked @smoke', async ({ page, request }) => {
    const api = await apiLogin(request, BASE, 'EDITOR');
    const purl = 'pkg:npm/pw-shared-lib';
    const prev = await api(
      'GET',
      `/api/v1/packages/add-to-catalog/preview?purl=${encodeURIComponent(purl)}`,
    );
    expect(prev.status).toBe(200);
    expect(prev.body.identity).toBe(purl);
    expect(prev.body.consumerCount).toBeGreaterThan(0);

    // The package may already be cataloged by another test — link-all is
    // idempotent-friendly only via the link endpoint, so use add when the
    // identity is free, link to the match otherwise.
    const res = prev.body.existingComponent
      ? await api('POST', '/api/v1/packages/link', {
          purl,
          componentId: prev.body.existingComponent.id,
          linkConsumers: true,
        })
      : await api('POST', '/api/v1/packages/add-to-catalog', { purl, linkConsumers: true });
    expect(res.status).toBe(200);
    const componentName: string = res.body.component.name;
    expect(componentName).toBeTruthy();

    await loginPage(page, 'VIEWER');
    await page.goto('/packages?q=pw-shared');
    const row = page.getByTestId('package-row-pkg:npm/pw-shared-lib');
    await expect(row).toBeVisible({ timeout: 30_000 });
    // The In-catalog cell links the curated component by name.
    await expect(row).toContainText(componentName);
  });

  test('add-only stages suggestions visible in the dependency segment', async ({ page, request }) => {
    const api = await apiLogin(request, BASE, 'EDITOR');
    // A package with no curated component yet — seeded stale-BOM identities
    // first, keeping pw-shared-lib for the link-all test.
    const candidates = [
      'pkg:npm/pw-stale-dev',
      'pkg:npm/pw-stale-trans',
      'pkg:npm/pw-stale-lib',
      'pkg:npm/pw-shared-lib',
    ];
    let purl = '';
    for (const c of candidates) {
      const prev = await api(
        'GET',
        `/api/v1/packages/add-to-catalog/preview?purl=${encodeURIComponent(c)}`,
      );
      if (prev.status === 200 && !prev.body.existingComponent) {
        purl = c;
        break;
      }
    }
    test.skip(!purl, 'no unmatched package identity available in seed');

    const res = await api('POST', '/api/v1/packages/add-to-catalog', {
      purl,
      linkConsumers: false,
    });
    expect(res.status).toBe(200);
    expect(res.body.suggestionsStaged).toBeGreaterThan(0);

    await loginPage(page, 'EDITOR');
    await page.goto('/suggestions?kind=dependency');
    await expect(
      page.getByText(/is used by \d+ components?/).first(),
    ).toBeVisible({ timeout: 30_000 });
    // Exact-match groups offer bulk accept; the group for our package does.
    await expect(page.getByRole('button', { name: /Accept all/i }).first()).toBeVisible();
  });

  test('bulk accept wires edges; decided rows never resurface', async ({ page, request }) => {
    const api = await apiLogin(request, BASE, 'EDITOR');
    const groups = await api('GET', '/api/v1/suggestions/dependencies/groups');
    const group = (groups.body.data ?? []).find(
      (g: { bulkAcceptable: boolean }) => g.bulkAcceptable,
    );
    test.skip(!group, 'no exact-only pending group to bulk-accept');

    const res = await api('POST', '/api/v1/suggestions/dependencies/bulk', {
      childComponentId: group.childComponent.id,
      action: 'accept',
    });
    expect(res.status).toBe(200);
    expect(res.body.decided).toBeGreaterThan(0);
    expect(res.body.edges).toBeGreaterThan(0);

    // The group is gone from pending after the decision.
    const after = await api('GET', '/api/v1/suggestions/dependencies/groups');
    expect(
      (after.body.data ?? []).some(
        (g: { childComponent: { id: string } }) => g.childComponent.id === group.childComponent.id,
      ),
    ).toBe(false);
  });

  test('components list hides libraries behind the toggle', async ({ page, request }) => {
    const api = await apiLogin(request, BASE, 'EDITOR');
    // Create a LIBRARY-category component so the toggle has something to
    // reveal (createComponentSchema has no externalId — identity isn't the
    // subject of this check).
    const res = await api('POST', '/api/v1/components', {
      name: 'PW Toggle Lib',
      slug: `pw-toggle-lib-${Date.now()}`,
      category: 'LIBRARY',
      provider: 'NPM',
      resourceType: 'npm:package',
    });
    expect([200, 201]).toContain(res.status);
    await loginPage(page, 'VIEWER');
    await page.goto('/components?libraries=1&q=PW%20Toggle%20Lib');
    // Retries/projects each seed a library — assert at least one renders.
    await expect(
      page.getByRole('link', { name: 'PW Toggle Lib' }).first(),
    ).toBeVisible({ timeout: 30_000 });
  });

  test('row menu opens the curation dialog; stage-only keeps edges human-decided', async ({ page, request }) => {
    const api = await apiLogin(request, BASE, 'EDITOR');
    // Pick an unmatched identity the earlier tests left behind.
    const candidates = [
      'pkg:npm/pw-stale-dev',
      'pkg:npm/pw-stale-trans',
      'pkg:npm/pw-stale-lib',
      'pkg:npm/pw-shared-lib',
    ];
    let purl = '';
    for (const c of candidates) {
      const prev = await api(
        'GET',
        `/api/v1/packages/add-to-catalog/preview?purl=${encodeURIComponent(c)}`,
      );
      if (prev.status === 200 && !prev.body.existingComponent) {
        purl = c;
        break;
      }
    }
    test.skip(!purl, 'no unmatched package identity available in seed');
    const pkgName = purl.split('/').pop()!;

    await loginPage(page, 'EDITOR');
    // The unmatched identities live on the seeded stale-BOM component.
    await page.goto(
      `/components/${seed().bomStaleSlug}?tab=bom&q=${encodeURIComponent(pkgName)}`,
    );
    const menuBtn = page
      .getByRole('button', { name: `Actions for ${pkgName}` })
      .first();
    await expect(menuBtn).toBeVisible({ timeout: 30_000 });
    await menuBtn.click();
    await page.getByRole('menuitem', { name: /Add to catalog/i }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 30_000 });
    // "Only add to catalog" = stage-only — no edges are wired silently.
    await dialog.locator('#bom-curation-stage').click();
    await dialog.getByTestId('bom-curation-submit').click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });
    // The row reports Suggested — the human decision is still open.
    await expect(
      page.getByRole('link', { name: 'Suggested' }).first(),
    ).toBeVisible({ timeout: 30_000 });
  });

  test('library detail shows the package surface and library counts', async ({ page, request }) => {
    const api = await apiLogin(request, BASE, 'EDITOR');
    const purl = 'pkg:npm/pw-shared-lib';
    const prev = await api(
      'GET',
      `/api/v1/packages/add-to-catalog/preview?purl=${encodeURIComponent(purl)}`,
    );
    let slug: string | undefined = prev.body?.existingComponent?.slug;
    if (!slug) {
      const res = await api('POST', '/api/v1/packages/add-to-catalog', {
        purl,
        linkConsumers: false,
      });
      expect(res.status).toBe(200);
      slug = res.body.component.slug;
    }
    test.skip(!slug, 'no library component available');

    await loginPage(page, 'EDITOR');
    await page.goto(`/components/${slug}`);
    // The Library section replaces Instances; "Used by" lists consumers.
    await expect(page.getByText(/Used by/)).toBeVisible({ timeout: 30_000 });

    // The consumer's Relationships tab surfaces the bounded library lane.
    await page.goto(`/components/${seed().bomSlug}?tab=relationships`);
    await expect(
      page.getByTestId('libraries-summary-dependsOn'),
    ).toBeVisible({ timeout: 30_000 });
  });

  test('Viewer sees no curation write surfaces', async ({ page }) => {
    await loginPage(page, 'VIEWER');
    await page.goto(`/components/${seed().bomSlug}?tab=bom`);
    // Open a row menu first — the item can only be asserted absent once
    // the dropdown actually renders.
    const menuBtn = page.getByRole('button', { name: /Actions for / }).first();
    await expect(menuBtn).toBeVisible({ timeout: 30_000 });
    await menuBtn.click();
    await expect(page.getByRole('menu')).toBeVisible();
    await expect(
      page.getByRole('menuitem', { name: /Copy purl/i }),
    ).toBeVisible();
    await expect(
      page.getByRole('menuitem', { name: /Add to catalog/i }),
    ).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.goto('/suggestions?kind=dependency');
    await expect(page.getByRole('button', { name: /Accept all/i })).toHaveCount(0);
  });
});
