import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ApiClient } from './http.js';
import { PRIVATE_DIR } from './env.js';

// Registers an additional (never-connected) Import Agent for offline/MISSED
// probe scenarios, and can re-issue a token for the primary agent. Token is
// only ever written under .env-private/.
async function main() {
  const appHttp = process.env.PW_APP_HTTP_URL ?? 'http://app:3000';
  const privateDir =
    process.env.PW_PRIVATE_DIR ??
    (existsSync('/pw-private/env') ? '/pw-private' : PRIVATE_DIR);
  const env = Object.fromEntries(
    readFileSync(join(privateDir, 'env'), 'utf8')
      .split('\n').filter((l) => l.includes('='))
      .map((l) => l.split('=', 2) as [string, string]),
  );
  const api = new ApiClient(appHttp);
  await api.login(env.PWP_ADMIN_USERNAME!, env.PWP_ADMIN_PASSWORD!);
  const offline = await api.post('/api/v1/agents', { name: `pw-offline-${env.PWP_RUN_ID}` });
  if (offline.status >= 400) throw new Error(`offline agent create failed: ${offline.status}`);
  const agentId = offline.body.agent?.id ?? offline.body.id;
  const enroll = await api.post(`/api/v1/agents/${agentId}/enroll`, {});
  const token = enroll.body.enrollment?.token ?? enroll.body.token ?? '';
  writeFileSync(join(privateDir, 'out', 'offline-agent-token'), token, { mode: 0o644 });
  console.log(`[enroll-agent] offline agent registered: ${agentId} (token in .env-private/)`);
}

main().catch((err) => {
  console.error(`[enroll-agent] FAILED: ${(err as Error).message}`);
  process.exit(1);
});
