import { test, expect } from '@playwright/test';

const CTL = 'http://mock-control:9090';
const GH = 'https://mock-github:9443';
const auth = { authorization: 'Bearer x' };

async function scenario(name: string) {
  await fetch(`${CTL}/scenario/mock-github`, { method: 'POST', body: JSON.stringify({ name }) });
}

test.describe('github mock contracts', () => {
  test('orgs.get drives identity fallback semantics', async () => {
    await scenario('baseline');
    const ok = await fetch(`${GH}/orgs/pw-org`, { headers: auth });
    expect(ok.status).toBe(200);
    expect((await ok.json()).login).toBe('pw-org');

    await scenario('org-fallback');
    expect((await fetch(`${GH}/orgs/pw-org`, { headers: auth })).status).toBe(403);

    await scenario('server-error');
    expect((await fetch(`${GH}/orgs/pw-org`, { headers: auth })).status).toBe(500);
  });

  test('repos paginate via Link headers', async () => {
    await scenario('baseline');
    const p1 = await fetch(`${GH}/orgs/pw-org/repos?type=all&per_page=1`, { headers: auth });
    expect(p1.status).toBe(200);
    const link = p1.headers.get('link') ?? '';
    expect(link).toContain('rel="next"');
    const page1 = await p1.json();
    const p2 = await fetch(new URL(link.match(/<([^>]+)>/)![1]!).toString(), { headers: auth });
    const page2 = await p2.json();
    expect(page1.length + page2.length).toBeGreaterThanOrEqual(2);
  });

  test('capability endpoints degrade on 403 without global failure', async () => {
    await scenario('capability-failure');
    for (const p of ['/orgs/pw-org/teams', '/orgs/pw-org/actions/runners', '/orgs/pw-org/settings/billing/actions']) {
      expect((await fetch(`${GH}${p}`, { headers: auth })).status, p).toBe(403);
    }
    // Core endpoints still work.
    expect((await fetch(`${GH}/orgs/pw-org`, { headers: auth })).status).toBe(200);
  });

  test('omitted and empty scenarios alter the inventory deterministically', async () => {
    await scenario('omitted');
    const o = await (await fetch(`${GH}/orgs/pw-org/repos?per_page=100`, { headers: auth })).json();
    expect(o).toHaveLength(1);
    await scenario('empty');
    const e = await (await fetch(`${GH}/orgs/pw-org/repos?per_page=100`, { headers: auth })).json();
    expect(e).toHaveLength(0);
  });
});
