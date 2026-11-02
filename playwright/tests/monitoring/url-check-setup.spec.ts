import { test, expect } from '@playwright/test';
import { apiLogin } from '../fixtures/auth.js';
import { readFileSync } from 'node:fs';

const BASE = 'https://app.componode-pw.test';

function seeded() {
  return JSON.parse(readFileSync('/pw-private/seed-result.json', 'utf8'));
}

test.describe('url check setup and preserve-versus-reconfigure rules', () => {
  test('authConfig rejects reserved Authorization header names', async ({ request }) => {
    const api = await apiLogin(request, BASE, 'ADMIN');
    const { probeComponentId, probeInstanceId, urlCheckCredentialId } = seeded();
    const res = await api('POST', `/api/v1/components/${probeComponentId}/url-checks`, {
      name: 'pw-reserved', url: 'http://auth.target.test/x', componentInstanceId: probeInstanceId,
      successPolicy: { codes: [200], ranges: [] }, authMode: 'CUSTOM_HEADERS',
      credentialId: urlCheckCredentialId,
      authConfig: { headers: [{ name: 'Authorization', key: 'headerValue' }] },
    });
    expect(res.status).toBe(400);
  });

  test('editor preserves credential check while editing unrelated fields, cannot reconfigure', async ({ request }) => {
    const admin = await apiLogin(request, BASE, 'ADMIN');
    const editor = await apiLogin(request, BASE, 'EDITOR');
    const { probeComponentId, probeInstanceId, urlCheckCredentialId } = seeded();
    const created = await admin('POST', `/api/v1/components/${probeComponentId}/url-checks`, {
      name: 'pw-preserve', url: 'http://auth.target.test/p', componentInstanceId: probeInstanceId,
      successPolicy: { codes: [200], ranges: [] }, authMode: 'BEARER',
      credentialId: urlCheckCredentialId, authConfig: { tokenKey: 'bearerToken' },
    });
    const checkId = created.body.id ?? created.body.check?.id;

    const renamed = await editor('PATCH', `/api/v1/url-checks/${checkId}`, { name: 'pw-preserve-2' });
    expect(renamed.status, 'unchanged credential preserved').toBe(200);

    const reconfig = await editor('PATCH', `/api/v1/url-checks/${checkId}`, { authMode: 'BASIC' });
    expect(reconfig.status, 'auth mode change denied').toBe(403);
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
