import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ApiClient } from './http.js';
import { PRIVATE_DIR } from './env.js';

// Re-issues the primary agent's single-use enrollment token (e.g. after a
// manual call consumed it) and refreshes /pw-private/out/agent-token.
const privateDir =
  process.env.PW_PRIVATE_DIR ??
  (existsSync('/pw-private/env') ? '/pw-private' : PRIVATE_DIR);
const env = Object.fromEntries(
  readFileSync(join(privateDir, 'env'), 'utf8')
    .split('\n').filter((l) => l.includes('='))
    .map((l) => l.split('=', 2) as [string, string]),
);
const api = new ApiClient(process.env.PW_APP_HTTP_URL ?? 'http://app:3000');
await api.login(env.PWP_ADMIN_USERNAME!, env.PWP_ADMIN_PASSWORD!);
const seed = JSON.parse(readFileSync(join(privateDir, 'out', 'seed-result.json'), 'utf8'));
const res = await api.post(`/api/v1/agents/${seed.agentId}/enroll`, {});
if (res.status >= 400) throw new Error(`enroll failed: ${res.status} ${JSON.stringify(res.body)}`);
const token = res.body.enrollment?.token ?? res.body.token;
writeFileSync(join(privateDir, 'out', 'agent-token'), token, { mode: 0o644 });
console.log('[refresh-agent-token] re-issued for', seed.agentId);
