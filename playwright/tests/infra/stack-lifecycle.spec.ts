import { test, expect } from '@playwright/test';
import { guardComposeArgv, composeArgs } from '../../scripts/compose.js';
import { COMPOSE_PROJECT } from '../../scripts/env.js';

test.describe('compose orchestration safety', () => {
  test('every compose invocation is scoped to the workload project', () => {
    const argv = composeArgs(['down', '-v']);
    expect(argv.join(' ')).toContain(`--project-name ${COMPOSE_PROJECT}`);
    expect(() => guardComposeArgv(argv)).not.toThrow();
  });

  test('prune operations are refused', () => {
    expect(() => guardComposeArgv(['compose', '--project-name', COMPOSE_PROJECT, 'system', 'prune'])).toThrow(/forbidden/i);
  });

  test('unscoped invocations are refused', () => {
    expect(() => guardComposeArgv(['compose', 'down'])).toThrow(/project-name/);
    expect(() => guardComposeArgv(['compose', '--project-name', 'componode', 'down'])).toThrow();
  });
});
