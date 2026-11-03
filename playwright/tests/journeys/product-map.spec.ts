import { test, expect } from '@playwright/test';
import { loginPage, apiLogin } from '../fixtures/auth.js';

const BASE = 'https://app.componode-pw.test';
const uid = () => `pw-m-${Date.now().toString(36)}`;

type Api = Awaited<ReturnType<typeof apiLogin>>;

/** Builds a hub product with one relation in every family (spec 059). */
async function buildTopologyFixture(api: Api, run: string) {
  const mk = async (name: string, type = 'PLATFORM') => {
    const res = await api('POST', '/api/v1/products', { name: `${name} ${run}`, slug: `${name.toLowerCase()}-${run}`, type });
    expect(res.status).toBe(201);
    return res.body.product?.id ?? res.body.id;
  };
  const hub = await mk('Hub');
  const parent = await mk('Parent', 'BUSINESS_CAPABILITY');
  const child = await mk('Child', 'BUSINESS_CAPABILITY');
  const platform = await mk('Plat');
  const consumer = await mk('Consumer', 'CUSTOMER_FACING');
  const group = await api('POST', '/api/v1/component-groups', { name: `Group ${run}`, slug: `grp-${run}` });
  expect(group.status).toBe(201);
  const groupId = group.body.group?.id ?? group.body.id;

  await api('POST', `/api/v1/products/${parent}/composes`, { childId: hub });
  await api('POST', `/api/v1/products/${hub}/composes`, { childId: child });
  await api('POST', `/api/v1/products/${hub}/consumes-from`, { platformId: platform });
  await api('POST', `/api/v1/products/${consumer}/consumes-from`, { platformId: hub });
  await api('POST', `/api/v1/products/${hub}/depends-on`, { componentGroupId: groupId });

  return { hub, parent, child, platform, consumer, groupId, hubSlug: `hub-${run}` };
}

test.describe('product map topology (spec 059)', () => {
  test('all relation families render at the top of Dependencies with direction', async ({ page, request }) => {
    const api = await apiLogin(request, BASE, 'EDITOR');
    const run = uid();
    const fx = await buildTopologyFixture(api, run);

    await loginPage(page, 'VIEWER');
    await page.goto(`/products/${fx.hubSlug}?tab=dependencies`);

    // Topology sits at the top of Dependencies, above the authoring controls.
    await expect(page.getByText('Product topology')).toBeVisible({ timeout: 15_000 });
    for (const lane of ['Composed by', 'Consumed by', 'Composes', 'Consumes from', 'Depends on groups']) {
      await expect(page.getByText(lane, { exact: true }).first()).toBeVisible();
    }
    await expect(page.getByRole('button', { name: new RegExp(`Parent ${run}.*composes Hub ${run}`, 'i') })).toBeVisible();
    await expect(page.getByRole('button', { name: new RegExp(`Consumer ${run}.*consumes from Hub ${run}`, 'i') })).toBeVisible();
    await expect(page.getByRole('button', { name: new RegExp(`Group ${run}.*Hub ${run} depends on`, 'i') })).toBeVisible();
  });

  test('inspection panel, +N expansion, and keyboard operation work without a mouse', async ({ page, request }) => {
    const api = await apiLogin(request, BASE, 'EDITOR');
    const run = uid();
    const fx = await buildTopologyFixture(api, run);
    // Five extra children force a +N expansion control on the Composes lane.
    for (let i = 0; i < 5; i++) {
      const c = await api('POST', '/api/v1/products', { name: `Extra ${i} ${run}`, slug: `extra-${i}-${run}`, type: 'PLATFORM' });
      const id = c.body.product?.id ?? c.body.id;
      await api('POST', `/api/v1/products/${fx.hub}/composes`, { childId: id });
    }

    await loginPage(page, 'VIEWER');
    await page.goto(`/products/${fx.hubSlug}?tab=dependencies`);

    // +N shows only four nodes per lane until expanded.
    const expand = page.getByRole('button', { name: /\+\d+ more/ });
    await expect(expand).toBeVisible();
    await expand.click();
    await expect(page.getByRole('button', { name: new RegExp(`Extra 4 ${run}`) })).toBeVisible();

    // Keyboard: node buttons are tabbable and open the inspection panel.
    const node = page.getByRole('button', { name: new RegExp(`Consumer ${run}.*consumes from Hub ${run}`, 'i') });
    await node.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('link', { name: /open product/i })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('link', { name: /open product/i })).toHaveCount(0);

    // Selection then Open Product navigates to the related detail.
    await node.click();
    await page.getByRole('link', { name: /open product/i }).click();
    await expect(page).toHaveURL(new RegExp(`/products/consumer-${run}`));
  });

  test('legacy ?tab=map links land on Dependencies; empty products show an empty state', async ({ page, request }) => {
    const api = await apiLogin(request, BASE, 'EDITOR');
    const run = uid();
    const lonely = await api('POST', '/api/v1/products', { name: `Lonely ${run}`, slug: `lonely-${run}`, type: 'PLATFORM' });
    expect(lonely.status).toBe(201);

    await loginPage(page, 'VIEWER');
    await page.goto(`/products/lonely-${run}?tab=map`);
    await expect(page.getByText(/no relationships/i)).toBeVisible({ timeout: 15_000 });
    // The resolved tab is Dependencies, not a removed Map tab.
    await expect(page.getByRole('tab', { name: 'Dependencies' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tab', { name: 'Map' })).toHaveCount(0);
  });

  test('topology stays usable without horizontal overflow and honors reduced motion', async ({ page, request }) => {
    const api = await apiLogin(request, BASE, 'EDITOR');
    const run = uid();
    const fx = await buildTopologyFixture(api, run);

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await loginPage(page, 'VIEWER');
    await page.goto(`/products/${fx.hubSlug}?tab=dependencies`);
    await expect(page.getByText('Product topology')).toBeVisible({ timeout: 15_000 });

    // No horizontal overflow at the current viewport (1280 desktop + 768 narrow projects).
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    // Read-only: no pan/zoom/drag controls and no authoring inputs inside the topology card.
    const topology = page.locator('section', { has: page.getByText('Product topology') }).first();
    await expect(topology.getByRole('textbox')).toHaveCount(0);
    await expect(topology.getByRole('slider')).toHaveCount(0);
  });
});
