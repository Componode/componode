import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { seedBulk } from '../data/seed-bulk.js';
import { seedAppFlows } from '../data/seed-app-flows.js';
import { PRIVATE_DIR } from './env.js';

async function main() {
  const privateDir =
    process.env.PW_PRIVATE_DIR ??
    (existsSync('/pw-private/env') ? '/pw-private' : PRIVATE_DIR);
  const env = Object.fromEntries(
    readFileSync(join(privateDir, 'env'), 'utf8')
      .split('\n').filter((l) => l.includes('='))
      .map((l) => l.split('=', 2) as [string, string]),
  );
  // Runs inside the workload network — internal service names by default.
  const pgUrl =
    process.env.PW_PG_URL ??
    `postgres://postgres:${encodeURIComponent(env.PWP_POSTGRES_PASSWORD ?? '')}@postgres:5432/componode_pw`;
  const appHttp = process.env.PW_APP_HTTP_URL ?? 'http://app:3000';

  console.log('[seed] bulk fixtures');
  const bulk = await seedBulk(pgUrl);

  console.log('[seed] application flows');
  const result = await seedAppFlows(appHttp, pgUrl, env, {
    githubBase: 'https://mock-github:9443',
    alibabaEndpoint: 'mock-alibaba:9443',
    webFixture: 'http://web-fixture.mock.test:9080/web',
    apiFixture: 'http://api-fixture.mock.test:9080/api',
    dockerHost: 'mock-docker-engine',
    dockerCa: readFileSync(join(privateDir, 'ca.crt'), 'utf8'),
    dockerCert: readFileSync(join(privateDir, 'certs/docker-client.crt'), 'utf8'),
    dockerKey: readFileSync(join(privateDir, 'certs/docker-client.key'), 'utf8'),
  });

  if (result.agentToken) {
    writeFileSync(join(privateDir, 'out', 'agent-token'), result.agentToken, { mode: 0o644 });
    console.log('[seed] agent enrollment token stored under .env-private/');
  }
  writeFileSync(
    join(privateDir, 'out', 'seed-result.json'),
    JSON.stringify({ ...result, agentToken: undefined, componentIds: bulk.componentIds }, null, 2),
    { mode: 0o644 },
  );
  console.log('[seed] complete');
}

main().catch((err) => {
  console.error(`[seed] FAILED: ${(err as Error).message}`);
  process.exit(1);
});
