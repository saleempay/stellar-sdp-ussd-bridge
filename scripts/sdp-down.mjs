#!/usr/bin/env node
/**
 * Stop the SDP stack. Data stays in the Docker volume so the tenant survives
 * a restart; pass --reset to remove the volume as well (the tenant, its
 * users and its distribution account record are then gone).
 */
import { spawnSync } from 'node:child_process';
import { ConfigError, assertKeyLossAcknowledged, composeEnvironment, loadEnvFile, networkTypeOf } from '../dist/index.js';

const COMPOSE = ['compose', '--env-file', 'sdp/.env', '-f', 'sdp/docker-compose.yml'];
const reset = process.argv.includes('--reset');
// compose runs with PATH, the file and the computed volume name only
let composeEnv;
let fileEnv;
try { fileEnv = loadEnvFile('sdp/.env'); composeEnv = composeEnvironment(fileEnv); } catch (e) { console.error(e.message); process.exit(2); }
// --reset deletes the Postgres volume: under the DB vault type that is the
// only copy of every tenant distribution key, and in every case the channel
// account key. Off testnet it needs BRIDGE_ACKNOWLEDGE_KEY_LOSS=yes (the
// file or the process environment); on testnet nothing changes.
if (reset) {
  try {
    assertKeyLossAcknowledged({ ...fileEnv, ...process.env }, 'npm run sdp:down -- --reset', 'the Postgres volume, which holds every tenant distribution key of the DB vault type and the channel account key', [networkTypeOf(fileEnv)]);
  } catch (e) { if (e instanceof ConfigError) { console.error(e.message); process.exit(2); } throw e; }
}
const r = spawnSync('docker', [...COMPOSE, 'down', ...(reset ? ['--volumes'] : [])], { stdio: 'inherit', env: composeEnv });
process.exit(r.status ?? 1);
