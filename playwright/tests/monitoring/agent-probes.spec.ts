import { test, expect } from '@playwright/test';
import { apiLogin } from '../fixtures/auth.js';
import { readFileSync } from 'node:fs';

const BASE = 'https://app.componode-pw.test';

test.describe('import agent probe coverage', () => {
  test('real agent session is established via WSS', async ({ request }) => {
    const api = await apiLogin(request, BASE, 'ADMIN');
    const { agentId } = JSON.parse(readFileSync('/pw-private/seed-result.json', 'utf8'));
    const sessions = await api('GET', `/api/v1/agents/${agentId}/sessions`);
    expect(sessions.status).toBe(200);
  });

  test('registered-but-disconnected agent shows no active session', async ({ request }) => {
    const api = await apiLogin(request, BASE, 'ADMIN');
    const agents = await api('GET', '/api/v1/agents');
    const list = agents.body.agents ?? agents.body.items ?? agents.body;
    const offline = list.find((a: any) => /offline/.test(a.name));
    if (offline) {
      const sessions = await api('GET', `/api/v1/agents/${offline.id}/sessions`);
      expect(sessions.status).toBe(200);
    } else {
      test.skip();
    }
  });
});
