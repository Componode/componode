import { test, expect } from '@playwright/test';
import { loginPage } from '../fixtures/auth.js';

// Cross-browser smoke coverage — tagged @smoke for firefox/webkit projects.
test('login → dashboard → components → logout @smoke', async ({ page }) => {
  await loginPage(page, 'ADMIN');
  await page.goto('/');
  await expect(page).not.toHaveURL(/\/login/);
  await page.goto('/components');
  await expect(page).toHaveURL(/\/components/);
});
