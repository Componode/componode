import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { apiLogin, loginPage, type ApiCall } from '../fixtures/auth.js';

const BASE = 'https://app.componode-pw.test';
const run = `pkgr-${Date.now().toString(36)}`;

interface SeedResult {
  bomSlug: string;
  bomStaleSlug: string;
  edgeSlug: string;
  sbomConfigId: string;
  probeComponentId: string;
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
    const r = await api('GET', `/api/v1/importer-configs/${configId}/runs/${runId}`);
    const status = r.body.status ?? r.body.run?.status;
    if (status && !['PENDING', 'RUNNING'].includes(status)) return status;
    await new Promise((res) => setTimeout(res, 1500));
  }
  throw new Error('run timeout');
}

async function findComponent(api: ApiCall, fragment: string, slug: string) {
  // LIBRARY rows hide behind `libraries=true`; `search` matches names.
  const res = await api(
    'GET',
    `/api/v1/components?search=${encodeURIComponent(fragment)}&libraries=true&pageSize=50`,
  );
  const items = res.body?.data ?? res.body?.components ?? res.body?.items ?? [];
  const found = items.find((c: any) => c.slug === slug || c.name === fragment);
  if (!found)
    throw new Error(
      `component not found: ${slug} (status ${res.status}, hits ${items.map((c: any) => c.slug).join(',')})`,
    );
  return found;
}

interface RollupFixture {
  parentSlug: string;
  childName: string;
  emptySlug: string;
  silentSlug: string;
  libGroupName: string;
}

/**
 * Spec 080 fixture — builds the reachable set around the seeded components:
 *   DIRECT   → pw-edge-* (COMPUTE; gets CycloneDX pkgs from its own
 *              sbom-file run) and pw-bom-stale-* (LIBRARY; stale rows).
 *   GROUP    → pw-pkgr-lib-* (LIBRARY) — linked to pkg:npm/pw-shared-lib so
 *              the shared-lib row carries a declared marker.
 *   INHERITED→ pw-bom-* via the composed child (CycloneDX pkgs + shared-lib
 *              1.9.0) — giving shared-lib version skew + attributed consumers.
 * `empty`/`silent` products drive the two distinct empty states.
 */
let fixture: RollupFixture;

