import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { apiLogin, loginPage, type ApiCall } from '../fixtures/auth.js';

const BASE = 'https://app.componode-pw.test';
// Distinct URL so this spec's config gets its own ImporterSource — sharing
// the seeded config's URL would couple both configs' source-scoped
// membership reconciliation.
const SBOM_EDGES_URL = 'https://mock-github:9443/sbom/cyclonedx-edges.json';
const SBOM_EDGES_V2_URL = 'https://mock-github:9443/sbom/cyclonedx-edges-v2.json';
const SBOM_EDGES_RETIRE_URL = 'https://mock-github:9443/sbom/cyclonedx-edges-retire.json';
const EXPRESS_SLUG = 'pkg-npm-express';
const ACCEPTS_SLUG = 'pkg-npm-accepts';
const LODASH_SLUG = 'pkg-npm-lodash';
const JEST_SLUG = 'pkg-npm-jest';
const GOLANG_SLUG = 'pkg-golang-golang-org-x-sys';

interface SeedResult {
  edgeSlug: string;
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
 * Spec 077 — sbom-file as the second declared-edge carrier (ADR-133). The
 * seeded non-LIBRARY target `pw-edge-*` lets the importer-added edges render
 * as rows on the libraries' dependedOnBy lanes (LIBRARY neighbours collapse
 * into libraryCounts). The spec's own config opts in (`importDeclaredEdges`)
 * against a dedicated mock URL; the CycloneDX dependencies[] graph
 * materializes PW Edge Target → express/lodash/jest and express → accepts
 * IMPORTER edges plus importer-native LIBRARY components. Suppressions are
 * durable, so each project hides its own pair (desktop → lodash,
 * narrow → jest).
 */
