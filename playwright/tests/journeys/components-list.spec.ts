import { test, expect } from '@playwright/test';
import { loginPage } from '../fixtures/auth.js';

test.describe('components list', () => {
  test('UI paginates server-side and keeps state in the URL @smoke', async ({ page }) => {
    await loginPage(page, 'VIEWER');
    await page.goto('/components');
    // Spec 068: the page renders one server page (25 rows) plus the pager —
    // it no longer fetches the whole catalog client-side.
    await expect(page.getByText(/1–25 of \d+/)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: 'Page 2' })).toBeVisible();

    // Pager navigation round-trips through ?page= and refreshes the range.
    await page.getByRole('button', { name: 'Page 2' }).click();
    await expect(page).toHaveURL(/page=2/);
    await expect(page.getByText(/26–50 of \d+/)).toBeVisible();

    // URL-backed search narrows server-side to the single bulk fixture.
    await page.goto('/components?q=PW%20Bulk%20200');
    await expect(page.getByText('PW Bulk 200', { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/1–1 of 1/)).toBeVisible();
  });
});
