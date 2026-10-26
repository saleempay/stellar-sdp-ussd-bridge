/**
 * scripts/ussd-serve.mjs, spawned as a deployment would: the readiness
 * endpoint follows the live Horizon check, the callback path still answers
 * screen 1, other paths get the adapter's 404, SIGTERM stops it cleanly, and
 * every Horizon check failure at boot (no answer, transport error, HTML 200,
 * 404, another network's passphrase) refuses the start with exit code 2
 * before the listener opens, as the capture script does. On SIGTERM the
 * readiness endpoint answers 503 first and a slow in-flight callback still
 * completes before the clean exit.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { connect } from 'node:net';
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

type HorizonMode = { passphrase: string } | 'down' | 'html' | 'notFound' | 'hang';
/** A fake Horizon root whose answer can be changed while it runs. */
async function fakeHorizon(initial: HorizonMode): Promise<{ url: string; set: (m: HorizonMode) => void }> {
  let mode = initial;
  const server: Server = createServer((_req, res) => {
    if (mode === 'down') { res.writeHead(500); res.end('down'); return; }
    if (mode === 'html') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<html>landing page</html>'); return; }
    if (mode === 'notFound') { res.writeHead(404); res.end('not found'); return; }
    if (mode === 'hang') return; // never answers; the check times out
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ network_passphrase: mode.passphrase }));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  cleanups.push(() => new Promise<void>((r) => server.close(() => r())));
  const a = server.address();
  return { url: `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`, set: (m) => { mode = m; } };
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

// each dial is its own gateway session: the adapter replays a cached reply for a repeated (session, text)
let dials = 0;
const dial = (port: number) => fetch(`http://127.0.0.1:${port}${CALLBACK}`, {
  method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ sessionId: `s-serve-${++dials}`, phoneNumber: '+999700000001', networkCode: '99999', serviceCode: '*384*0#', text: '' }).toString(),
});

