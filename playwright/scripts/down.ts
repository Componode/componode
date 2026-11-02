import { loadWorkloadEnv, loadPrivateEnv } from './env.js';
import { composeDown } from './compose.js';

const env = loadWorkloadEnv();
const secrets = loadPrivateEnv();
console.log('[e2e:down] removing only the componode-pw Compose project');
composeDown({ ...process.env, ...secrets });
console.log('[e2e:down] done');
