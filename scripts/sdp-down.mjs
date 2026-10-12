#!/usr/bin/env node
/**
 * Stop the SDP stack. Data stays in the Docker volume so the tenant survives
 * a restart; pass --reset to remove the volume as well (the tenant, its
 * users and its distribution account record are then gone).
 */
import { spawnSync } from 'node:child_process';

const COMPOSE = ['compose', '--env-file', 'sdp/.env', '-f', 'sdp/docker-compose.yml'];
const reset = process.argv.includes('--reset');
const r = spawnSync('docker', [...COMPOSE, 'down', ...(reset ? ['--volumes'] : [])], { stdio: 'inherit' });
process.exit(r.status ?? 1);
