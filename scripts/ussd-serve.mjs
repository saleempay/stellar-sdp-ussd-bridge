#!/usr/bin/env node
/**
 * The long-running USSD service: the bridge's listener on USSD_PORT, a
 * readiness endpoint, a stdout log, a clean stop on SIGTERM. No tunnel, no
 * recorder, no timer: the deployment's entrypoint (`npm run ussd:serve`
 * after `npm run build`, or `node scripts/ussd-serve.mjs` in an image).
 *
 * Configuration: `.env` in the working directory when present, overlaid by
 * the process environment (a container usually has no file). The boot
 * assertion (network values, closing line) runs first and exits with
 * code 2 on a refusal; then the live Horizon check (the Horizon root's
 * network_passphrase against NETWORK_PASSPHRASE, L2): a Horizon that
 * serves another network is a configuration error and the process exits
 * with code 2; a Horizon that does not answer lets the service start with
 * readiness reporting the failure, and the check runs again every
 * USSD_READY_RECHECK_MS (default 60 000) until it passes. The signer, when
 * creation on dial is on (testnet only), is loaded only after the Horizon
 * check, as in the capture script.
 *
 * Readiness: GET USSD_READY_PATH (default /ready) answers 200 with
 * {"ready":true,...} when the last Horizon check passed and 503 with
 * {"ready":false,"reason":...} otherwise; the body carries the network
 * type, the time of the last check and whether creation on dial and a
 * signer are on, never the callback path, never a secret. Every other
 * request goes to the adapter's listener, which answers the callback path
 * only (docs/integration-guide.md, "Running the service on a persistent
 * volume, with no signer").
 *
 * Log: one line per event on stdout, prefixed with the time; the bridge's
 * events carry session ids, state names and error codes, never user input.
 */
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import {
  ClosingLineError, NetworkConfigError, SignerConfigError, createUssdServer, loadInjectedSigner, selfTestEnabled, sponsorSigning,
  ussdConfigFromEnv, verifyHorizonNetwork,
} from '../dist/index.js';

const log = (line) => console.log(`${new Date().toISOString()} ${line}`);
const fail = (message) => { console.error(message); process.exit(2); };

const fileEnv = existsSync('.env') ? parseEnv(readFileSync('.env', 'utf8')) : {};
const env = { ...fileEnv, ...process.env };

let cfg;
try { cfg = ussdConfigFromEnv(env); } catch (e) { if (e instanceof NetworkConfigError || e instanceof ClosingLineError) fail(e.message); throw e; }
if (!cfg.callbackPath) fail('USSD_CALLBACK_PATH is not set (a long random segment, never printed)');

const readyPath = (env.USSD_READY_PATH ?? '/ready').trim() || '/ready';
if (!readyPath.startsWith('/')) fail('USSD_READY_PATH must start with a slash');
if (readyPath === cfg.callbackPath) fail('USSD_READY_PATH must differ from USSD_CALLBACK_PATH');
const recheckMs = Number(env.USSD_READY_RECHECK_MS ?? 60_000);
if (!Number.isFinite(recheckMs) || recheckMs < 1_000) fail('USSD_READY_RECHECK_MS must be a number of milliseconds, at least 1000');
const port = Number(env.USSD_PORT ?? 8085);
if (!Number.isInteger(port) || port < 0 || port > 65_535) fail('USSD_PORT must be a port number');

// The live Horizon check, before any signer module is loaded. A mismatch
// is a configuration error; an unanswered Horizon is reported by readiness.
const WRONG_NETWORK = /serves a different network|does not look like a Horizon server/;
const readiness = { ready: false, reason: 'not checked yet', checkedAt: null };
async function checkHorizon() {
  try {
    await verifyHorizonNetwork(cfg.network);
    readiness.ready = true; readiness.reason = null; readiness.checkedAt = new Date().toISOString();
    log(`event=horizonCheck result=ok network=${cfg.network.networkType}`);
  } catch (e) {
    const message = e instanceof NetworkConfigError ? e.message : String(e);
    if (WRONG_NETWORK.test(message)) fail(`Horizon check failed, the service does not start: ${message}`);
    readiness.ready = false; readiness.reason = message; readiness.checkedAt = new Date().toISOString();
    log('event=horizonCheck result=failed (readiness reports it; the check runs again)');
  }
}
await checkHorizon();

let signerLine = 'signer: none (creation on dial off)';
if (cfg.createOnDial) {
  try {
    const signing = await sponsorSigning(env, await loadInjectedSigner(env), { networkPassphrase: cfg.network.networkPassphrase, selfTest: selfTestEnabled(env) });
    cfg = { ...cfg, signer: signing.signer, sponsorPublicKey: signing.sponsorPublicKey, sponsorSecretKey: undefined };
    signerLine = `signer: ${signing.injected ? 'injected (BRIDGE_SIGNER_MODULE)' : 'adapter reference signer'}; self-test: ${signing.selfTested ? 'ran and passed' : 'skipped'}`;
  } catch (e) { if (e instanceof SignerConfigError) fail(e.message); throw e; }
}

const { listener } = createUssdServer({ ...cfg, log });

const server = createServer((req, res) => {
  if (req.method === 'GET' && (req.url ?? '').split('?')[0] === readyPath) {
    const body = JSON.stringify({
      ready: readiness.ready,
      reason: readiness.reason,
      checkedAt: readiness.checkedAt,
      network: cfg.network.networkType,
      createOnDial: cfg.createOnDial,
      signer: cfg.createOnDial ? (cfg.signer ? 'loaded' : 'reference') : 'none',
    });
    res.writeHead(readiness.ready ? 200 : 503, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(body);
    return;
  }
  listener(req, res);
});

const recheck = setInterval(() => { if (!readiness.ready) void checkHorizon(); }, recheckMs);
recheck.unref();

server.listen(port, '0.0.0.0', () => {
  const address = server.address();
  const bound = typeof address === 'object' && address ? address.port : port;
  log(`event=listening port=${bound} readyPath=${readyPath} network=${cfg.network.networkType} dataDir=${cfg.dataDir ?? '(memory)'} createOnDial=${cfg.createOnDial ? 'on' : 'off'} callbackPath=set(${cfg.callbackPath.length} chars, masked)`);
  log(signerLine);
  log(`event=ready value=${readiness.ready}`);
});

let stopping = false;
const stop = (signal) => {
  if (stopping) return;
  stopping = true;
  log(`event=stopping signal=${signal}`);
  clearInterval(recheck);
  server.close(() => { log('event=stopped'); process.exit(0); });
  setTimeout(() => process.exit(0), 5_000).unref();
};
process.on('SIGTERM', () => stop('SIGTERM'));
process.on('SIGINT', () => stop('SIGINT'));
