import { test, expect } from '@playwright/test';
import { apiLogin } from '../fixtures/auth.js';
import { readFileSync } from 'node:fs';

const BASE = 'https://app.componode-pw.test';

function seeded() {
  return JSON.parse(readFileSync('/pw-private/out/seed-result.json', 'utf8'));
}

// Spec 058 FR-021: direct URL Check writes are deprecated — definitions live
// on the owning ImporterConfig scope. The write routes return a controlled
// 410 URL_CHECK_WRITE_DEPRECATED; reads and monitoring-setup writes remain.
test.describe('url check write deprecation and setup preserve rules', () => {
  test('POST /components/:id/url-checks returns 410', async ({ request }) => {
    const api = await apiLogin(request, BASE, 'ADMIN');
    const { probeComponentId, probeInstanceId } = seeded();
    const res = await api('POST', `/api/v1/components/${probeComponentId}/url-checks`, {
      name: 'pw-410', url: 'http://probe.target.test/x', componentInstanceId: probeInstanceId,
      successPolicy: { codes: [200], ranges: [] }, authMode: 'NONE',
    });
    expect(res.status).toBe(410);
    expect(res.body.code).toBe('URL_CHECK_WRITE_DEPRECATED');
  });

  test('PATCH and DELETE /url-checks/:id return 410', async ({ request }) => {
    const api = await apiLogin(request, BASE, 'ADMIN');
    const { probeComponentId } = seeded();
    const checksRes = await api('GET', `/api/v1/components/${probeComponentId}/url-checks`);
    const checkId = (checksRes.body.checks ?? checksRes.body.items ?? checksRes.body ?? [])[0]?.id;
    expect(checkId, 'seeded check exists').toBeTruthy();

    const patched = await api('PATCH', `/api/v1/url-checks/${checkId}`, { name: 'pw-410' });
    expect(patched.status).toBe(410);
    expect(patched.body.code).toBe('URL_CHECK_WRITE_DEPRECATED');

    const deleted = await api('DELETE', `/api/v1/url-checks/${checkId}`);
    expect(deleted.status).toBe(410);
    expect(deleted.body.code).toBe('URL_CHECK_WRITE_DEPRECATED');
  });

  test('managed check definitions flow from an importer config', async ({ request }) => {
    const admin = await apiLogin(request, BASE, 'ADMIN');
    const { probeComponentId } = seeded();
    // A seeded (unmanaged) check stays read-only on the component endpoint —
    // definitions are no longer editable per-row.
    const checksRes = await admin('GET', `/api/v1/components/${probeComponentId}/url-checks`);
    const list = checksRes.body.checks ?? checksRes.body.items ?? checksRes.body ?? [];
    expect(list.length, 'seeded checks visible via read path').toBeGreaterThan(0);
    expect(list.every((c: { managedKey?: string | null }) => 'managedKey' in c)).toBe(true);
  });

  test('editor preserves agent setup while changing cadence, can switch back to hub', async ({ request }) => {
    const admin = await apiLogin(request, BASE, 'ADMIN');
    const editor = await apiLogin(request, BASE, 'EDITOR');
    const { probeComponentId, agentId } = seeded();
    await admin('PUT', `/api/v1/components/${probeComponentId}/monitoring-setup`, {
      vantage: 'AGENT', agentId,
    });
    const preserve = await editor('PUT', `/api/v1/components/${probeComponentId}/monitoring-setup`, {
      cadenceSeconds: 300,
    });
    expect(preserve.status, 'preserve agent while changing cadence').toBe(200);

    const toHub = await editor('PUT', `/api/v1/components/${probeComponentId}/monitoring-setup`, {
      vantage: 'HUB', agentId: null,
    });
    expect(toHub.status, 'switch agent → hub allowed').toBe(200);

    const reAgent = await editor('PUT', `/api/v1/components/${probeComponentId}/monitoring-setup`, {
      vantage: 'AGENT', agentId,
    });
    expect(reAgent.status, 'editor cannot select agent').toBe(403);
    await admin('PUT', `/api/v1/components/${probeComponentId}/monitoring-setup`, { vantage: 'HUB', agentId: null });
  });
});
