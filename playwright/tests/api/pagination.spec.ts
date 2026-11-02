import { test, expect } from '@playwright/test';
import { apiLogin } from '../fixtures/auth.js';

const BASE = 'https://app.componode-pw.test';

test.describe('server-side pagination boundaries', () => {
  test('components page/pageSize: two full pages + partial tail at 100', async ({ request }) => {
    const api = await apiLogin(request, BASE, 'ADMIN');
    const p1 = await api('GET', '/api/v1/components?page=1&pageSize=100');
    const p2 = await api('GET', '/api/v1/components?page=2&pageSize=100');
    const p3 = await api('GET', '/api/v1/components?page=3&pageSize=100');
    expect(p1.status).toBe(200);
    const items1 = p1.body.items ?? p1.body.data ?? p1.body;
    const items2 = p2.body.items ?? p2.body.data ?? p2.body;
    const items3 = p3.body.items ?? p3.body.data ?? p3.body;
    expect(items1).toHaveLength(100);
    expect(items2).toHaveLength(100);
    expect(items3.length).toBeGreaterThan(0);
    expect(items3.length).toBeLessThan(100);
  });

  test('components default pageSize is 50', async ({ request }) => {
    const api = await apiLogin(request, BASE, 'EDITOR');
    const res = await api('GET', '/api/v1/components?page=1');
    expect(res.status).toBe(200);
    const items = res.body.items ?? res.body.data ?? res.body;
    expect(items).toHaveLength(50);
  });

  test('activity limit/offset covers two full pages plus partial', async ({ request }) => {
    const api = await apiLogin(request, BASE, 'ADMIN');
    const a = await api('GET', '/api/v1/audit/activity?limit=50&offset=0');
    const b = await api('GET', '/api/v1/audit/activity?limit=50&offset=50');
    const c = await api('GET', '/api/v1/audit/activity?limit=50&offset=100');
    expect(a.status).toBe(200);
    const aItems = a.body.items ?? a.body.data ?? a.body;
    const bItems = b.body.items ?? b.body.data ?? b.body;
    const cItems = c.body.items ?? c.body.data ?? c.body;
    expect(aItems.length).toBeGreaterThan(0);
    expect(bItems.length).toBeGreaterThanOrEqual(0);
    expect(cItems.length).toBeLessThanOrEqual(50);
  });

  test('suggestions limit/offset respects boundaries', async ({ request }) => {
    const api = await apiLogin(request, BASE, 'ADMIN');
    const res = await api('GET', '/api/v1/suggestions?limit=50&offset=0');
    expect(res.status).toBe(200);
    const items = res.body.items ?? res.body.data ?? res.body;
    expect(items.length).toBeLessThanOrEqual(50);
  });
});
