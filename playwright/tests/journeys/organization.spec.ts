import { test, expect } from '@playwright/test';
import { loginPage, apiLogin } from '../fixtures/auth.js';

const BASE = 'https://app.componode-pw.test';
const uid = () => `pw-o-${Date.now().toString(36)}${Math.floor(Math.random() * 1e3)}`;

test.describe('organization journeys', () => {
  test('admin manages LoB and team lifecycle', async ({ request }) => {
    const api = await apiLogin(request, BASE, 'ADMIN');
    const lob = await api('POST', '/api/v1/lobs', { name: `PW LOB ${uid()}`, slug: `${uid()}-lob` });
    expect(lob.status).toBe(201);
    const team = await api('POST', '/api/v1/teams', { name: `PW Team ${uid()}`, slug: `${uid()}-team`, lobId: lob.body.lob?.id ?? lob.body.id });
    expect(team.status).toBe(201);
  });

  test('admin browses users, teams, and LoB pages', async ({ page }) => {
    await loginPage(page, 'ADMIN');
    for (const route of ['/users', '/teams', '/lobs']) {
      await page.goto(route);
      await expect(page).toHaveURL(new RegExp(route));
    }
  });

  test('viewer cannot write organization records', async ({ request }) => {
    const api = await apiLogin(request, BASE, 'VIEWER');
    const res = await api('POST', '/api/v1/lobs', { name: `PW X ${uid()}`, slug: `${uid()}-x` });
    expect(res.status).toBe(403);
  });
});
