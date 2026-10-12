/**
 * The two setup scripts with --no-fund: they generate and write the env
 * file without calling Friendbot, and print the explorer link from the
 * configured network. Each run happens in a temporary directory with the
 * repository's templates copied in, and FRIENDBOT_URL pointed at a closed
 * local port so any attempt to fund would fail the run.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { TESTNET_EXPLORER_BASE_URL } from '../../src/sdp/facts.js';

const repo = resolve(process.cwd());
const dirs: string[] = [];
const CLOSED_PORT_URL = 'http://127.0.0.1:9';

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'bridge-setup-'));
  mkdirSync(join(dir, 'sdp'));
  copyFileSync(join(repo, '.env.example'), join(dir, '.env.example'));
  copyFileSync(join(repo, 'sdp', '.env.example'), join(dir, 'sdp', '.env.example'));
  dirs.push(dir);
  return dir;
}

function run(script: string, cwd: string, args: string[], env: Record<string, string> = {}) {
  const r = spawnSync(process.execPath, [join(repo, 'scripts', script), ...args], {
    cwd,
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', FRIENDBOT_URL: CLOSED_PORT_URL, ...env },
  });
  return { status: r.status, out: r.stdout, err: r.stderr };
}

const seedPattern = /\bS[A-Z2-7]{55}\b/;

beforeAll(() => {
  if (!existsSync(join(repo, 'dist', 'index.js'))) {
    const b = spawnSync('npm', ['run', '-s', 'build'], { cwd: repo, encoding: 'utf8' });
    if (b.status !== 0) throw new Error(`build failed: ${b.stderr}`);
  }
});

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('setup-sponsor.mjs --no-fund', () => {
  it('writes .env with mode 600, calls no faucet, prints the explorer account link and no secret', () => {
    const dir = scratch();
    const r = run('setup-sponsor.mjs', dir, ['--no-fund']);
    expect(r.status, r.err).toBe(0);
    const envFile = readFileSync(join(dir, '.env'), 'utf8');
    expect(statSync(join(dir, '.env')).mode & 0o777).toBe(0o600);
    const pub = /^SPONSOR_PUBLIC_KEY=(G[A-Z2-7]{55})$/m.exec(envFile)?.[1];
    expect(pub).toBeDefined();
    expect(/^SPONSOR_SECRET_KEY=S[A-Z2-7]{55}$/m.test(envFile)).toBe(true);
    expect(r.out).toContain('Not funded (--no-fund)');
    expect(r.out).toContain(`${TESTNET_EXPLORER_BASE_URL}/account/${pub}`);
    expect(r.out).not.toMatch(seedPattern);
    expect(r.err).not.toMatch(seedPattern);
    const record = JSON.parse(readFileSync(join(dir, 'test-output', 'sponsor-funding.json'), 'utf8'));
    expect(record).toMatchObject({ funded: false, fundedAt: null, network: 'testnet' });
    expect(record.friendbotTxHash).toBeUndefined();
  });

  it('without --no-fund the Friendbot call is made (and fails against the closed port), so --no-fund is what skips it', () => {
    const dir = scratch();
    const r = run('setup-sponsor.mjs', dir, []);
    expect(r.status).toBe(1);
    expect(existsSync(join(dir, '.env'))).toBe(false);
  });

  it('refuses a non-testnet environment without the acknowledgement before generating anything', () => {
    const dir = scratch();
    const r = run('setup-sponsor.mjs', dir, ['--no-fund'], { NETWORK_TYPE: 'othernet' });
    expect(r.status).toBe(2);
    expect(r.err).toContain('network configuration refused');
    expect(r.err).toContain('BRIDGE_ACKNOWLEDGE_REAL_FUNDS');
    expect(existsSync(join(dir, '.env'))).toBe(false);
  });

  it('on another network with every value supplied, --no-fund prints that network\'s explorer link', () => {
    const dir = scratch();
    const r = run('setup-sponsor.mjs', dir, ['--no-fund'], {
      NETWORK_TYPE: 'othernet',
      NETWORK_PASSPHRASE: 'Other Network ; Example Only',
      HORIZON_URL: 'https://horizon.example.test',
      ASSET_ISSUER: 'G'.padEnd(56, 'A'),
      EXPLORER_BASE_URL: 'https://explorer.example.test/other',
      BRIDGE_ACKNOWLEDGE_REAL_FUNDS: 'yes',
    });
    expect(r.status, r.err).toBe(0);
    expect(r.out).toContain('https://explorer.example.test/other/account/G');
    expect(r.out).toContain('network othernet');
  });
});

describe('setup-sdp-accounts.mjs --no-fund', () => {
  it('writes sdp/.env with mode 600 and every key filled, calls no faucet, prints the explorer account link and no secret', () => {
    const dir = scratch();
    const r = run('setup-sdp-accounts.mjs', dir, ['--no-fund']);
    expect(r.status, r.err).toBe(0);
    const envFile = readFileSync(join(dir, 'sdp', '.env'), 'utf8');
    expect(statSync(join(dir, 'sdp', '.env')).mode & 0o777).toBe(0o600);
    const pub = /^DISTRIBUTION_PUBLIC_KEY=(G[A-Z2-7]{55})$/m.exec(envFile)?.[1];
    expect(pub).toBeDefined();
    for (const k of ['DISTRIBUTION_SEED', 'SEP10_SIGNING_PRIVATE_KEY', 'ADMIN_API_KEY', 'BRIDGE_OWNER_PASSWORD', 'SCOPETEST_OWNER_PASSWORD']) {
      expect(new RegExp(`^${k}=.+$`, 'm').test(envFile), k).toBe(true);
    }
    expect(r.out).toContain('not funded (--no-fund)');
    expect(r.out).toContain(`${TESTNET_EXPLORER_BASE_URL}/account/${pub}`);
    expect(r.out).not.toMatch(seedPattern);
    const record = JSON.parse(readFileSync(join(dir, 'test-output', 'sdp-accounts-funding.json'), 'utf8'));
    expect(record).toMatchObject({ funded: false, fundedAt: null, network: 'testnet' });
  });

  it('refuses a non-testnet environment without the acknowledgement before writing anything', () => {
    const dir = scratch();
    const r = run('setup-sdp-accounts.mjs', dir, ['--no-fund'], { NETWORK_TYPE: 'othernet' });
    expect(r.status).toBe(2);
    expect(r.err).toContain('network configuration refused');
    expect(existsSync(join(dir, 'sdp', '.env'))).toBe(false);
  });
});