test.describe('sbom-file declared edges', () => {
  let edgesConfigId = '';

  test.beforeAll(async ({ request }, testInfo) => {
    // Importer config writes are ADMIN-only; edge hiding stays EDITOR.
    const api = await apiLogin(request, BASE, 'ADMIN');
    // Both Playwright projects run this hook — reuse the spec's config if a
    // sibling project already created it.
    const list = await api('GET', '/api/v1/importer-configs');
    const configs = list.body.data ?? list.body.configs ?? list.body.items ?? [];
    // URL-only match — the label prefix would also adopt this spec's
    // -retire/-v2/-ui configs if the list ordering changed.
    let configId: string | undefined = configs.find(
      (c: any) => c.scope?.sbomUrl === SBOM_EDGES_URL,
    )?.id;
    if (!configId) {
      const created = await api('POST', '/api/v1/importer-configs', {
        importerName: 'sbom-file',
        label: `pw-sbom-edges-${testInfo.project.name}`,
        scope: {
          sbomUrl: SBOM_EDGES_URL,
          componentSlug: seed().edgeSlug,
          importDeclaredEdges: true,
        },
        enabled: true,
      });
      expect(created.status).toBeLessThan(300);
      configId =
        created.body.id ?? created.body.config?.id ?? created.body.importerConfig?.id;
    }
    if (!configId) throw new Error('sbom-file edges config missing after create');
    edgesConfigId = configId;
    await triggerAndWait(api, edgesConfigId);

    // Wait until the edge pass has written edges and libraries — the pass
    // runs after the terminal COMPLETED write.
    const deadline = Date.now() + 30_000;
    let express: any = null;
    while (Date.now() < deadline) {
      express = express ?? (await findComponent(api, 'express', EXPRESS_SLUG));
      if (express) break;
      await new Promise((r) => setTimeout(r, 1500));
    }
    expect(express, 'importer-native library pkg-npm-express').toBeTruthy();

    // US2/AC4 — human curation wins over importer declarations. The
    // golang.org/x/sys library exists post-run (every document entry yields
    // a LIBRARY asset) but v1 does not declare target → golang, so this
    // curation link writes the pair as CURATED before any test can declare
    // it via the v2 document — ordering must precede the first v2 run.
    const target = await findComponent(api, 'PW Edge Target', seed().edgeSlug);
    const golang = await findComponent(api, 'golang.org/x/sys', GOLANG_SLUG);
    expect(target && golang, 'edge target + golang library for curated link').toBeTruthy();
    const linkDeadline = Date.now() + 30_000;
    for (;;) {
      // /packages/link wires consumers→componentId edges — componentId is
      // the LIBRARY, and linkConsumers:true is what writes rows (false only
      // stages suggestions). The run hasn't declared this pair, so the row
      // lands CURATED.
      const link = await api('POST', '/api/v1/packages/link', {
        purl: 'pkg:golang/golang.org/x/sys@0.15.0',
        componentId: golang.id,
        linkConsumers: true,
      });
      // 409 = the sibling project's hook already wrote the same edge.
      if (link.status === 200 || link.status === 409) break;
      if (Date.now() > linkDeadline) {
        throw new Error(`packages/link failed ${link.status}`);
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
  });

  test('opt-in switch renders the review-bypass copy and persists through the form', async ({ page, request }, testInfo) => {
    await loginPage(page, 'ADMIN');
    await page.goto('/importers/new');
    await page.locator('#i-provider').click();
    await page.getByRole('option', { name: 'SBOM File' }).click();
    await expect(page.getByText('Import declared edges')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/added to the catalog without review/)).toBeVisible();

    // US1/AC1 — turning the switch on in the form must persist to scope.
    // The URL is never fetched (the config is never triggered); a
    // throwaway config keeps the spec's shared config untouched.
    const label = `pw-sbom-edges-ui-${testInfo.project.name}`;
    await page.locator('#i-label').fill(label);
    await page.locator('#i-scope-sbomUrl').fill('https://mock-github:9443/sbom/unused-ui.json');
    await page.locator('#i-scope-componentSlug').fill(seed().edgeSlug);
    await page.locator('#i-scope-importDeclaredEdges').click();
    await page.getByRole('button', { name: 'Create importer' }).click();

    const api = await apiLogin(request, BASE, 'ADMIN');
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
    expect(createdScope?.importDeclaredEdges).toBe(true);
  });

  test('viewer sees Added-by-importer edges with provenance on the library', async ({ page }) => {
    await loginPage(page, 'VIEWER');
    // The non-LIBRARY target renders as a dependedOnBy row on the library's
    // page — the library side is where imported edges surface (spec 075
    // collapses library neighbours into counts on the target's side).
    await page.goto(`/components/${EXPRESS_SLUG}?tab=relationships`);

    const row = page.getByRole('button', {
      name: /PW Edge Target.*depends on express.*Added by importer/i,
    });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.click();

    await expect(page.getByTestId('edge-provenance-importer')).toBeVisible();
    // exact — the sidebar carries an "Importer sources" nav link.
    await expect(page.getByRole('link', { name: 'Source', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Import run', exact: true })).toBeVisible();
    // Viewers see provenance but can never hide an edge.
    await expect(page.getByTestId('hide-edge')).not.toBeVisible();

    // The Used-by surface carries the same provenance badge + links on the
    // consumer row (spec 076 UX-EDGE-01).
    await page.goto(`/components/${EXPRESS_SLUG}`);
    const consumer = page.getByRole('row', { name: /PW Edge Target/ });
    await expect(consumer).toBeVisible({ timeout: 30_000 });
    await expect(consumer.getByText('Added by importer')).toBeVisible();
    await expect(consumer.getByRole('link', { name: 'Source', exact: true })).toBeVisible();
    await expect(consumer.getByRole('link', { name: 'Import run', exact: true })).toBeVisible();
  });

  test('declared edges collapse into library summaries on the library sides', async ({ page }) => {
    await loginPage(page, 'VIEWER');

    // Subject edges on the target's page: the declared library deps roll up
    // into the bounded summary (spec 075 — never listed as rows here). The
    // exact count is cross-project racy (each project suppresses one pair),
    // so assert the collapsed summary renders at all.
    await page.goto(`/components/${seed().edgeSlug}?tab=relationships`);
    await expect(page.getByTestId('libraries-summary-dependsOn')).toContainText(
      /librar(y|ies)/,
      { timeout: 30_000 },
    );

    // express → accepts: express's dependsOn summary counts accepts.
    await page.goto(`/components/${EXPRESS_SLUG}?tab=relationships`);
    await expect(page.getByTestId('libraries-summary-dependsOn')).toContainText(
      '1 library',
    );
    // …and accepts's dependedOnBy summary counts express.
    await page.goto(`/components/${ACCEPTS_SLUG}?tab=relationships`);
    await expect(page.getByTestId('libraries-summary-dependedOnBy')).toContainText(
      '1 library',
    );
  });

  test('a curated edge on a declared pair is never relabelled by the importer', async ({ page, request }, testInfo) => {
    // beforeAll wrote target → golang.org/x/sys as CURATED. A second config
    // at the v2 document declares the same pair (repointing this config
    // would rebind its Source and break provenance links on the original
    // edges) — the conflict-safe write must leave the curated row
    // untouched. Config create + trigger are ADMIN-only.
    const api = await apiLogin(request, BASE, 'ADMIN');
    const golang = await findComponent(api, 'golang.org/x/sys', GOLANG_SLUG);
    expect(golang, 'importer-native golang.org/x/sys library').toBeTruthy();

    const created = await api('POST', '/api/v1/importer-configs', {
      importerName: 'sbom-file',
      label: `pw-sbom-edges-v2-${testInfo.project.name}`,
      scope: {
        // Per-project query → distinct Source identities (the mock keys
        // on path only, so the query is inert for serving).
        sbomUrl: `${SBOM_EDGES_V2_URL}?p=${testInfo.project.name}`,
        componentSlug: seed().edgeSlug,
        importDeclaredEdges: true,
      },
      enabled: true,
    });
    expect(created.status).toBeLessThan(300);
    const v2ConfigId =
      created.body.id ?? created.body.config?.id ?? created.body.importerConfig?.id;
    if (!v2ConfigId) throw new Error('v2 config create failed');
    await triggerAndWait(api, v2ConfigId);

    await loginPage(page, 'VIEWER');
    await page.goto(`/components/${golang.slug}?tab=relationships`);
    const row = page.getByRole('button', {
      name: /PW Edge Target.*depends on.*Curated/i,
    });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.click();
    await expect(page.getByTestId('edge-provenance-curated')).toBeVisible();
    await expect(page.getByTestId('edge-provenance-importer')).not.toBeVisible();
  });

  test('a dependency removed from the document retires exactly that edge', async ({ page, request }, testInfo) => {
    // Two runs on the same config plus polls — generous timeout.
    test.setTimeout(180_000);
    // US2/AC3 + SC-002 — same Source, declaration dropped between runs:
    // the mock serves v1 (root → debug, debug → ms) on this seq's first
    // fetch and v2 (root → debug only) afterwards, so run 2 must retire
    // exactly debug → ms while every other edge survives untouched. The
    // seq-suffixed package names keep every pair unique to this project,
    // and retry-scoped seqs give each attempt a fresh v1→v2 sequence.
    // (US2/AC5 degraded-yield preservation is proven at the pass level in
    // backend's import-run-edges integration suite.)
    const api = await apiLogin(request, BASE, 'ADMIN');
    const seq = `${testInfo.project.name}-r${testInfo.retry}`;
    const debugSlug = `pkg-npm-debug-${seq}`;
    const msSlug = `pkg-npm-ms-${seq}`;
    const created = await api('POST', '/api/v1/importer-configs', {
      importerName: 'sbom-file',
      label: `pw-sbom-edges-retire-${seq}`,
      scope: {
        sbomUrl: `${SBOM_EDGES_RETIRE_URL}?seq=${seq}`,
        componentSlug: seed().edgeSlug,
        importDeclaredEdges: true,
      },
      enabled: true,
    });
    expect(created.status).toBeLessThan(300);
    const retireConfigId =
      created.body.id ?? created.body.config?.id ?? created.body.importerConfig?.id;
    if (!retireConfigId) throw new Error('retire config create failed');

    await triggerAndWait(api, retireConfigId);
    // Wait out the post-completion edge pass: ms gains debug as a
    // dependedOnBy library neighbour.
    const libCounts = (body: any) =>
      body.relationships?.libraryCounts?.dependedOnBy;
    const deadline = Date.now() + 30_000;
    let ms: any = null;
    let libCount = 0;
    while (Date.now() < deadline) {
      ms =
        ms ??
        (await findComponent(api, `ms-${testInfo.project.name}`, msSlug));
      if (ms) {
        const rel = await api('GET', `/api/v1/components/${ms.id}/relationships`);
        libCount = libCounts(rel.body) ?? 0;
        if (libCount === 1) break;
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
    expect(libCount, 'ms dependedOnBy count after v1 run').toBe(1);

    // v2 no longer declares debug → ms — exactly that edge retires.
    await triggerAndWait(api, retireConfigId);
    const retireDeadline = Date.now() + 30_000;
    while (Date.now() < retireDeadline) {
      const rel = await api('GET', `/api/v1/components/${ms.id}/relationships`);
      if (libCounts(rel.body) === 0) break;
      await new Promise((r) => setTimeout(r, 1500));
    }
    const finalRel = await api('GET', `/api/v1/components/${ms.id}/relationships`);
    expect(libCounts(finalRel.body)).toBe(0);

    // The surviving declaration is untouched — debug still lists the
    // non-LIBRARY target as an importer row on its dependedOnBy lane.
    await loginPage(page, 'VIEWER');
    await page.goto(`/components/${debugSlug}?tab=relationships`);
    await expect(
      page.getByRole('button', {
        name: /PW Edge Target.*depends on debug.*Added by importer/i,
      }),
    ).toBeVisible({ timeout: 30_000 });
  });

  test('flag-off hides the opt-in switch and every provenance surface', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      window.localStorage.setItem('componode.flag.bomImporterEdges', 'false');
    });
    await loginPage(page, 'ADMIN');
    await page.goto('/importers/new');
    await page.locator('#i-provider').click();
    await page.getByRole('option', { name: 'SBOM File' }).click();
    await expect(page.locator('#i-scope-sbomUrl')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Import declared edges')).not.toBeVisible();

    // The edge still exists; its provenance markers and hide action hide.
    await loginPage(page, 'VIEWER');
    await page.goto(`/components/${EXPRESS_SLUG}?tab=relationships`);
    const row = page.getByRole('button', { name: /PW Edge Target.*depends on express/i });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(row).not.toContainText('Added by importer');
    await row.click();
    await expect(page.getByTestId('edge-provenance-importer')).not.toBeVisible();
    await expect(page.getByTestId('hide-edge')).not.toBeVisible();
  });

  test('editor hides an importer edge and it is not recreated by the next run', async ({ page, request }, testInfo) => {
    // Two full re-runs inside the test — double the default timeout.
    test.setTimeout(180_000);
    // One durable suppression per project: desktop hides target→lodash,
    // narrow hides target→jest — the pairs never collide.
    const slug = testInfo.project.name === 'chromium-narrow' ? JEST_SLUG : LODASH_SLUG;
    const api = await apiLogin(request, BASE, 'EDITOR');
    await loginPage(page, 'EDITOR');
    await page.goto(`/components/${slug}?tab=relationships`);

    const row = page.getByRole('button', {
      name: /PW Edge Target.*Added by importer/i,
    });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.click();
    await page.getByTestId('hide-edge').click();
    await expect(page.getByText(/won't be recreated by future imports/i)).toBeVisible();
    await page.getByTestId('hide-edge-confirm').click();
    await expect(page.getByText('Edge hidden')).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByRole('button', { name: /PW Edge Target/i }),
    ).not.toBeVisible();

    // Re-run twice — SC-003 requires the suppressed pair to stay hidden
    // across ≥2 subsequent completed runs while the other edges
    // re-materialize with zero duplicates.
    await triggerAndWait(api, edgesConfigId);
    await triggerAndWait(api, edgesConfigId);
    await page.reload();
    await expect(
      page.getByRole('button', { name: /PW Edge Target.*Added by importer/i }),
    ).not.toBeVisible({ timeout: 30_000 });
    await page.goto(`/components/${EXPRESS_SLUG}?tab=relationships`);
    // US1/AC7 — the surviving edge re-materialized exactly once (zero
    // duplicate components or edges).
    await expect(
      page.getByRole('button', {
        name: /PW Edge Target.*depends on express.*Added by importer/i,
      }),
    ).toHaveCount(1);
  });
});
