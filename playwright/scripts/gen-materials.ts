import { loadWorkloadEnv, loadPrivateEnv } from './env.js';
import { runPreflight } from './preflight.js';
import { generatePrivateMaterial } from './private-material.js';
import { writeDexConfig } from './dex-config.js';

const env = loadWorkloadEnv();
await runPreflight(env, { allowLeftover: process.argv.includes('--allow-leftover') });
const m = await generatePrivateMaterial();
const dex = writeDexConfig();
console.log('materials OK:', m.caCrtPath, dex, loadPrivateEnv().PWP_RUN_ID);
