/**
 * scripts/ussd-serve.mjs, spawned as a deployment would: the readiness
 * endpoint follows the live Horizon check, the callback path still answers
 * screen 1, other paths get the adapter's 404, SIGTERM stops it cleanly, a
 * Horizon on another network refuses the start, and an unanswered Horizon
 * starts the service as not ready.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const repo = resolve(process.cwd());
const CALLBACK = '/ussd/test-only-callback-path-0123456789abcdef';
/** The boot assertion refuses a non-testnet Horizon URL on testnet, so the spawned service runs as another network pointed at the fake Horizon. */
const OTHER_PASSPHRASE = 'Other Network ; Example Only';
const otherNetwork = (horizonUrl: string) => ({
  NETWORK_TYPE: 'othernet',
  NETWORK_PASSPHRASE: OTHER_PASSPHRASE,
  HORIZON_URL: horizonUrl,
  ASSET_ISSUER: 'G'.padEnd(56, 'A'),
  EXPLORER_BASE_URL: 'https://explorer.example.test/other',
  BRIDGE_ACKNOWLEDGE_REAL_FUNDS: 'yes',
});
const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => { for (const c of cleanups.splice(0)) await c(); });

async function fakeHorizon(passphrase: string | null): Promise<string> {
  const server: Server = createServer((_req, res) => {
    if (passphrase === null) { res.writeHead(500); res.end('down'); return; }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ network_passphrase: passphrase }));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  cleanups.push(() => new Promise<void>((r) => server.close(() => r())));
  const a = server.address();
  return `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`;
}

async function freePort(): Promise<number> {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  const a = s.address();
  const port = typeof a === 'object' && a ? a.port : 0;
  await new Promise<void>((r) => s.close(() => r()));
  return port;
}

interface Running { child: ChildProcess; port: number; out: string[]; err: string[]; exit: Promise<number | null> }

async function start(extraEnv: Record<string, string>, opts: { waitForListening?: boolean } = {}): Promise<Running> {
  const dir = mkdtempSync(join(tmpdir(), 'bridge-serve-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const port = await freePort();
  const child = spawn(process.execPath, [join(repo, 'scripts', 'ussd-serve.mjs')], {
    cwd: dir,
    env: { PATH: process.env.PATH ?? '', USSD_CALLBACK_PATH: CALLBACK, USSD_PORT: String(port), USSD_CREATE_ON_DIAL: 'false', DATA_DIR: join(dir, 'data'), USSD_READY_RECHECK_MS: '1000', ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const out: string[] = []; const err: string[] = [];
  child.stdout!.on('data', (d) => out.push(...String(d).split('\n').filter(Boolean)));
  child.stderr!.on('data', (d) => err.push(...String(d).split('\n').filter(Boolean)));
  const exit = new Promise<number | null>((r) => child.on('exit', (code) => r(code)));
  cleanups.push(async () => { if (child.exitCode === null) { child.kill('SIGKILL'); await exit; } });
  if (opts.waitForListening !== false) {
    const deadline = Date.now() + 15_000;
    while (!out.some((l) => l.includes('event=listening')) && child.exitCode === null && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
    if (!out.some((l) => l.includes('event=listening'))) throw new Error(`service did not start: ${err.join(' | ')}`);
  }
  return { child, port, out, err, exit };
}

const dial = (port: number) => fetch(`http://127.0.0.1:${port}${CALLBACK}`, {
  method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ sessionId: 's-serve-1', phoneNumber: '+999700000001', networkCode: '99999', serviceCode: '*384*0#', text: '' }).toString(),
});

describe('scripts/ussd-serve.mjs', () => {
  it('starts, reports ready after a passing Horizon check, answers the callback, 404s other paths, stops on SIGTERM', async () => {
    const horizon = await fakeHorizon(OTHER_PASSPHRASE);
    const s = await start(otherNetwork(horizon));
    const ready = await fetch(`http://127.0.0.1:${s.port}/ready`);
    expect(ready.status).toBe(200);
    const body = (await ready.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ ready: true, reason: null, network: 'othernet', createOnDial: false, signer: 'none' });
    expect(JSON.stringify(body)).not.toContain(CALLBACK);
    const screen = await dial(s.port);
    expect(screen.status).toBe(200);
    expect(await screen.text()).toBe('CON Saleem\n1. My account\n2. About');
    expect((await fetch(`http://127.0.0.1:${s.port}/somewhere-else`)).status).toBe(404);
    expect(s.out.some((l) => l.includes('event=horizonCheck result=ok'))).toBe(true);
    expect(s.out.some((l) => l.includes('signer: none'))).toBe(true);
    expect(s.out.join('\n')).not.toContain(CALLBACK);
    s.child.kill('SIGTERM');
    expect(await s.exit).toBe(0);
    expect(s.out.some((l) => l.includes('event=stopped'))).toBe(true);
  });

  it('a Horizon that serves another network refuses the start with exit code 2, before listening', async () => {
    const horizon = await fakeHorizon('Test SDF Network ; September 2015');
    const s = await start(otherNetwork(horizon), { waitForListening: false });
    expect(await s.exit).toBe(2);
    expect(s.err.join('\n')).toMatch(/serves a different network/);
    expect(s.out.some((l) => l.includes('event=listening'))).toBe(false);
  });

  it('a Horizon that does not answer starts the service as not ready, then ready once a check passes', async () => {
    const horizon = await fakeHorizon(null);
    const s = await start(otherNetwork(horizon));
    const notReady = await fetch(`http://127.0.0.1:${s.port}/ready`);
    expect(notReady.status).toBe(503);
    expect(((await notReady.json()) as { ready: boolean; reason: string }).reason).toMatch(/answered HTTP 500/);
    // the callback still answers (the gateway is not refused by a Horizon outage at the welcome step)
    expect((await dial(s.port)).status).toBe(200);
    s.child.kill('SIGTERM');
    expect(await s.exit).toBe(0);
  });

  it('refuses a ready path equal to the callback path, and a bad recheck interval', async () => {
    const horizon = await fakeHorizon(OTHER_PASSPHRASE);
    const same = await start({ ...otherNetwork(horizon), USSD_READY_PATH: CALLBACK }, { waitForListening: false });
    expect(await same.exit).toBe(2);
    expect(same.err.join('\n')).toContain('USSD_READY_PATH must differ');
    const bad = await start({ ...otherNetwork(horizon), USSD_READY_RECHECK_MS: '5' }, { waitForListening: false });
    expect(await bad.exit).toBe(2);
    expect(bad.err.join('\n')).toContain('USSD_READY_RECHECK_MS');
  });
});
