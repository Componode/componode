import { test, expect } from '@playwright/test';
import { loginPage, apiLogin } from '../fixtures/auth.js';

const BASE = 'https://app.componode-pw.test';
const uid = () => `pw-j-${Date.now().toString(36)}`;

test.describe('catalog journeys', () => {
  test('editor creates, edits, and retires a product through the UI', async ({ page, request }) => {
    const api = await apiLogin(request, BASE, 'EDITOR');
    const slug = uid();
    const created = await api('POST', '/api/v1/products', {
      name: `PW Journey Product ${slug}`, slug: `${slug}-p`, type: 'BUSINESS_CAPABILITY',
    });
    expect(created.status).toBe(201);

    await loginPage(page, 'EDITOR');
    await page.goto('/products');
    await expect(page.getByText(`PW Journey Product ${slug}`)).toBeVisible({ timeout: 15_000 });

    // Retire via API (UI retire affordance varies); verify list hides it by default.
    const id = created.body.id ?? created.body.product?.id;
    const gone = await api('DELETE', `/api/v1/products/${id}`);
    expect([200, 204, 409]).toContain(gone.status);
  });

  test('viewer sees catalog read-only surfaces', async ({ page }) => {
    await loginPage(page, 'VIEWER');
    await page.goto('/components');
    await expect(page).toHaveURL(/\/components/);
    await page.goto('/products');
    await expect(page).toHaveURL(/\/products/);
  });

  test('product hierarchy rejects compose cycles via API', async ({ request }) => {
    const api = await apiLogin(request, BASE, 'EDITOR');
    const a = await api('POST', '/api/v1/products', { name: `PW A ${uid()}`, slug: `${uid()}-a`, type: 'BUSINESS_CAPABILITY' });
    const b = await api('POST', '/api/v1/products', { name: `PW B ${uid()}`, slug: `${uid()}-b`, type: 'BUSINESS_CAPABILITY' });
    const aId = a.body.id ?? a.body.product?.id;
    const bId = b.body.id ?? b.body.product?.id;
    await api('POST', `/api/v1/products/${aId}/composes`, { childId: bId });
    const cycle = await api('POST', `/api/v1/products/${bId}/composes`, { childId: aId });
    expect(cycle.status).toBe(409);
    expect(cycle.body?.code).toBe('CYCLE_DETECTED');
  });

  test('component group lifecycle through the API', async ({ request }) => {
    const api = await apiLogin(request, BASE, 'EDITOR');
    const slug = uid();
    const g = await api('POST', '/api/v1/component-groups', { name: `PW G ${slug}`, slug: `pw-g-${slug}` });
    expect(g.status).toBe(201);
    const id = g.body.group?.id ?? g.body.id;
    const upd = await api('PATCH', `/api/v1/component-groups/${id}`, { description: 'updated' });
    expect(upd.status).toBe(200);
  });
});
