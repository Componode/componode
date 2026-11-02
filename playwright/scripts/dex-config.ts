import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import bcrypt from 'bcryptjs';
import { PRIVATE_DIR } from './env.js';
import { loadPrivateEnv } from './env.js';

/** Render .env-private/dex.yaml from the per-run secrets. */
export function writeDexConfig(dir = PRIVATE_DIR): string {
  const env = loadPrivateEnv(dir);
  const hash = bcrypt.hashSync(env.PWP_DEX_USER_PASSWORD ?? 'unused', 10);
  const yaml = `issuer: https://dex.componode-pw.test
storage:
  type: sqlite3
  config:
    file: /tmp/dex.db
web:
  http: 0.0.0.0:5556
oauth2:
  skipApprovalScreen: true
staticClients:
  - id: ${env.PWP_OIDC_CLIENT_ID}
    redirectURIs:
      - https://app.componode-pw.test/api/v1/auth/oidc/callback
    name: componode-pw
    secret: ${env.PWP_OIDC_CLIENT_SECRET}
enablePasswordDB: true
staticPasswords:
  - email: ${env.PWP_DEX_USER_EMAIL}
    hash: "${hash}"
    username: dex-user
    userID: pw-dex-user-1
`;
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'dex.yaml');
  writeFileSync(path, yaml, { mode: 0o600 });
  return path;
}
