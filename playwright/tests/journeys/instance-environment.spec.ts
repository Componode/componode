import { test, expect } from '@playwright/test';
import { loginPage, apiLogin } from '../fixtures/auth.js';

const BASE = 'https://app.componode-pw.test';

/** Spec 071: humans override a ComponentInstance's environment from the
 *  component detail Instances table; the override survives underneath the
 *  importer-reported value and resets back to it. */
test.describe('instance environment override (spec 071)', () => {
  test('editor overrides, sees provenance, resets — API confirms effective/reported', async ({ page, request }, testInfo) => {
    const run = `pw-ie-${testInfo.project.name.replace(/[^a-z0-9]+/gi, '-')}-${Date.now().toString(36)}`;
    const api = await apiLogin(request, BASE, 'EDITOR');

    const comp = await api('POST', '/api/v1/components', {
      name: `EnvComp ${run}`,
      slug: `envcomp-${run}`,
      category: 'WEB_ENDPOINT',
      provider: 'WEB_URL',
      resourceType: 'web:endpoint',
    });
    expect(comp.status).toBe(201);
    const componentId = comp.body.component?.id ?? comp.body.id;

    const inst = await api('POST', `/api/v1/components/${componentId}/instances`, {
      environment: 'PRODUCTION',
      url: 'https://svc.example.com',
    });
    expect(inst.status).toBe(201);
    const instanceId = inst.body.instance?.id ?? inst.body.id;

    await loginPage(page, 'EDITOR');
    await page.goto(`/components/envcomp-${run}?tab=overview`);

    // Baseline: reported Production, no override badge.
    const envCell = page.getByRole('cell', { name: /Production/ }).first();
    await expect(envCell).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('overridden', { exact: true })).toHaveCount(0);

    // Open the editor and pick Staging.
    await page.getByLabel('Edit environment').first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Importer reports Production')).toBeVisible();
    await dialog.locator('#ie-env').click();
    await page.getByRole('option', { name: 'Staging' }).click();
    await dialog.getByRole('button', { name: 'Save changes' }).click();
    await expect(dialog).toBeHidden();

    // Effective badge flips to Staging and the override marker appears.
    await expect(page.getByRole('cell', { name: /Staging/ }).first()).toBeVisible();
    await expect(page.getByText('overridden', { exact: true }).first()).toBeVisible();

    // API confirms effective=STAGING, reported=PRODUCTION, provenance set.
    const detail = await api('GET', `/api/v1/components/${componentId}`);
    expect(detail.status).toBe(200);
    const row = detail.body.component.instances.find((i: { id: string }) => i.id === instanceId);
    expect(row.environment).toBe('STAGING');
    expect(row.reportedEnvironment).toBe('PRODUCTION');
    expect(row.environmentOverride).toBe('STAGING');
    expect(row.environmentOverriddenBy).toBeTruthy();
    expect(row.environmentOverriddenAt).toBeTruthy();

    // Reopen: provenance copy + Reset affordance; reset restores reported.
    await page.getByLabel('Edit environment').first().click();
    await expect(dialog.getByText(/Override active/)).toBeVisible();
    await expect(dialog.getByText(/importer reports Production/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Reset to reported' }).click();
    await expect(dialog).toBeHidden();

    await expect(page.getByRole('cell', { name: /Production/ }).first()).toBeVisible();
    await expect(page.getByText('overridden', { exact: true })).toHaveCount(0);

    const cleared = await api('GET', `/api/v1/components/${componentId}`);
    const clearedRow = cleared.body.component.instances.find((i: { id: string }) => i.id === instanceId);
    expect(clearedRow.environment).toBe('PRODUCTION');
    expect(clearedRow.environmentOverride).toBeNull();
  });

  test('PATCH endpoint guards: viewer 403, bad env 400, unknown 404', async ({ request }) => {
    const run = `pw-ie-g-${Date.now().toString(36)}`;
    const api = await apiLogin(request, BASE, 'EDITOR');
    const comp = await api('POST', '/api/v1/components', {
      name: `EnvGuard ${run}`,
      slug: `envguard-${run}`,
      category: 'WEB_ENDPOINT',
      provider: 'WEB_URL',
      resourceType: 'web:endpoint',
    });
    const componentId = comp.body.component?.id ?? comp.body.id;
    const inst = await api('POST', `/api/v1/components/${componentId}/instances`, { environment: 'DEV' });
    const instanceId = inst.body.instance?.id ?? inst.body.id;

    expect((await api('PATCH', `/api/v1/component-instances/${instanceId}`, { environment: 'NOPE' })).status).toBe(400);
    expect((await api('PATCH', `/api/v1/component-instances/${instanceId}`, {})).status).toBe(400);
    expect((await api('PATCH', '/api/v1/component-instances/00000000-0000-0000-0000-000000000000', { environment: 'DEV' })).status).toBe(404);

    const viewer = await apiLogin(request, BASE, 'VIEWER');
    expect((await viewer('PATCH', `/api/v1/component-instances/${instanceId}`, { environment: 'PRODUCTION' })).status).toBe(403);
  });
});
