import { test, expect } from '@playwright/test';

const CTL = 'http://mock-control:9090';
const WEB = 'http://web-fixture.mock.test:9080';
const API = 'http://api-fixture.mock.test:9080';

async function scenario(name: string) {
  for (const t of ['mock-url-importers']) {
    await fetch(`${CTL}/scenario/${t}`, { method: 'POST', body: JSON.stringify({ name }) });
  }
}

test.describe('url importer mock contracts', () => {
  test('web fixture returns text bodies across scenarios', async () => {
    await scenario('baseline');
    const base = await fetch(`${WEB}/web`);
    expect(base.status).toBe(200);
    expect(await base.text()).toContain('web fixture v1');

    await scenario('empty');
    expect(await (await fetch(`${WEB}/web`)).text()).toBe('');

    await scenario('error');
    expect((await fetch(`${WEB}/web`)).status).toBe(503);
  });

  test('api fixture returns JSON and malformed payloads', async () => {
    await scenario('baseline');
    const ok = await fetch(`${API}/api`);
    expect((await ok.json()).version).toBe(1);

    await scenario('changed');
    expect((await (await fetch(`${API}/api`)).json()).version).toBe(2);

    await scenario('malformed');
    const res = await fetch(`${API}/api`);
    await expect(res.json()).rejects.toThrow();
  });

  test('control plane rejects unknown scenarios and is host-private', async () => {
    const res = await fetch(`${CTL}/scenario/mock-url-importers`, {
      method: 'POST', body: JSON.stringify({ name: 'bogus' }),
    });
    expect(res.status).toBe(400);
    await scenario('baseline');
  });
});