describe('scripts/ussd-serve.mjs', () => {
  it('starts, reports ready after a passing Horizon check, answers the callback, 404s other paths, stops on SIGTERM', async () => {
    const horizon = await fakeHorizon({ passphrase: OTHER_PASSPHRASE });
    const s = await start(otherNetwork(horizon.url));
    const ready = await fetch(`http://127.0.0.1:${s.port}/ready`);
    expect(ready.status).toBe(200);
    const body = (await ready.json()) as Record<string, unknown>;
    expect(body).toEqual({ ready: true, checkedAt: expect.any(String), networkType: 'othernet' });
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

  describe('every Horizon check failure at boot refuses the start with exit code 2, before the listener opens', () => {
    const refused = async (horizonUrl: string, reason: RegExp) => {
      const s = await start(otherNetwork(horizonUrl), { waitForListening: false });
      expect(await s.exit).toBe(2);
      expect(s.err.join('\n')).toContain('Horizon check failed, the service does not start');
      expect(s.err.join('\n')).toMatch(reason);
      expect(s.out.some((l) => l.includes('event=listening'))).toBe(false);
      expect(s.out.some((l) => l.includes('signer:'))).toBe(false);
    };
    it('another network\'s passphrase', async () => refused((await fakeHorizon({ passphrase: 'Test SDF Network ; September 2015' })).url, /serves a different network/));
    it('an HTML 200 (a landing page at a mistyped URL)', async () => refused((await fakeHorizon('html')).url, /did not answer with a JSON document/));
    it('a 404', async () => refused((await fakeHorizon('notFound')).url, /answered HTTP 404/));
    it('a transport error (nothing listens)', async () => refused(`http://127.0.0.1:${await freePort()}`, /did not answer \(/));
    it('a timeout (the root never answers)', async () => refused((await fakeHorizon('hang')).url, /did not answer \(TimeoutError\)/));
  });

  it('keeps checking while ready: a failing check gives 503 and the service-down END screen on the callback, a passing one gives 200 again', async () => {
    const horizon = await fakeHorizon({ passphrase: OTHER_PASSPHRASE });
    const s = await start(otherNetwork(horizon.url));
    expect((await fetch(`http://127.0.0.1:${s.port}/ready`)).status).toBe(200);
    const readyStatus = async () => (await fetch(`http://127.0.0.1:${s.port}/ready`)).status;
    const until = async (status: number) => {
      const deadline = Date.now() + 10_000;
      while ((await readyStatus()) !== status && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
      return readyStatus();
    };
    horizon.set('down');
    expect(await until(503)).toBe(503);
    const screen = await dial(s.port);
    expect(screen.status).toBe(200);
    expect(await screen.text()).toBe('END Service unavailable.\nPlease try again later.');
    horizon.set({ passphrase: OTHER_PASSPHRASE });
    expect(await until(200)).toBe(200);
    expect(await (await dial(s.port)).text()).toBe('CON Saleem\n1. My account\n2. About');
    expect(s.out.some((l) => l.includes('event=horizonCheck result=failed'))).toBe(true);
    expect(s.out.some((l) => l.includes('(ready again)'))).toBe(true);
    s.child.kill('SIGTERM');
    expect(await s.exit).toBe(0);
  });

  it('on SIGTERM readiness answers 503 at once and a slow in-flight callback completes before the clean exit', async () => {
    const horizon = await fakeHorizon({ passphrase: OTHER_PASSPHRASE });
    const s = await start(otherNetwork(horizon.url));
    // a callback whose body arrives slowly: headers now, the body 3 s later, across the 2 s drain and the close
    const body = new URLSearchParams({ sessionId: 's-serve-slow', phoneNumber: '+999700000001', networkCode: '99999', serviceCode: '*384*0#', text: '' }).toString();
    const socket = connect(s.port, '127.0.0.1');
    const reply = new Promise<string>((resolve) => { let data = ''; socket.on('data', (d) => { data += String(d); }); socket.on('close', () => resolve(data)); });
    await new Promise<void>((r) => socket.once('connect', r));
    socket.write(`POST ${CALLBACK} HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/x-www-form-urlencoded\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n`);
    await new Promise((r) => setTimeout(r, 200));
    s.child.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 300));
    expect((await fetch(`http://127.0.0.1:${s.port}/ready`)).status).toBe(503);
    await new Promise((r) => setTimeout(r, 2_500));
    socket.write(body);
    const answer = await reply;
    expect(answer).toContain('CON Saleem\n1. My account\n2. About');
    expect(await s.exit).toBe(0);
    expect(s.out.some((l) => l.includes('event=stopped'))).toBe(true);
    expect(s.out.some((l) => l.includes('event=stopForced'))).toBe(false);
  });

  it('a passphrase of another network after the start exits with code 2', async () => {
    const horizon = await fakeHorizon({ passphrase: OTHER_PASSPHRASE });
    const s = await start(otherNetwork(horizon.url));
    horizon.set({ passphrase: 'Test SDF Network ; September 2015' });
    expect(await s.exit).toBe(2);
    expect(s.err.join('\n')).toMatch(/after the start, the service stops: .*serves a different network/);
  });

  it('refuses a short callback path and an empty USSD_PORT at boot with exit code 2, before the Horizon check, with no stack trace', async () => {
    const horizon = await fakeHorizon('hang'); // reached only if the configuration passed
    const short = await start({ ...otherNetwork(horizon.url), USSD_CALLBACK_PATH: '/ussd/short' }, { waitForListening: false });
    expect(await short.exit).toBe(2);
    expect(short.err.join('\n')).toContain('USSD_CALLBACK_PATH is too short');
    expect(short.err.join('\n')).not.toContain('/ussd/short');
    expect(short.err.join('\n')).not.toMatch(/at .*\.(mjs|js):\d+/);
    const empty = await start({ ...otherNetwork(horizon.url), USSD_PORT: '' }, { waitForListening: false });
    expect(await empty.exit).toBe(2);
    expect(empty.err.join('\n')).toContain('USSD_PORT must be a port number');
  });

  it('refuses a ready path equal to the callback path, and a bad recheck interval', async () => {
    const horizon = await fakeHorizon({ passphrase: OTHER_PASSPHRASE });
    const same = await start({ ...otherNetwork(horizon.url), USSD_READY_PATH: CALLBACK }, { waitForListening: false });
    expect(await same.exit).toBe(2);
    expect(same.err.join('\n')).toContain('USSD_READY_PATH must differ');
    const bad = await start({ ...otherNetwork(horizon.url), USSD_READY_RECHECK_MS: '5' }, { waitForListening: false });
    expect(await bad.exit).toBe(2);
    expect(bad.err.join('\n')).toContain('USSD_READY_RECHECK_MS');
    const overflow = await start({ ...otherNetwork(horizon.url), USSD_READY_RECHECK_MS: '3000000000' }, { waitForListening: false });
    expect(await overflow.exit).toBe(2);
    expect(overflow.err.join('\n')).toContain('at most 3600000');
  });
});
