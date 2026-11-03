import { test, expect } from '@playwright/test';
import { loginPage, apiLogin } from '../fixtures/auth.js';

const BASE = 'https://app.componode-pw.test';
const uid = () => `pw-r-${Date.now().toString(36)}`;

type Api = Awaited<ReturnType<typeof apiLogin>>;

/** Seeds a component with an instance plus direct and group-mediated Product
 *  dependents (spec 060). Component-to-Component lanes have no writer yet —
 *  they assert honest empty states. */
async function buildRelationshipFixture(api: Api, run: string) {
  const comp = await api('POST', '/api/v1/components', {
    name: `RelComp ${run}`,
    slug: `relcomp-${run}`,
    category: 'WEB_ENDPOINT',
    provider: 'WEB_URL',
    resourceType: 'web:endpoint',
  });
  expect(comp.status).toBe(201);
  const componentId = comp.body.component?.id ?? comp.body.id;

  const inst = await api('POST', `/api/v1/components/${componentId}/instances`, {
    environment: 'PRODUCTION',
    url: 'https://svc.example.com',
  });
  expect(inst.status).toBe(201);

  const group = await api('POST', '/api/v1/component-groups', {
    name: `RelGroup ${run}`,
    slug: `relgroup-${run}`,
  });
  expect(group.status).toBe(201);
  const groupId = group.body.group?.id ?? group.body.id;

  const assign = await api('PATCH', `/api/v1/components/${componentId}`, {
    componentGroupId: groupId,
  });
  expect(assign.status).toBe(200);

  const mkProduct = async (name: string) => {
    const res = await api('POST', '/api/v1/products', {
      name: `${name} ${run}`,
      slug: `${name.toLowerCase()}-${run}`,
      type: 'BUSINESS_CAPABILITY',
    });
    expect(res.status).toBe(201);
    return res.body.product?.id ?? res.body.id;
  };
  const direct = await mkProduct('RelDirect');
  const viaGroup = await mkProduct('RelVia');

  await api('POST', `/api/v1/products/${direct}/depends-on`, { componentId });
  await api('POST', `/api/v1/products/${viaGroup}/depends-on`, { componentGroupId: groupId });

  return { componentId, groupId, run, slug: `relcomp-${run}` };
}

test.describe('component relationships tab (spec 060)', () => {
  test('renders typed lanes, provenance, and nested instances', async ({ page, request }) => {
    const api = await apiLogin(request, BASE, 'EDITOR');
    const fx = await buildRelationshipFixture(api, uid());

    await loginPage(page, 'VIEWER');
    await page.goto(`/components/${fx.slug}?tab=relationships`);

    await expect(page.getByText('Component relationships')).toBeVisible({ timeout: 15_000 });
    for (const lane of [
      'Depended on by',
      'Sourced by',
      'Exposed by',
      'Product dependents',
      'Depends on',
      'Sources from',
      'Exposes',
    ]) {
      await expect(page.getByText(lane, { exact: true }).first()).toBeVisible();
    }

    // Direct vs group-mediated provenance stays labeled on the node.
    await expect(
      page.getByRole('button', { name: new RegExp(`RelDirect ${fx.run}.*depends on RelComp ${fx.run} directly`, 'i') }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: new RegExp(`RelVia ${fx.run}.*via RelGroup ${fx.run}`, 'i') }),
    ).toBeVisible();
    await expect(page.getByText(`via RelGroup ${fx.run}`)).toBeVisible();

    // Instances nest under the focused component with environment + status.
    await expect(page.getByText('Instances')).toBeVisible();
    await expect(page.getByText('Production')).toBeVisible();
    await expect(page.getByText('Running')).toBeVisible();

    // Component-to-Component lanes have no writer yet — honest empty states.
    for (const lane of ['Depended on by', 'Depends on']) {
      const col = page.locator('div', { has: page.getByText(lane, { exact: true }) }).last();
      await expect(col.getByText('None').first()).toBeVisible();
    }
  });

  test('keyboard operation, +N expansion, and inspection panel', async ({ page, request }) => {
    const api = await apiLogin(request, BASE, 'EDITOR');
    const run = uid();
    const fx = await buildRelationshipFixture(api, run);

    // Six extra direct dependents force a +N control on the products lane.
    for (let i = 0; i < 6; i++) {
      const p = await api('POST', '/api/v1/products', {
        name: `RelExtra ${i} ${run}`,
        slug: `relextra-${i}-${run}`,
        type: 'BUSINESS_CAPABILITY',
      });
      const id = p.body.product?.id ?? p.body.id;
      await api('POST', `/api/v1/products/${id}/depends-on`, { componentId: fx.componentId });
    }

    await loginPage(page, 'VIEWER');
    await page.goto(`/components/${fx.slug}?tab=relationships`);
    await expect(page.getByText('Component relationships')).toBeVisible({ timeout: 15_000 });

    const expand = page.getByRole('button', { name: /\+\d+ more/ });
    await expect(expand).toBeVisible();
    await expand.click();
    await expect(page.getByRole('button', { name: new RegExp(`RelExtra 5 ${run}`) })).toBeVisible();

    const node = page.getByRole('button', {
      name: new RegExp(`RelDirect ${run}.*depends on RelComp ${run}`, 'i'),
    });
    await node.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('link', { name: /open product/i })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('link', { name: /open product/i })).toHaveCount(0);

    await node.click();
    await page.getByRole('link', { name: /open product/i }).click();
    await expect(page).toHaveURL(new RegExp(`/products/reldirect-${run}`));
  });

  test('empty component shows an honest empty state; view stays read-only and responsive', async ({ page, request }) => {
    const api = await apiLogin(request, BASE, 'EDITOR');
    const run = uid();
    const comp = await api('POST', '/api/v1/components', {
      name: `RelEmpty ${run}`,
      slug: `relempty-${run}`,
      category: 'REPOSITORY',
      provider: 'GITHUB',
      resourceType: 'repo',
    });
    expect(comp.status).toBe(201);

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await loginPage(page, 'VIEWER');
    await page.goto(`/components/relempty-${run}?tab=relationships`);
    await expect(page.getByText(/no relationships/i)).toBeVisible({ timeout: 15_000 });

    // 768px viewport (SC-004): no horizontal overflow.
    await page.setViewportSize({ width: 768, height: 900 });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    // Read-only: no authoring inputs in the relationships surface.
    const card = page.locator('div', { has: page.getByText('Component relationships') }).first();
    await expect(card.getByRole('textbox')).toHaveCount(0);
  });

  test('Overview keeps the existing Instances table', async ({ page, request }) => {
    const api = await apiLogin(request, BASE, 'EDITOR');
    const fx = await buildRelationshipFixture(api, uid());

    await loginPage(page, 'VIEWER');
    await page.goto(`/components/${fx.slug}`);
    await expect(page.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByText('Instances').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Production')).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Relationships' })).toBeVisible();
  });
});
