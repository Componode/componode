import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { COMPOSE_PROJECT, PLAYWRIGHT_DIR } from './env.js';

const execFileP = promisify(execFile);

export function composeArgs(extra: string[] = []): string[] {
  return [
    'compose',
    '-f', `${PLAYWRIGHT_DIR}/compose.test.yml`,
    '--project-name', COMPOSE_PROJECT,
    '--project-directory', PLAYWRIGHT_DIR,
    ...extra,
  ];
}

/** Fail-closed guard — this helper may only ever target the workload project. */
export function guardComposeArgv(argv: string[]): void {
  const joined = argv.join(' ');
  if (!joined.includes(`--project-name ${COMPOSE_PROJECT}`)) {
    throw new Error(`compose invocation missing --project-name ${COMPOSE_PROJECT}`);
  }
  if (/\b(system|builder|image|container|volume|network)\s+prune\b|\bprune\b/.test(joined)) {
    throw new Error('docker prune operations are forbidden in the workload orchestrator');
  }
}

export function compose(argv: string[], env: NodeJS.ProcessEnv = {}): string {
  guardComposeArgv(composeArgs(argv));
  return execFileSync('docker', composeArgs(argv), {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  }).toString();
}

export async function composeAsync(argv: string[], env: NodeJS.ProcessEnv = {}) {
  guardComposeArgv(composeArgs(argv));
  return execFileP('docker', composeArgs(argv), {
    env: { ...process.env, ...env },
    maxBuffer: 32 * 1024 * 1024,
  });
}

export function composeBuild(env: NodeJS.ProcessEnv): void {
  compose(['build', '--quiet'], env);
}

export function composeUp(env: NodeJS.ProcessEnv, services: string[] = []): void {
  compose(['up', '-d', '--wait', ...services], env);
}

export function composeDown(env: NodeJS.ProcessEnv = {}): void {
  try {
    compose(['down', '-v', '--remove-orphans'], env);
  } catch {
    // down is best-effort during failure cleanup.
  }
}

export async function waitHealthy(service: string, env: NodeJS.ProcessEnv, timeoutMs = 120_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const out = compose(['ps', '--format', '{{.Service}} {{.Health}}'], env);
      const line = out.split('\n').find((l) => l.trim().startsWith(`${service} `));
      if (line && /healthy/.test(line)) return;
      if (line && /unhealthy/.test(line)) throw new Error(`service ${service} is unhealthy`);
    } catch (err) {
      if ((err as Error).message.includes('unhealthy')) throw err;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`Timed out waiting for ${service} to become healthy`);
}

export async function waitHttp(url: string, timeoutMs = 120_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (res.ok) return;
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`Timed out waiting for ${url}: ${lastErr}`);
}
