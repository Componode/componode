import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { COMPONENT_COUNT, RUN_PREFIX } from './pagination-fixtures.js';

const CATEGORIES = ['COMPUTE', 'DATABASE', 'STORAGE', 'NETWORK', 'API', 'REPOSITORY', 'JOB', 'LIBRARY'];
const PROVIDERS = ['OTHER', 'DOCKER', 'GITHUB', 'AWS'];
const ENVS = ['DEV', 'TEST', 'PRODUCTION'];

function uuid7(): string {
  // UUIDv7: timestamp prefix + random — adequate for fixture rows.
  const ts = Date.now().toString(16).padStart(12, '0');
  const rand = randomUUID().replace(/-/g, '').slice(12);
  return `${ts.slice(0, 8)}-${ts.slice(8)}-7${rand.slice(0, 3)}-${(parseInt(rand.slice(3, 5), 16) & 0x3fff | 0x8000).toString(16)}-${rand.slice(5, 17)}`;
}

/** Bulk deterministic catalog rows — constraints, FK order, UUIDv7, unique slugs. */
export async function seedBulk(pgUrl: string): Promise<{ componentIds: string[] }> {
  const client = new pg.Client({ connectionString: pgUrl });
  await client.connect();
  const componentIds: string[] = [];
  try {
    await client.query('BEGIN');
    for (let i = 0; i < COMPONENT_COUNT; i++) {
      const id = uuid7();
      componentIds.push(id);
      const slug = `pw-${RUN_PREFIX}-bulk-${String(i).padStart(3, '0')}`;
      await client.query(
        `INSERT INTO components (id, name, slug, category, provider, "resourceType", lifecycle)
         VALUES ($1,$2,$3,$4,$5,$6,'ACTIVE')`,
        [id, `PW Bulk ${i}`, slug, CATEGORIES[i % CATEGORIES.length], PROVIDERS[i % PROVIDERS.length], `pw-type-${i % 5}`],
      );
      // A subset gets a deterministic instance so environments/statuses exist.
      if (i % 10 === 0) {
        await client.query(
          `INSERT INTO component_instances (id, "componentId", environment, status, "externalId", slug)
           VALUES ($1,$2,$3,'RUNNING',$4,$5)`,
          [uuid7(), id, ENVS[i % ENVS.length], `pw-ext-${i}`, `${slug}-inst`],
        );
      }
    }
    // A RETIRED component — specs that exercise lifecycle denial need one
    // since retirement is reconciliation-driven, not a manual API action.
    const retiredId = uuid7();
    componentIds.push(retiredId);
    await client.query(
      `INSERT INTO components (id, name, slug, category, provider, "resourceType", lifecycle)
       VALUES ($1,$2,$3,'API','OTHER','pw-type-retired','RETIRED')`,
      [retiredId, `PW Retired ${RUN_PREFIX}`, `pw-${RUN_PREFIX}-retired`],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    await client.end();
  }
  return { componentIds };
}
