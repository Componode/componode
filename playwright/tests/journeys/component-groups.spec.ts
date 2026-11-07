import { test, expect } from '@playwright/test';
import { loginPage, apiLogin } from '../fixtures/auth.js';

const BASE = 'https://app.componode-pw.test';
const uid = () => `pw-cg-${Date.now().toString(36)}${Math.floor(Math.random() * 1e3)}`;

// Bugfix 066: the group detail page must list member components (the list
// filter contract is slug-based) and the Edit group dialog must offer the
// owning-team dropdown backed by GET /teams, including clearing ownership.
test.describe('component group detail', () => {
  test('members render and edit group manages owning team', async ({ page, request }) => {
    const api = await apiLogin(request, BASE, 'EDITOR');
    const run = uid();
    const groupSlug = `pw-cg-${run}`;

    const team = await api('POST', '/api/v1/teams', { name: `PW CG Team ${run}` });
    expect(team.status).toBe(201);
    const teamId = team.body.team?.id ?? team.body.id;
    const teamName = `PW CG Team ${run}`;

    const group = await api('POST', '/api/v1/component-groups', {
      name: `PW CG ${run}`, slug: groupSlug,
    });
    expect(group.status).toBe(201);
    const groupId = group.body.group?.id ?? group.body.id;

    for (const name of ['alpha-svc', 'beta-worker']) {
      const c = await api('POST', '/api/v1/components', {
        name: `${name}-${run}`, slug: `${name}-${run}`,
        category: 'CONTAINER', provider: 'DOCKER', resourceType: 'container',
        componentGroupId: groupId,
      });
      expect(c.status).toBe(201);
    }

    await loginPage(page, 'EDITOR');
    await page.goto(`/component-groups/${groupSlug}`);

    // Members table lists both assigned components.
    await expect(page.getByText(`alpha-svc-${run}`)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(`beta-worker-${run}`)).toBeVisible();

    // Edit group → Owning team dropdown lists teams; assign one.
    await page.getByRole('button', { name: 'Edit group' }).click();
    const teamSelect = page.getByLabel('Owning team');
    await expect(teamSelect).toBeVisible();
    await teamSelect.click();
    await page.getByRole('option', { name: teamName }).click();
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Group updated')).toBeVisible({ timeout: 10_000 });

    // Data integrity: the PATCH persisted teamOwnerId.
    const assigned = await api('GET', `/api/v1/component-groups/${groupId}`);
    expect(assigned.body.group.teamOwnerId).toBe(teamId);
    await expect(page.getByText(teamName).first()).toBeVisible();

    // Clearing: reopen, pick Unassigned, save → teamOwnerId null.
    await page.getByRole('button', { name: 'Edit group' }).click();
    await page.getByLabel('Owning team').click();
    await page.getByRole('option', { name: 'Unassigned' }).click();
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Group updated')).toBeVisible({ timeout: 10_000 });

    const cleared = await api('GET', `/api/v1/component-groups/${groupId}`);
    expect(cleared.body.group.teamOwnerId).toBeNull();
  });
});
