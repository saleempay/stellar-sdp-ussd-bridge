/**
 * The --force guard of scripts/setup-sdp-accounts.mjs fails closed: it lets
 * --force through only when Docker itself answers "no such volume". A fake
 * `docker` on PATH plays the three answers.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const repo = resolve(process.cwd());
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

function scratch(mode: 'exists' | 'absent' | 'down') {
  const dir = mkdtempSync(join(tmpdir(), 'bridge-force-'));
  dirs.push(dir);
  mkdirSync(join(dir, 'sdp'));
  mkdirSync(join(dir, 'bin'));
  copyFileSync(join(repo, 'sdp', '.env.example'), join(dir, 'sdp', '.env.example'));
  writeFileSync(join(dir, 'sdp', '.env'), 'COMPOSE_PROJECT_NAME=sdp-bridge\n');
  const script = {
    exists: '#!/bin/sh\necho "[{}]"\nexit 0\n',
    absent: '#!/bin/sh\necho "Error response from daemon: get sdp-bridge_postgres-db-testnet: no such volume" 1>&2\nexit 1\n',
    down: '#!/bin/sh\necho "Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?" 1>&2\nexit 1\n',
  }[mode];
  writeFileSync(join(dir, 'bin', 'docker'), script);
  chmodSync(join(dir, 'bin', 'docker'), 0o755);
  return dir;
}

const run = (dir: string) => spawnSync(process.execPath, [join(repo, 'scripts', 'setup-sdp-accounts.mjs'), '--force'], {
  cwd: dir, encoding: 'utf8',
  // the faucet points at a closed local port so a run that passes the guard fails right after it (connection refused), with no network call that could succeed
  env: { PATH: `${join(dir, 'bin')}:/usr/bin:/bin`, HOME: process.env.HOME ?? '', FRIENDBOT_URL: 'http://127.0.0.1:59999' },
});

describe('setup-sdp-accounts.mjs --force guard', () => {
  it('refuses when the volume exists', () => {
    const r = run(scratch('exists'));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('still exists');
  });

  it('refuses when Docker is not running, telling the operator to start it', () => {
    const r = run(scratch('down'));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('Docker did not confirm');
    expect(r.stderr).toContain('Start Docker first');
  });

  it('allows --force only when Docker answers "no such volume" (the run then proceeds to the faucet and fails there, by design of this test)', () => {
    const r = run(scratch('absent'));
    expect(r.stderr).not.toContain('--force refused');
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/fetch failed|Friendbot funding failed/);
  });
});
