import { test, expect } from '@playwright/test';
import { apiLogin } from '../fixtures/auth.js';

const BASE = 'https://app.componode-pw.test';

// Spec 068 / ADR-130: list endpoints answer `{ data, pagination }` where
// pagination is `{ page, pageSize, total, pageCount, hasNext }`.
const rows = (body: any) => body.data ?? body.items ?? body;

test.describe('server-side pagination contract', () => {
  test('components page/pageSize: two full pages + partial tail at 100', async ({ request }) => {
    const api = await apiLogin(request, BASE, 'ADMIN');
    const p1 = await api('GET', '/api/v1/components?page=1&pageSize=100');
    const p2 = await api('GET', '/api/v1/components?page=2&pageSize=100');
    const p3 = await api('GET', '/api/v1/components?page=3&pageSize=100');
    expect(p1.status).toBe(200);
    expect(p1.body.pagination).toMatchObject({ page: 1, pageSize: 100 });
    expect(rows(p1.body)).toHaveLength(100);
    expect(rows(p2.body)).toHaveLength(100);
    expect(rows(p3.body).length).toBeGreaterThan(0);
    expect(rows(p3.body).length).toBeLessThanOrEqual(100);
    // Envelope self-consistency regardless of the seeded total.
    for (const res of [p1, p2, p3]) {
      const pg = res.body.pagination;
      expect(pg.hasNext).toBe(pg.page < pg.pageCount);
      expect(pg.pageCount).toBe(Math.max(1, Math.ceil(pg.total / pg.pageSize)));
    }
  });

  test('components default pageSize is 25', async ({ request }) => {
    const api = await apiLogin(request, BASE, 'EDITOR');
    const res = await api('GET', '/api/v1/components?page=1');
    expect(res.status).toBe(200);
    expect(res.body.pagination.pageSize).toBe(25);
    expect(rows(res.body)).toHaveLength(25);
  });

  test('audit activity page/pageSize respects boundaries', async ({ request }) => {
    const api = await apiLogin(request, BASE, 'ADMIN');
    const a = await api('GET', '/api/v1/audit/activity?page=1&pageSize=50');
    const b = await api('GET', '/api/v1/audit/activity?page=2&pageSize=50');
    const c = await api('GET', '/api/v1/audit/activity?page=3&pageSize=50');
    expect(a.status).toBe(200);
    expect(a.body.pagination.pageSize).toBe(50);
    expect(rows(a.body).length).toBeGreaterThan(0);
    expect(rows(b.body).length).toBeLessThanOrEqual(50);
    expect(rows(c.body).length).toBeLessThanOrEqual(50);
  });

  test('suggestions page/pageSize respects boundaries', async ({ request }) => {
    const api = await apiLogin(request, BASE, 'ADMIN');
    const res = await api('GET', '/api/v1/suggestions?page=1&pageSize=50');
    expect(res.status).toBe(200);
    expect(res.body.pagination.pageSize).toBe(50);
    expect(rows(res.body).length).toBeLessThanOrEqual(50);
  });

  test('out-of-contract params are rejected with 400', async ({ request }) => {
    const api = await apiLogin(request, BASE, 'ADMIN');
    for (const path of [
      '/api/v1/components?page=0',
      '/api/v1/components?pageSize=101',
      '/api/v1/components?sort=notAKey',
      '/api/v1/components?bogusParam=1',
    ]) {
      const res = await api('GET', path);
      expect(res.status, path).toBe(400);
    }
  });
});
