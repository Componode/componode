import { test, expect } from '@playwright/test';
import { loginPage } from '../fixtures/auth.js';

test.describe('components list', () => {
  test('UI auto-fetches all 201+ components across page boundaries @smoke', async ({ page }) => {
    await loginPage(page, 'VIEWER');
    await page.goto('/components');
    // The hook fetches every page automatically; wait for the complete set.
    await expect(page.getByText(/PW Bulk 200/, { exact: false })).toBeVisible({ timeout: 30_000 });
    const rows = page.getByText(/PW Bulk \d+/);
    await expect(async () => {
      expect(await rows.count()).toBeGreaterThanOrEqual(201);
    }).toPass({ timeout: 30_000 });
  });
});
