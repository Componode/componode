import { execFileSync } from 'node:child_process';
import { connect } from 'node:net';
import { existsSync } from 'node:fs';
import {
  COMPOSE_PROJECT,
  NORMAL_COMPOSE_PROJECT,
  NORMAL_STACK_PORTS,
  PLAYWRIGHT_DIR,
  REPO_ROOT,
  type WorkloadEnv,
} from './env.js';

export class PreflightError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PreflightError';
  }
}

export function assertComposeProject(name: string): void {
  if (name !== COMPOSE_PROJECT) {
    throw new PreflightError(
      `Compose project must be exactly "${COMPOSE_PROJECT}" (got "${name}"). ` +
        `The workload refuses to run under any other project name so it can never ` +
        `touch the normal "${NORMAL_COMPOSE_PROJECT}" stack.`,
    );
  }
}

export function assertEnvSafe(env: WorkloadEnv): void {
  const ports = [env.appHostPort, env.httpHostPort, env.httpsHostPort, env.pgHostPort];
  for (const p of ports) {
    if (NORMAL_STACK_PORTS.has(p)) {
      throw new PreflightError(
        `Test host port ${p} collides with the normal Componode stack defaults ` +
          `(${[...NORMAL_STACK_PORTS].join(', ')}). Override it in playwright/.env.test.`,
      );
    }
  }
  if (new Set(ports).size !== ports.length) {
    throw new PreflightError(`Test host ports must be distinct: ${ports.join(', ')}`);
  }
  const base = new URL(env.baseURL);
  if (base.protocol !== 'https:') {
    throw new PreflightError(`PW_BASE_URL must be https: (got ${env.baseURL})`);
  }
  if (!base.hostname.endsWith('.test')) {
    throw new PreflightError(
      `PW_BASE_URL host must be a .test name inside the workload network (got ${base.hostname})`,
    );
  }
}

export function assertDockerAvailable(): void {
  try {
    execFileSync('docker', ['version', '--format', '{{.Server.Version}}'], { stdio: 'pipe' });
  } catch {
    throw new PreflightError('Docker Engine is not available. Start Docker and retry.');
  }
  try {
    execFileSync('docker', ['compose', 'version', '--short'], { stdio: 'pipe' });
  } catch {
    throw new PreflightError('Docker Compose v2 is not available.');
  }
}

export function assertRepoLayout(): void {
  if (!existsSync(`${REPO_ROOT}/Dockerfile`)) {
    throw new PreflightError(`Root Dockerfile not found at ${REPO_ROOT}`);
  }
  if (!existsSync(`${PLAYWRIGHT_DIR}/compose.test.yml`)) {
    throw new PreflightError('playwright/compose.test.yml is missing');
  }
}

function portFree(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const socket = connect({ port, host }, () => {
      socket.destroy();
      resolvePromise(false);
    });
    socket.on('error', () => resolvePromise(true));
    socket.setTimeout(1500, () => {
      socket.destroy();
      resolvePromise(true);
    });
  });
}

export async function assertPortsFree(ports: number[]): Promise<void> {
  const busy: number[] = [];
  for (const p of ports) {
    if (!(await portFree(p))) busy.push(p);
  }
  if (busy.length) {
    throw new PreflightError(
      `Host port(s) already in use: ${busy.join(', ')}. ` +
        `Stop the conflicting service or override the port in playwright/.env.test.`,
    );
  }
}

export function assertNoLeftoverStack(): void {
  let out = '';
  try {
    out = execFileSync(
      'docker',
      ['ps', '-a', '--filter', `label=com.docker.compose.project=${COMPOSE_PROJECT}`, '-q'],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    ).toString();
  } catch {
    return;
  }
  if (out.trim()) {
    throw new PreflightError(
      `A previous "${COMPOSE_PROJECT}" stack still exists. ` +
        `Run \`pnpm run e2e:down\` in playwright/ first — the workload refuses ` +
        `to silently reuse a debug stack's data.`,
    );
  }
}

export async function runPreflight(env: WorkloadEnv, opts: { allowLeftover?: boolean } = {}) {
  assertComposeProject(env.composeProject);
  assertEnvSafe(env);
  assertRepoLayout();
  assertDockerAvailable();
  await assertPortsFree([env.appHostPort, env.httpHostPort, env.httpsHostPort, env.pgHostPort]);
  if (!opts.allowLeftover) assertNoLeftoverStack();
}
