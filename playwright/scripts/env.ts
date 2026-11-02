import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseDotenv } from 'dotenv';

export const PLAYWRIGHT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const REPO_ROOT = resolve(PLAYWRIGHT_DIR, '..');

export const COMPOSE_PROJECT = 'componode-pw';
export const NORMAL_COMPOSE_PROJECT = 'componode';
export const PRIVATE_DIR = resolve(PLAYWRIGHT_DIR, '.env-private');
export const AUTH_DIR = resolve(PLAYWRIGHT_DIR, '.auth');

export interface WorkloadEnv {
  composeProject: string;
  appHostPort: number;
  httpHostPort: number;
  httpsHostPort: number;
  pgHostPort: number;
  baseURL: string;
}

const DEFAULTS = {
  appHostPort: 3300,
  httpHostPort: 8080,
  httpsHostPort: 8443,
  pgHostPort: 5544,
};

function readEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  return parseDotenv(readFileSync(path));
}

function intFrom(name: string, raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    throw new Error(`Invalid port for ${name}: ${raw}`);
  }
  return n;
}

/** Ports used by the normal Componode stack — the test workload must not use them. */
export const NORMAL_STACK_PORTS = new Set([3000, 5432, 80, 443]);

export function loadWorkloadEnv(envFile = resolve(PLAYWRIGHT_DIR, '.env.test')): WorkloadEnv {
  const file = readEnvFile(envFile);
  const merged = { ...file, ...process.env };
  const appHostPort = intFrom('PW_APP_PORT', merged.PW_APP_PORT, DEFAULTS.appHostPort);
  const httpHostPort = intFrom('PW_HTTP_PORT', merged.PW_HTTP_PORT, DEFAULTS.httpHostPort);
  const httpsHostPort = intFrom('PW_HTTPS_PORT', merged.PW_HTTPS_PORT, DEFAULTS.httpsHostPort);
  const pgHostPort = intFrom('PW_PG_PORT', merged.PW_PG_PORT, DEFAULTS.pgHostPort);
  return {
    composeProject: merged.PW_COMPOSE_PROJECT ?? COMPOSE_PROJECT,
    appHostPort,
    httpHostPort,
    httpsHostPort,
    pgHostPort,
    baseURL: merged.PW_BASE_URL ?? 'https://app.componode-pw.test',
  };
}

/** Per-run generated secrets, written by private-material.ts into .env-private/env. */
export function loadPrivateEnv(dir = PRIVATE_DIR): Record<string, string> {
  return readEnvFile(resolve(dir, 'env'));
}

export function pgURL(pgHostPort: number, password: string): string {
  return `postgres://postgres:${encodeURIComponent(password)}@127.0.0.1:${pgHostPort}/componode_pw`;
}
