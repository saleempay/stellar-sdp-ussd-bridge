#!/usr/bin/env node
/**
 * Stop the SDP stack. Data stays in the Docker volume so the tenant survives
 * a restart; pass --reset to remove the volume as well (the tenant, its
 * users and its distribution account record are then gone).
 */
import { spawnSync } from 'node:child_process';
import { composeEnvironment, loadEnvFile } from '../dist/index.js';

const COMPOSE = ['compose', '--env-file', 'sdp/.env', '-f', 'sdp/docker-compose.yml'];
const reset = process.argv.includes('--reset');
// compose runs with PATH, the file and the computed volume name only
let composeEnv;
try { composeEnv = composeEnvironment(loadEnvFile('sdp/.env')); } catch (e) { console.error(e.message); process.exit(2); }
const r = spawnSync('docker', [...COMPOSE, 'down', ...(reset ? ['--volumes'] : [])], { stdio: 'inherit', env: composeEnv });
process.exit(r.status ?? 1);
