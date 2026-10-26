/**
 * Off testnet, `sdp:down -- --reset` and `sdp:accounts -- --force` destroy
 * the only copy of a key, so both refuse unless BRIDGE_ACKNOWLEDGE_KEY_LOSS=yes
 * is set. The message names what would be lost and never echoes a value. On
 * testnet nothing is asked. A fake `docker` on PATH records the compose call
 * (sdp:down) or answers "no such volume" (sdp:accounts --force), and the
 * faucet points at a closed local port so no run can fund anything.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const repo = resolve(process.cwd());
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

// a syntactically shaped placeholder, never a real key: the refusal must not echo it
const FAKE_SEED = 'S'.padEnd(56, 'B');
const ACK = 'BRIDGE_ACKNOWLEDGE_KEY_LOSS';

function scratch(fileEnv: Record<string, string> | null) {
  const dir = mkdtempSync(join(tmpdir(), 'bridge-keyloss-'));
  dirs.push(dir);
  mkdirSync(join(dir, 'sdp'));
  mkdirSync(join(dir, 'bin'));
  copyFileSync(join(repo, 'sdp', '.env.example'), join(dir, 'sdp', '.env.example'));
  if (fileEnv) writeFileSync(join(dir, 'sdp', '.env'), Object.entries(fileEnv).map(([k, v]) => `${k}=${v}\n`).join(''));
  // records every call, answers "no such volume" to `volume inspect`, succeeds otherwise
  writeFileSync(join(dir, 'bin', 'docker'), `#!/bin/sh\necho "$@" >> "${join(dir, 'docker-calls.log')}"\ncase "$1 $2" in "volume inspect") echo "Error response from daemon: no such volume" 1>&2; exit 1;; esac\nexit 0\n`);
  chmodSync(join(dir, 'bin', 'docker'), 0o755);
  return dir;
}

function run(script: string, dir: string, args: string[], env: Record<string, string> = {}) {
  const r = spawnSync(process.execPath, [join(repo, 'scripts', script), ...args], {
    cwd: dir, encoding: 'utf8',
    env: { PATH: `${join(dir, 'bin')}:/usr/bin:/bin`, HOME: process.env.HOME ?? '', FRIENDBOT_URL: 'http://127.0.0.1:9', ...env },
  });
  return { status: r.status, out: r.stdout, err: r.stderr };
}

const dockerCalls = (dir: string) => (existsSync(join(dir, 'docker-calls.log')) ? readFileSync(join(dir, 'docker-calls.log'), 'utf8') : '');

const testnetFile = { COMPOSE_PROJECT_NAME: 'sdp-bridge', NETWORK_TYPE: 'testnet', DISTRIBUTION_SEED: FAKE_SEED };
const otherFile = { COMPOSE_PROJECT_NAME: 'sdp-bridge', NETWORK_TYPE: 'othernet', DISTRIBUTION_SEED: FAKE_SEED };

describe('sdp-down.mjs --reset and the key loss acknowledgement', () => {
  it('off testnet without the acknowledgement: refused before Docker is called, naming the volume and the keys, echoing no value', () => {
    const dir = scratch(otherFile);
    const r = run('sdp-down.mjs', dir, ['--reset']);
    expect(r.status).toBe(2);
    expect(r.err).toContain('npm run sdp:down -- --reset refused on network type "othernet"');
    expect(r.err).toContain('Postgres volume');
    expect(r.err).toContain('tenant distribution key');
    expect(r.err).toContain('channel account key');
    expect(r.err).toContain(`${ACK}=yes`);
    expect(r.err).not.toContain(FAKE_SEED);
    expect(dockerCalls(dir)).toBe('');
  });

  it('off testnet with the acknowledgement: compose down --volumes runs', () => {
    const dir = scratch(otherFile);
    const r = run('sdp-down.mjs', dir, ['--reset'], { [ACK]: 'yes' });
    expect(r.status, r.err).toBe(0);
    expect(r.err).not.toContain(ACK);
    expect(dockerCalls(dir)).toContain('down --volumes');
  });

  it('off testnet without --reset: nothing is asked, compose down runs without --volumes', () => {
    const dir = scratch(otherFile);
    const r = run('sdp-down.mjs', dir, []);
    expect(r.status, r.err).toBe(0);
    expect(r.err).not.toContain(ACK);
    expect(dockerCalls(dir)).toContain('down');
    expect(dockerCalls(dir)).not.toContain('--volumes');
  });

  it('on testnet --reset is unchanged: no acknowledgement asked, compose down --volumes runs', () => {
    const dir = scratch(testnetFile);
    const r = run('sdp-down.mjs', dir, ['--reset']);
    expect(r.status, r.err).toBe(0);
    expect(r.err).not.toContain(ACK);
    expect(dockerCalls(dir)).toContain('down --volumes');
  });
});

describe('setup-sdp-accounts.mjs --force and the key loss acknowledgement', () => {
  it('off testnet (the existing file) without the acknowledgement: refused before the volume guard, naming every key that would be lost, echoing no value', () => {
    const dir = scratch(otherFile);
    const r = run('setup-sdp-accounts.mjs', dir, ['--force']);
    expect(r.status).toBe(2);
    expect(r.err).toContain('npm run sdp:accounts -- --force refused on network type "othernet"');
    for (const item of ['host distribution seed', 'SEP-10 seed', 'vault passphrases', 'admin key', 'JWT secret', 'EC key', 'owner passwords']) expect(r.err).toContain(item);
    expect(r.err).toContain(`${ACK}=yes`);
    expect(r.err).not.toContain(FAKE_SEED);
    expect(dockerCalls(dir)).toBe('');
    expect(readFileSync(join(dir, 'sdp', '.env'), 'utf8')).toContain(FAKE_SEED); // the file is untouched
  });

  it('off testnet (the configured network, the file on testnet) without the acknowledgement: refused, both sources are checked', () => {
    const dir = scratch(testnetFile);
    const r = run('setup-sdp-accounts.mjs', dir, ['--force'], { NETWORK_TYPE: 'othernet' });
    expect(r.status).toBe(2);
    expect(r.err).toContain('refused on network type "othernet"');
    expect(r.err).not.toContain(FAKE_SEED);
    expect(dockerCalls(dir)).toBe('');
  });

  it('off testnet with the acknowledgement: the key loss guard passes and the run proceeds to the volume guard', () => {
    const dir = scratch(otherFile);
    const r = run('setup-sdp-accounts.mjs', dir, ['--force'], { [ACK]: 'yes' });
    expect(r.err).not.toContain(ACK);
    expect(dockerCalls(dir)).toContain('volume inspect');
  });

  it('on testnet --force is unchanged: no acknowledgement asked, the run proceeds to the volume guard and fails at the closed faucet', () => {
    const dir = scratch(testnetFile);
    const r = run('setup-sdp-accounts.mjs', dir, ['--force']);
    expect(r.err).not.toContain(ACK);
    expect(dockerCalls(dir)).toContain('volume inspect');
    expect(r.status).toBe(1);
    expect(r.err).toMatch(/fetch failed|Friendbot funding failed/);
  });
});
