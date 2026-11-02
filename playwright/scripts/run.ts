import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  loadWorkloadEnv, loadPrivateEnv, PRIVATE_DIR, PLAYWRIGHT_DIR, COMPOSE_PROJECT,
} from './env.js';
import { runPreflight } from './preflight.js';
import { generatePrivateMaterial, privateMaterialExists } from './private-material.js';
import { writeDexConfig } from './dex-config.js';
import { composeBuild, composeUp, composeDown, waitHttp, compose } from './compose.js';
import { captureNormalStackState, diffNormalStack } from './normal-stack.js';

const debug = process.argv.includes('--debug');

async function main() {
  const env = loadWorkloadEnv();
  console.log(`[e2e] preflight ${COMPOSE_PROJECT} (debug=${debug})`);
  await runPreflight(env, { allowLeftover: false });

  mkdirSync(PRIVATE_DIR, { recursive: true });
  const material = generatePrivateMaterial(PRIVATE_DIR);
  writeDexConfig(PRIVATE_DIR);
  const secrets = loadPrivateEnv();

  const composeEnv = {
    ...process.env,
    ...secrets,
    PW_APP_PORT: String(env.appHostPort),
    PW_HTTP_PORT: String(env.httpHostPort),
    PW_HTTPS_PORT: String(env.httpsHostPort),
    PW_PG_PORT: String(env.pgHostPort),
  };

  const normalBefore = captureNormalStackState();
  let stackUp = false;
  try {
    console.log('[e2e] building images');
    composeBuild(composeEnv);
    console.log('[e2e] starting base services');
    composeUp(composeEnv);
    stackUp = true;

    const appHttp = `http://127.0.0.1:${env.appHostPort}`;
    await waitHttp(`${appHttp}/api/v1/health`, 180_000);
    console.log('[e2e] app healthy; seeding');

    const childEnv = {
      ...process.env, ...secrets,
      NODE_EXTRA_CA_CERTS: material.caCrtPath,
      PW_APP_HTTP_URL: appHttp,
      PW_PG_URL: `postgres://postgres:${encodeURIComponent(secrets.PWP_POSTGRES_PASSWORD ?? '')}@127.0.0.1:${env.pgHostPort}/componode_pw`,
      PW_PRIVATE_DIR: PRIVATE_DIR,
    };
    execFileSync('pnpm', ['exec', 'tsx', 'scripts/seed.ts'], { cwd: PLAYWRIGHT_DIR, env: childEnv, stdio: 'inherit' });

    console.log('[e2e] starting Import Agent');
    compose(['up', '-d', '--scale', 'agent=1'], composeEnv);

    console.log('[e2e] running suite');
    execFileSync('docker', [
      'compose', '-f', `${PLAYWRIGHT_DIR}/compose.test.yml`,
      '--project-name', COMPOSE_PROJECT, '--project-directory', PLAYWRIGHT_DIR,
      'run', '--rm', 'runner', 'pnpm', 'exec', 'playwright', 'test',
    ], { env: composeEnv, stdio: 'inherit' });
    console.log('[e2e] suite finished');
  } finally {
    if (stackUp && !debug) {
      console.log('[e2e] tearing down');
      composeDown(composeEnv);
    } else if (stackUp) {
      console.log(`[e2e:debug] stack retained — cleanup with \`pnpm run e2e:down\` in playwright/`);
    }
    const drift = diffNormalStack(normalBefore, captureNormalStackState());
    if (drift.length) {
      console.warn(`[e2e] WARNING: normal stack state changed: ${drift.join(', ')}`);
    }
  }
}

main().catch((err) => {
  console.error(`[e2e] FAILED: ${(err as Error).message}`);
  process.exit(1);
});

export { privateMaterialExists };
export const reportsDir = join(PLAYWRIGHT_DIR, 'playwright-report');
export function agentTokenPath(): string {
  return join(PRIVATE_DIR, 'agent-token');
}
export function writeAgentToken(token: string): void {
  writeFileSync(agentTokenPath(), token, { mode: 0o600 });
}
