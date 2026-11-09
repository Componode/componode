import { test, expect, type Locator, type Page } from '@playwright/test';
import { loginPage, apiLogin } from '../fixtures/auth.js';

const BASE = 'https://app.componode-pw.test';

// Spec 068 / ADR-130 — every primary list shares one contract: page/size/
// sort/order/q and the filters live in the URL, the footer shows an
// "X–Y of Z" range with a 25/50/100 rows-per-page selector, column headers
// sort server-side, and title cells truncate into a hover/focus summary
// card rendered from the already-fetched list payload (no extra request).

/** ListPagination range text — e.g. "1–25 of 205" (en dash). */
const ROW_RANGE = /\d+–\d+ of \d+/;

/** Table body rows on a list page (the catalog table is the only tbody). */
const pageRows = (page: Page) => page.locator('tbody tr');

/** First row's component/product name — the title cell's only link text. */
const firstRowName = (rows: Locator) =>
  rows.first().locator('td').first().locator('a').innerText();

test.describe('list page standards (spec 068)', () => {
  // T045 — reported defect: "Gone instances" offered an "All" option that
  // snapped the control back; the domain is Hidden/Shown only and maps to
  // includeGone=false|true on the wire.
  test('gone-instances filter is Hidden/Shown only and persists via the URL', async ({ page, request }) => {
    // API ground truth for the visible-total delta — gone-only components
    // exist only if an importer scenario left GONE instances behind, so the
    // count assertions are driven by the live totals, not a fixture guess.
    const api = await apiLogin(request, BASE, 'VIEWER');
    const [hidden, shown] = await Promise.all([
      api('GET', '/api/v1/components?page=1&pageSize=1&includeRetired=true&includeGone=false'),
      api('GET', '/api/v1/components?page=1&pageSize=1&includeRetired=true&includeGone=true'),
    ]);
    expect(hidden.status).toBe(200);
    expect(shown.status).toBe(200);
    const hiddenTotal: number = hidden.body.pagination.total;
    const shownTotal: number = shown.body.pagination.total;

    await loginPage(page, 'VIEWER');
    await page.goto('/components');
    const range = page.getByText(ROW_RANGE);
    await expect(range).toBeVisible({ timeout: 30_000 });
    const clearButton = page.getByRole('button', { name: 'Clear', exact: true });
    const goneFilter = page.getByRole('combobox', { name: 'Gone instances' });

    // Defaults filter nothing — Clear stays hidden.
    await expect(clearButton).toHaveCount(0);

    // The dropdown's whole domain is Hidden + Shown — no phantom "All".
    await goneFilter.click();
    const listbox = page.getByRole('listbox');
    const options = listbox.getByRole('option');
    await expect(options).toHaveCount(2);
    await expect(options.nth(0)).toHaveText('Hidden');
    await expect(options.nth(1)).toHaveText('Shown');

    // "Shown" maps to includeGone=true and must stay selected — the defect
    // snapped the control back to Hidden.
    const [shownResponse] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes('/api/v1/components?') &&
          r.url().includes('includeGone=true') &&
          r.request().method() === 'GET',
      ),
      listbox.getByRole('option', { name: 'Shown', exact: true }).click(),
    ]);
    const shownBody = await shownResponse.json();
    expect(shownBody.pagination.total).toBe(shownTotal);
    await expect(page).toHaveURL(/gone=show/);
    await expect(goneFilter).toContainText('Shown');
    await expect(range).toHaveText(new RegExp(`\\d+–\\d+ of ${shownTotal}\\b`));

    // The choice survives a reload via ?gone=show (fresh client refetches).
    await expect(clearButton).toBeVisible();
    await page.reload();
    await expect(range).toBeVisible({ timeout: 30_000 });
    await expect(page).toHaveURL(/gone=show/);
    await expect(goneFilter).toContainText('Shown');
    await expect(range).toHaveText(new RegExp(`\\d+–\\d+ of ${shownTotal}\\b`));

    // Clear restores every default — the hidden-gone page is still fresh in
    // the query cache, so the restored UI is asserted without a wire wait.
    await clearButton.click();
    await expect(page).toHaveURL(/\/components$/);
    expect(new URL(page.url()).search).toBe('');
    await expect(goneFilter).toContainText('Hidden');
    await expect(clearButton).toHaveCount(0);
    await expect(range).toHaveText(new RegExp(`\\d+–\\d+ of ${hiddenTotal}\\b`));
  });

  // T047 — title cells truncate and reveal the curated summary card on
  // hover AND keyboard focus; content comes from the list payload (SC-006).
  test('component title cells truncate and show a hover/focus summary without fetches', async ({ page }) => {
    await loginPage(page, 'VIEWER');
    await page.goto('/components');
    const rows = pageRows(page);
    const firstRow = rows.first();
    await expect(firstRow).toBeVisible({ timeout: 30_000 });
    const titleLink = firstRow.locator('td').first().locator('a').first();
    await expect(titleLink).toHaveClass(/truncate/);

    // Values the card must mirror — read from the same row payload.
    const category = (await firstRow.locator('td').nth(1).innerText()).trim();
    const resourceType = (
      await firstRow.locator('td').nth(2).locator('code').innerText()
    ).trim();

    const componentRequests: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/api/v1/components')) componentRequests.push(r.url());
    });

    const card = page.locator('[data-slot="hover-card-content"]');
    await titleLink.hover();
    await expect(card).toBeVisible({ timeout: 15_000 });
    // The curated component allowlist renders all ten fields.
    await expect(card.locator('dt')).toHaveCount(10);
    await expect(card).toContainText('Provider');
    await expect(card).toContainText('Category');
    await expect(card).toContainText('Resource type');
    await expect(card).toContainText('Lifecycle');
    if (resourceType) await expect(card).toContainText(resourceType);
    if (category) await expect(card).toContainText(category);

    // The summary is payload-only — no component request may fire for it.
    await page.waitForTimeout(500);
    expect(componentRequests).toHaveLength(0);

    // Pointer leave dismisses the card.
    await page.mouse.move(0, 0);
    await expect(card).toBeHidden();

    // Keyboard focus opens the same card on a different row.
    const secondLink = rows.nth(1).locator('td').first().locator('a').first();
    await secondLink.focus();
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card.locator('dt')).toHaveCount(10);
    await expect(card).toContainText('Provider');
    await secondLink.evaluate((el) => (el as HTMLElement).blur());
    await expect(card).toBeHidden();
  });

  test('product title cells reveal the same hover summary', async ({ page }) => {
    await loginPage(page, 'VIEWER');
    await page.goto('/products');
    const firstRow = page.locator('tbody tr').first();
    await expect(firstRow).toBeVisible({ timeout: 30_000 });
    const titleLink = firstRow.locator('td').first().locator('a').first();
    await expect(titleLink).toHaveClass(/truncate/);

    const card = page.locator('[data-slot="hover-card-content"]');
    await titleLink.hover();
    await expect(card).toBeVisible({ timeout: 15_000 });
    // The curated product allowlist renders all seven fields.
    await expect(card.locator('dt')).toHaveCount(7);
    await expect(card).toContainText('Type');
    await expect(card).toContainText('Owner');
    await expect(card).toContainText('Criticality');
  });

  // T055 — the shared list standard exercised end-to-end on /components.
  test('components list paginates, sorts, resizes, and restores URL state @smoke', async ({ page }) => {
    await loginPage(page, 'VIEWER');
    await page.goto('/components');
    const range = page.getByText(ROW_RANGE);
    await expect(range).toBeVisible({ timeout: 30_000 });
    await expect(range).toHaveText(/1–25 of \d+/);
    const rows = pageRows(page);
    await expect(rows).toHaveCount(25);
    const firstName = (await firstRowName(rows)).trim();

    // Pager → ?page=2 with a different first row.
    await page.getByRole('button', { name: 'Page 2' }).click();
    await expect(page).toHaveURL(/page=2/);
    await expect(range).toHaveText(/26–50 of \d+/);
    const secondPageFirst = (await firstRowName(rows)).trim();
    expect(secondPageFirst).not.toBe(firstName);

    // Rows-per-page → ?size=50 (page resets), footer + row count follow.
    const sizeSelect = page.getByRole('combobox', { name: 'Rows per page' });
    await sizeSelect.click();
    const sizeOptions = page.getByRole('listbox').getByRole('option');
    await expect(sizeOptions).toHaveCount(3);
    await expect(sizeOptions.nth(0)).toHaveText('25');
    await expect(sizeOptions.nth(1)).toHaveText('50');
    await expect(sizeOptions.nth(2)).toHaveText('100');
    const [sizeResponse] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes('/api/v1/components?') &&
          r.url().includes('pageSize=50') &&
          r.request().method() === 'GET',
      ),
      sizeOptions.nth(1).click(),
    ]);
    expect(sizeResponse.status()).toBe(200);
    await expect(page).toHaveURL(/size=50/);
    await expect(page).not.toHaveURL(/page=/);
    await expect(rows).toHaveCount(50);
    await expect(range).toHaveText(/1–50 of \d+/);
    await expect(sizeSelect).toContainText('50');

    // Sortable header → ?sort=/?order= + aria-sort on the column.
    const categoryHead = page.getByRole('button', { name: 'Category' });
    await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes('/api/v1/components?') &&
          r.url().includes('sort=category') &&
          r.request().method() === 'GET',
      ),
      categoryHead.click(),
    ]);
    await expect(page).toHaveURL(/sort=category/);
    await expect(page.locator('th[aria-sort="ascending"]')).toContainText('Category');

    await categoryHead.click();
    await expect(page).toHaveURL(/order=desc/);
    await expect(page.locator('th[aria-sort="descending"]')).toContainText('Category');

    // Reload restores the whole list state from the URL — and the request
    // the page fires carries every restored param.
    const [reloadResponse] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes('/api/v1/components?') &&
          r.url().includes('pageSize=50') &&
          r.url().includes('sort=category') &&
          r.url().includes('order=desc') &&
          r.request().method() === 'GET',
      ),
      page.reload(),
    ]);
    expect(reloadResponse.status()).toBe(200);
    await expect(range).toBeVisible({ timeout: 30_000 });
    await expect(page).toHaveURL(/sort=category/);
    await expect(page).toHaveURL(/order=desc/);
    await expect(page).toHaveURL(/size=50/);
    await expect(range).toHaveText(/1–50 of \d+/);
    await expect(sizeSelect).toContainText('50');
    await expect(page.locator('th[aria-sort="descending"]')).toContainText('Category');
  });

  // T055 — same standard on a second primary list (/products).
  test('products list shares the footer, page-size, sort, and URL standard @smoke', async ({ page }) => {
    await loginPage(page, 'VIEWER');
    await page.goto('/products');
    const range = page.getByText(ROW_RANGE);
    await expect(range).toBeVisible({ timeout: 30_000 });
    const rows = pageRows(page);
    await expect(rows.first()).toBeVisible();

    // Footer + the 25/50/100 selector.
    const sizeSelect = page.getByRole('combobox', { name: 'Rows per page' });
    await sizeSelect.click();
    const sizeOptions = page.getByRole('listbox').getByRole('option');
    await expect(sizeOptions).toHaveCount(3);
    await expect(sizeOptions.nth(0)).toHaveText('25');
    await expect(sizeOptions.nth(1)).toHaveText('50');
    await expect(sizeOptions.nth(2)).toHaveText('100');
    const [sizeResponse] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes('/api/v1/products?') &&
          r.url().includes('pageSize=50') &&
          r.request().method() === 'GET',
      ),
      sizeOptions.nth(1).click(),
    ]);
    expect(sizeResponse.status()).toBe(200);
    await expect(page).toHaveURL(/size=50/);
    await expect(sizeSelect).toContainText('50');

    // Sortable header → ?sort= + aria-sort.
    const typeHead = page.getByRole('button', { name: 'Type' });
    await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes('/api/v1/products?') &&
          r.url().includes('sort=type') &&
          r.request().method() === 'GET',
      ),
      typeHead.click(),
    ]);
    await expect(page).toHaveURL(/sort=type/);
    await expect(page.locator('th[aria-sort="ascending"]')).toContainText('Type');

    // The seeded catalog fits one page today; if it ever grows past a page,
    // Page 2 must round-trip through ?page= like every other list.
    const pageTwo = page.getByRole('button', { name: 'Page 2' });
    if ((await pageTwo.count()) > 0) {
      const before = (await firstRowName(rows)).trim();
      await Promise.all([
        page.waitForResponse(
          (r) =>
            r.url().includes('/api/v1/products?') &&
            r.url().includes('page=2') &&
            r.request().method() === 'GET',
        ),
        pageTwo.click(),
      ]);
      await expect(page).toHaveURL(/page=2/);
      const after = (await firstRowName(rows)).trim();
      expect(after).not.toBe(before);
      await page.getByRole('button', { name: 'Page 1' }).click();
      await expect(page).not.toHaveURL(/page=/);
    }

    // Reload restores sort + page size from the URL — request included.
    const [reloadResponse] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes('/api/v1/products?') &&
          r.url().includes('pageSize=50') &&
          r.url().includes('sort=type') &&
          r.request().method() === 'GET',
      ),
      page.reload(),
    ]);
    expect(reloadResponse.status()).toBe(200);
    await expect(range).toBeVisible({ timeout: 30_000 });
    await expect(page).toHaveURL(/size=50/);
    await expect(page).toHaveURL(/sort=type/);
    await expect(sizeSelect).toContainText('50');
    await expect(page.locator('th[aria-sort="ascending"]')).toContainText('Type');
  });
});
