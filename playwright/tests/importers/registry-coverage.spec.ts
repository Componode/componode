import { test, expect } from '@playwright/test';
import { apiLogin } from '../fixtures/auth.js';
import { validateCoverage } from '../../scripts/validate-coverage.js';

const BASE = 'https://app.componode-pw.test';

test.describe('importer registry coverage guard', () => {
  test('registry advertises only the implemented + scaffold importers', async ({ request }) => {
    const api = await apiLogin(request, BASE, 'ADMIN');
    const res = await api('GET', '/api/v1/importers');
    expect(res.status).toBe(200);
    const names = (res.body.importers ?? res.body).map((i: any) => i.name);
    for (const n of ['github', 'alibaba-cloud', 'docker', 'web-url', 'api-url', 'aws', 'azure', 'kubernetes', 'mcp-server']) {
      expect(names).toContain(n);
    }
  });

  test('coverage guard passes for the current mock/test mapping', () => {
    const r = validateCoverage();
    expect(r.missing).toEqual([]);
  });
});
