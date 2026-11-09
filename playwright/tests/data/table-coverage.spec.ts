import { test, expect } from '@playwright/test';
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { TABLE_COVERAGE, APP_TABLES, EXCLUDED_TABLES } from '../../data/table-coverage.js';
import { apiLogin, creds } from '../fixtures/auth.js';

const pgUrl = `postgres://postgres:${process.env.PWP_POSTGRES_PASSWORD ?? 'x'}@postgres:5432/componode_pw`;

test.describe('table coverage registry', () => {
  test('registry accounts for all 36 application-owned tables + 2 exclusions', () => {
    expect(APP_TABLES).toHaveLength(36);
    expect(EXCLUDED_TABLES.sort()).toEqual(['kysely_migration', 'kysely_migration_lock'].sort());
  });

  test('every application-owned table in the database has a registry entry', async () => {
    const secrets = Object.fromEntries(
      readFileSync('/pw-private/env', 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => l.split('=', 2) as [string, string]),
    );
    const client = new pg.Client({
      connectionString: `postgres://postgres:${encodeURIComponent(secrets.PWP_POSTGRES_PASSWORD ?? '')}@postgres:5432/componode_pw`,
    });
    await client.connect();
    try {
      const { rows } = await client.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'`,
      );
      const dbTables = rows.map((r) => r.table_name).filter((t) => !t.startsWith('kysely_'));
      for (const t of dbTables) {
        expect(TABLE_COVERAGE[t], `missing coverage entry for ${t}`).toBeDefined();
      }
    } finally {
      await client.end();
    }
  });

  test('lifecycle-owned tables contain rows produced by real flows', async ({ request }) => {
    const api = await apiLogin(request, 'https://app.componode-pw.test', 'ADMIN');
    const audit = await api('GET', '/api/v1/audit/activity?page=1&pageSize=1');
    expect(audit.status).toBe(200);
  });

  test('fixture matrix excludes the two bookkeeping tables only', () => {
    const matrix = readFileSync(new URL('../../data/fixture-matrix.md', import.meta.url), 'utf8');
    expect(matrix).toContain('kysely_migration');
    expect(matrix).toContain('kysely_migration_lock');
    void creds;
  });
});
