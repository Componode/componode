import { execFileSync } from 'node:child_process';
import { NORMAL_COMPOSE_PROJECT } from './env.js';

/** Snapshot of the normal stack's container health — used as a sentinel. */
export interface NormalStackState {
  /** container-id → status string */
  containers: Record<string, string>;
}

export function captureNormalStackState(): NormalStackState {
  try {
    const out = execFileSync(
      'docker',
      ['ps', '-a', '--filter', `label=com.docker.compose.project=${NORMAL_COMPOSE_PROJECT}`,
        '--format', '{{.ID}} {{.Status}}'],
      { stdio: ['ignore', 'pipe', 'ignore'] },
    ).toString();
    const containers: Record<string, string> = {};
    for (const line of out.split('\n')) {
      const [id, ...rest] = line.trim().split(' ');
      if (id) containers[id] = rest.join(' ');
    }
    return { containers };
  } catch {
    return { containers: {} };
  }
}

/** Returns human-readable diffs; empty array means the normal stack is unchanged. */
export function diffNormalStack(before: NormalStackState, after: NormalStackState): string[] {
  const diffs: string[] = [];
  for (const [id, status] of Object.entries(before.containers)) {
    if (!(id in after.containers)) diffs.push(`container ${id} disappeared`);
    else if (after.containers[id] !== status) diffs.push(`container ${id} status "${status}" → "${after.containers[id]}"`);
  }
  for (const id of Object.keys(after.containers)) {
    if (!(id in before.containers)) diffs.push(`new container ${id} in normal project`);
  }
  return diffs;
}
