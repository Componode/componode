import pg from 'pg';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { PRIVATE_DIR } from './env.js';

// Truncates every application table. Runs inside the workload network; the
// caller restarts the app afterwards so the empty-persons bootstrap recreates
// the admin account.
const privateDir =
  process.env.PW_PRIVATE_DIR ??
  (existsSync('/pw-private/env') ? '/pw-private' : PRIVATE_DIR);
const env = Object.fromEntries(
  readFileSync(join(privateDir, 'env'), 'utf8')
    .split('\n').filter((l) => l.includes('='))
    .map((l) => l.split('=', 2) as [string, string]),
);
const pgUrl =
  process.env.PW_PG_URL ??
  `postgres://postgres:${encodeURIComponent(env.PWP_POSTGRES_PASSWORD ?? '')}@postgres:5432/componode_pw`;

const client = new pg.Client({ connectionString: pgUrl });
await client.connect();
try {
  const { rows } = await client.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name NOT LIKE 'kysely_%'`,
  );
  if (rows.length) {
    await client.query(`TRUNCATE ${rows.map((r) => `"${r.table_name}"`).join(', ')} CASCADE`);
  }
  console.log(`[reset-db] truncated ${rows.length} tables`);
} finally {
  await client.end();
}