test.describe('product package roll-up', () => {
  test.beforeAll(async ({ request }) => {
    // importer-config creation is Admin-only; the rest are Editor writes.
    const api = await apiLogin(request, BASE, 'ADMIN');
    const s = seed();

    // Inventory on the bom target (LIBRARY) and on the COMPUTE edge target
    // via a dedicated sbom-file config — the non-LIBRARY reporter that keeps
    // the coverage denominator honest.
    await triggerAndWait(api, s.sbomConfigId);
    const edgeCfg = await api('POST', '/api/v1/importer-configs', {
      importerName: 'sbom-file',
      label: `pw-pkgr-sbom-${run}`,
      scope: {
        // Query suffix gives this config its own ImporterSource identity —
        // sharing the seeded URL would let source-scoped reconciliation
        // retire the bom target's membership (spec 077 precedent).
        sbomUrl: 'https://mock-github:9443/sbom/cyclonedx.json?src=pkgr',
        componentSlug: s.edgeSlug,
      },
      enabled: true,
    });
    expect(edgeCfg.status).toBe(201);
    const edgeCfgId = edgeCfg.body.id ?? edgeCfg.body.config?.id;
    await expect(async () => {
      const st = await triggerAndWait(api, edgeCfgId);
      expect(st).toBe('COMPLETED');
    }).toPass({ timeout: 70_000 });

    const edgeComp = await findComponent(api, 'PW Edge Target', s.edgeSlug);
    const staleComp = await findComponent(api, 'PW BOM Stale', s.bomStaleSlug);
    const bomComp = await findComponent(api, 'pw-bom', s.bomSlug);

    // Declared library: link the shared package onto a new LIBRARY component.
    const lib = await api('POST', '/api/v1/components', {
      name: `PW PkgRoll Lib ${run}`,
      slug: `pw-pkgr-lib-${run}`,
      category: 'LIBRARY',
      provider: 'OTHER',
      resourceType: 'pw-pkgr-lib',
    });
    expect(lib.status).toBe(201);
    const libId = lib.body.component?.id ?? lib.body.id;
    const link = await api('POST', '/api/v1/packages/link', {
      purl: 'pkg:npm/pw-shared-lib',
      componentId: libId,
      linkConsumers: false,
    });
    expect(link.status).toBe(200);

    const libGroupName = `PW PkgRoll Grp ${run}`;
    const grp = await api('POST', '/api/v1/component-groups', {
      name: libGroupName,
      slug: `pw-pkgr-grp-${run}`,
    });
    expect(grp.status).toBe(201);
    const groupId = grp.body.group?.id ?? grp.body.id;
    const assign = await api('PATCH', `/api/v1/components/${libId}`, {
      componentGroupIds: [groupId],
    });
    expect(assign.status).toBe(200);

    const mkProduct = async (name: string, slug: string) => {
      const res = await api('POST', '/api/v1/products', {
        name,
        slug,
        type: 'BUSINESS_CAPABILITY',
      });
      expect(res.status).toBe(201);
      return res.body.product?.id ?? res.body.id;
    };
    const parentSlug = `pw-pkgr-${run}`;
    const childName = `PW PkgRoll Child ${run}`;
    const parent = await mkProduct(`PW PkgRoll ${run}`, parentSlug);
    const child = await mkProduct(childName, `pw-pkgr-child-${run}`);
    const emptySlug = `pw-pkgr-empty-${run}`;
    const silentSlug = `pw-pkgr-silent-${run}`;
    await mkProduct(`PW PkgRoll Empty ${run}`, emptySlug);
    const silent = await mkProduct(`PW PkgRoll Silent ${run}`, silentSlug);

    const compose = await api('POST', `/api/v1/products/${parent}/composes`, { childId: child });
    expect(compose.status).toBeLessThan(300);
    for (const [product, body] of [
      [parent, { componentId: edgeComp.id }],
      [parent, { componentId: staleComp.id }],
      [parent, { componentGroupId: groupId }],
      [child, { componentId: bomComp.id }],
      [silent, { componentId: s.probeComponentId }],
    ] as const) {
      const res = await api('POST', `/api/v1/products/${product}/depends-on`, body);
      expect(res.status).toBeLessThan(300);
    }

    fixture = { parentSlug, childName, emptySlug, silentSlug, libGroupName };
  });

  test('Packages tab lists the roll-up with declared marker and coverage @smoke', async ({ page }) => {
    await loginPage(page, 'VIEWER');
    await page.goto(`/products/${fixture.parentSlug}?tab=packages`);
    await expect(page.getByRole('tab', { name: 'Packages' })).toBeVisible({ timeout: 30_000 });

    const row = page.getByTestId('package-row-pkg:npm/pw-shared-lib');
    // Row test ids share the /packages convention but live under the
    // product tab — the row renders name, purl, and both version chips.
    const productRow = page.getByTestId('product-package-row-pkg:npm/pw-shared-lib');
    await expect(productRow).toBeVisible({ timeout: 30_000 });
    await expect(productRow).toContainText('pw-shared-lib');
    await expect(productRow.getByTestId('version-chip-1.9.0')).toBeVisible();
    await expect(productRow.getByTestId('version-chip-2.0.0')).toBeVisible();
    // Declared marker carries the GROUP attribution.
    await expect(productRow).toContainText(`Group · ${fixture.libGroupName}`);
    // Coverage: one non-LIBRARY reachable component reports (the edge
    // target); libraries are excluded from the denominator.
    await expect(page.getByTestId('product-packages-coverage')).toContainText('1 of 1 reporting');
    // Inventory-only posture copy.
    await expect(page.getByText(/does not scan for vulnerabilities/)).toBeVisible();
    // Seeded stale rows flag freshness on the row.
    await expect(page.getByTestId('stale-pkg:npm/pw-stale-lib')).toBeVisible();
    expect(row).toHaveCount(0); // workspace test id is not used on this surface
  });

  test('declared and skew filters narrow the list via URL params', async ({ page }) => {
    await loginPage(page, 'VIEWER');
    await page.goto(`/products/${fixture.parentSlug}?tab=packages&declared=declared`);
    await expect(page.getByTestId('product-package-row-pkg:npm/pw-shared-lib')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('product-package-row-pkg:npm/pw-stale-lib')).toHaveCount(0);

    await page.goto(`/products/${fixture.parentSlug}?tab=packages&skew=true`);
    await expect(page.getByTestId('product-package-row-pkg:npm/pw-shared-lib')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('product-package-row-pkg:npm/pw-stale-dev')).toHaveCount(0);
  });

  test('row expansion shows attributed consumers; version chip narrows them', async ({ page }) => {
    const s = seed();
    await loginPage(page, 'VIEWER');
    await page.goto(`/products/${fixture.parentSlug}?tab=packages&q=pw-shared`);
    // Click the chevron cell — the row's center can land on chips/links
    // that stopPropagation.
    const sharedRow = page.getByTestId('product-package-row-pkg:npm/pw-shared-lib');
    await sharedRow.locator('td').first().click();
    await expect(page).toHaveURL(/pkg=pkg(%3A|:)npm/);

    const panel = page.getByTestId('consumers-pkg:npm/pw-shared-lib');
    await expect(panel).toBeVisible({ timeout: 30_000 });
    // DIRECT consumer (stale comp) and INHERITED consumer (bom comp via child).
    await expect(panel).toContainText('Direct edge');
    await expect(panel).toContainText(`Inherited · ${fixture.childName}`);
    // Component cell deep-links into that component's BOM tab filtered to the purl.
    const bomLink = panel.locator(`a[href*="/components/${s.bomSlug}?tab=bom"]`);
    await expect(bomLink).toBeVisible();

    // Version chip → ?version= URL param → the consumers call narrows.
    await page.getByTestId('version-chip-1.9.0').click();
    await expect(page).toHaveURL(/version=1\.9\.0/);
    await expect(panel).toContainText('1.9.0');
    await expect(panel).not.toContainText('2.0.0');
    await expect(bomLink).toBeVisible();
    const staleLink = panel.locator(`a[href*="/components/${s.bomStaleSlug}?tab=bom"]`);
    await expect(staleLink).toHaveCount(0);
  });

  test('sort and expanded-row state reproduce from the URL (SC-004)', async ({ page }) => {
    await loginPage(page, 'VIEWER');
    // sort=name asc: "accepts" (from the mock SBOM) is alphabetically
    // first; desc puts "pw-stale-trans" ahead of the other names.
    await page.goto(`/products/${fixture.parentSlug}?tab=packages&sort=name&order=asc`);
    await expect(
      page.locator('[data-testid^="product-package-row-"]').first(),
    ).toContainText('accepts', { timeout: 30_000 });
    await page.goto(`/products/${fixture.parentSlug}?tab=packages&sort=name&order=desc`);
    await expect(
      page.locator('[data-testid^="product-package-row-"]').first(),
    ).toContainText('pw-stale-trans', { timeout: 30_000 });

    // Deep link straight into an expanded, version-filtered row.
    await page.goto(
      `/products/${fixture.parentSlug}?tab=packages&q=pw-shared&pkg=${encodeURIComponent('pkg:npm/pw-shared-lib')}&version=1.9.0`,
    );
    const panel = page.getByTestId('consumers-pkg:npm/pw-shared-lib');
    await expect(panel).toBeVisible({ timeout: 30_000 });
    await expect(panel.getByTestId('consumers-version-filter')).toContainText('1.9.0');
    await expect(panel).not.toContainText('2.0.0');
  });

  test('empty states distinguish no dependencies from no package data', async ({ page }) => {
    await loginPage(page, 'VIEWER');
    await page.goto(`/products/${fixture.emptySlug}?tab=packages`);
    await expect(page.getByText('No component dependencies')).toBeVisible({ timeout: 30_000 });

    await page.goto(`/products/${fixture.silentSlug}?tab=packages`);
    await expect(page.getByText('No package data reported')).toBeVisible({ timeout: 30_000 });

    // Filtered-to-nothing on the populated product shows the no-match state.
    await page.goto(`/products/${fixture.parentSlug}?tab=packages&q=zzz-no-such-package`);
    await expect(page.getByText('No packages match')).toBeVisible({ timeout: 30_000 });
  });

  test('flag off hides the Packages tab entirely', async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('componode.flag.productPackageRollup', 'false');
    });
    await loginPage(page, 'VIEWER');
    await page.goto(`/products/${fixture.parentSlug}`);
    await expect(page.getByRole('tab', { name: 'Components' })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('tab', { name: 'Packages' })).toHaveCount(0);
    // ?tab=packages falls back to Overview — no roll-up content renders.
    await page.goto(`/products/${fixture.parentSlug}?tab=packages`);
    await expect(page.getByRole('tab', { name: 'Overview' })).toHaveAttribute('data-state', 'active', { timeout: 30_000 });
    await expect(page.getByText(/does not scan for vulnerabilities/)).toHaveCount(0);
  });
});
