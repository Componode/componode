import { test, expect } from '@playwright/test';
import {
  assertComposeProject,
  assertEnvSafe,
  PreflightError,
} from '../../scripts/preflight.js';
import { loadWorkloadEnv, COMPOSE_PROJECT } from '../../scripts/env.js';

test.describe('preflight fail-closed rules', () => {
  test('rejects any Compose project name other than componode-pw', () => {
    for (const bad of ['componode', 'default', 'pw', `${COMPOSE_PROJECT}-x`, '']) {
      expect(() => assertComposeProject(bad)).toThrow(PreflightError);
    }
    expect(() => assertComposeProject('componode-pw')).not.toThrow();
  });

  test('rejects host ports that collide with the normal stack', () => {
    const base = loadWorkloadEnv();
    for (const field of ['appHostPort', 'httpHostPort', 'httpsHostPort', 'pgHostPort'] as const) {
      for (const badPort of [3000, 5432, 80, 443]) {
        const env = { ...base, [field]: badPort };
        expect(() => assertEnvSafe(env)).toThrow(PreflightError);
      }
    }
  });

  test('rejects duplicate test ports', () => {
    const base = loadWorkloadEnv();
    const env = { ...base, appHostPort: 8080, httpHostPort: 8080 };
    expect(() => assertEnvSafe(env)).toThrow(PreflightError);
  });

  test('rejects non-https and non-.test base URLs', () => {
    const base = loadWorkloadEnv();
    for (const bad of [
      'http://app.componode-pw.test',
      'https://localhost',
      'https://192.168.1.5',
      'https://app.example.com',
    ]) {
      expect(() => assertEnvSafe({ ...base, baseURL: bad })).toThrow(PreflightError);
    }
  });

  test('accepts the default workload environment', () => {
    expect(() => assertEnvSafe(loadWorkloadEnv())).not.toThrow();
  });
});
