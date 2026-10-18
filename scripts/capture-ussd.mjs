#!/usr/bin/env node
/**
 * Run the bridge's USSD service for an Africa's Talking sandbox session,
 * put a public tunnel in front of it, and record every request and
 * response, masked, for the evidence.
 *
 *   npm run ussd:capture -- [--wait-minutes 240] [--clipboard] [--tunnel-url https://<host>]
 *
 * Tunnel (USSD_TUNNEL_MODE in .env, default quick): the script starts a
 * cloudflared quick tunnel itself, or a named tunnel on a fixed hostname
 * (USSD_TUNNEL_HOSTNAME plus USSD_TUNNEL_TOKEN or USSD_TUNNEL_NAME), or
 * with --tunnel-url uses a tunnel you run yourself (external mode). One
 * tunnel serves the whole recording session; the script never restarts it
 * on its own. If the tunnel process exits, a replacement is started and the
 * new hostname is printed in full with a warning: the dashboard callback
 * must then be updated before the next dial. Every tunnel start is written
 * to the capture record with its time and hostname.
 *
 * "READY TO DIAL" is printed only when the hostname resolves on two public
 * resolvers and a well-formed gateway POST through the public URL returns
 * screen 1; otherwise NOT READY with the reasons, retried for two minutes.
 *
 * --clipboard copies the full callback URL (hostname plus the path) to the
 * clipboard with pbcopy, so the path is pasted, never typed or printed.
 *
 * Writes test-output/ussd-capture/<timestamp>.json (MSISDN masked, every
 * four-digit input masked, callback path masked). Every request is recorded
 * whatever its status, with method, path as segment lengths, whether the
 * path matched the callback path, query presence, content type and length,
 * user agent and the tunnel's forwarding headers, so a gateway callback can
 * be told from a browser hit or a probe. Stops on Ctrl-C or after
 * --wait-minutes.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import {
  ClosingLineError, NetworkConfigError, SignerConfigError, assessDialReadiness, captureBanner, createUssdServer, describeExchange,
  loadInjectedSigner, normaliseHostname, parseQuickTunnelHostname, readinessReport, recordingListener, selfTestEnabled, sponsorSigning, tunnelCommand,
  tunnelConfigFromEnv, tunnelStartNotice, ussdConfigFromEnv, verifyHorizonNetwork,
} from '../dist/index.js';

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const flag = (n) => args.includes(n);
const waitMinutes = Number(opt('--wait-minutes') ?? 30);
const externalUrl = (opt('--tunnel-url') ?? process.env.TUNNEL_BASE_URL ?? '').replace(/\/+$/, '');
let env;
// one environment for every check: .env overlaid by the process environment
try { env = { ...parseEnv(readFileSync('.env', 'utf8')), ...process.env }; } catch { console.error('.env not found'); process.exit(2); }
let cfg;
try { cfg = ussdConfigFromEnv(env); } catch (e) { if (e instanceof NetworkConfigError || e instanceof ClosingLineError) { console.error(e.message); process.exit(2); } throw e; }
// Creation on dial signs with the adapter's reference signer by default, or
// with a signer injected through BRIDGE_SIGNER_MODULE (checked at boot).
if (cfg.createOnDial) {
  try {
    const selfTest = selfTestEnabled(env, cfg.network.networkType);
    const signing = await sponsorSigning(env, await loadInjectedSigner(env), { networkPassphrase: cfg.network.networkPassphrase, selfTest });
    cfg = { ...cfg, signer: signing.signer, sponsorPublicKey: signing.sponsorPublicKey, sponsorSecretKey: undefined };
    console.log(`signer: ${signing.injected ? 'injected (BRIDGE_SIGNER_MODULE)' : 'adapter reference signer'}`);
    if (signing.injected) console.log(signing.selfTested ? 'signer self-test: ran and passed (throwaway envelope, sequence 0, expired time bounds; the signature is not logged)' : `signer self-test: skipped (${(env.BRIDGE_SIGNER_SELF_TEST ?? '').trim() ? 'BRIDGE_SIGNER_SELF_TEST=off' : `default off for network type "${cfg.network.networkType}"`})`);
  } catch (e) { if (e instanceof SignerConfigError) { console.error(e.message); process.exit(2); } throw e; }
}
if (!cfg.callbackPath) { console.error('USSD_CALLBACK_PATH is not set in .env (a long random segment, never printed)'); process.exit(2); }
// Live half of the boot assertion: Horizon's root must report the configured passphrase.
// Ruling of 18 October 2026: when this fails, the readiness output names Horizon as the reason.
try { await verifyHorizonNetwork(cfg.network); } catch (e) { console.error(`NOT READY TO DIAL: Horizon check failed, the service does not start: ${e instanceof NetworkConfigError ? e.message : String(e)}`); process.exit(2); }
let tunnelCfg;
try { tunnelCfg = externalUrl ? { mode: 'external', hostname: normaliseHostname(externalUrl) } : tunnelConfigFromEnv(env); } catch (e) { console.error(e.message); process.exit(2); }

const exchanges = [];
const events = [];
const tunnels = [];
const readiness = [];
const started = new Date().toISOString().replace(/[:.]/g, '-');
mkdirSync('test-output/ussd-capture', { recursive: true });
const outPath = `test-output/ussd-capture/${started}.json`;
const flush = () => writeFileSync(outPath, `${JSON.stringify({ started, tunnelMode: tunnelCfg.mode, tunnels, readiness, exchanges, events }, null, 2)}\n`);

const { listener } = createUssdServer({ ...cfg, log: (line) => { events.push({ at: new Date().toISOString(), line }); } });
const server = createServer(recordingListener(listener, (e) => {
  exchanges.push(e);
  flush();
  // every request, 404s included: method, path as segment lengths, match, headers; never the path
  console.log(describeExchange(e));
  if (e.fields.text !== undefined) console.log(`  text=${JSON.stringify(e.fields.text)}`);
}, { callbackPath: cfg.callbackPath }));
const port = Number(env.USSD_PORT ?? 8085);

let child;
let stopping = false;
let currentHostname;

function onTunnelUp(hostname, restart) {
  const start = { at: new Date().toISOString(), hostname, mode: tunnelCfg.mode, restart };
  tunnels.push(start);
  flush();
  console.log(tunnelStartNotice(start, currentHostname));
  currentHostname = hostname;
  if (flag('--clipboard')) {
    const pb = spawn('pbcopy');
    pb.stdin.end(`https://${hostname}${cfg.callbackPath}`);
    pb.on('close', (code) => console.log(code === 0 ? 'Full callback URL copied to the clipboard (https, no trailing slash). Paste it into the dashboard.' : 'pbcopy failed; the clipboard was not written.'));
  }
  void waitUntilReady(hostname);
}

async function waitUntilReady(hostname) {
  const deadline = Date.now() + 120_000;
  for (;;) {
    const r = await assessDialReadiness(hostname, cfg.callbackPath);
    readiness.push(r);
    flush();
    console.log(readinessReport(r));
    if (r.ready || Date.now() > deadline || stopping || hostname !== currentHostname) return;
    await new Promise((res) => setTimeout(res, 5_000));
  }
}

function startTunnel(restart) {
  const cmd = tunnelCommand(tunnelCfg, port);
  if (!cmd) { onTunnelUp(tunnelCfg.hostname, restart); return; }
  console.log(`Starting ${cmd.command} (${tunnelCfg.mode} mode)${restart ? ' again' : ''}...`);
  child = spawn(cmd.command, cmd.args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let announced = false;
  const onLine = (chunk) => {
    for (const line of chunk.toString('utf8').split('\n')) {
      if (announced) continue;
      const host = tunnelCfg.mode === 'quick' ? parseQuickTunnelHostname(line) : (/Registered tunnel connection|Connection .* registered/i.test(line) ? tunnelCfg.hostname : undefined);
      if (host) { announced = true; onTunnelUp(host, restart); }
    }
  };
  child.stdout.on('data', onLine);
  child.stderr.on('data', onLine);
  child.on('exit', (code, signal) => {
    if (stopping) return;
    console.log(`\n!!! tunnel process exited (code ${code}, signal ${signal}). Starting a replacement; the hostname WILL change in quick mode and the dashboard callback must be updated.`);
    setTimeout(() => startTunnel(true), 2_000);
  });
}

server.listen(port, () => {
  console.log(captureBanner(port, cfg.callbackPath, externalUrl || undefined));
  console.log(`Recording to ${outPath}. Creation on dial: ${cfg.createOnDial ? 'on' : 'off'}. Data dir: ${cfg.dataDir}. Stops in ${waitMinutes} minutes or on Ctrl-C.`);
  startTunnel(false);
});
const stop = () => { stopping = true; flush(); if (child) child.kill('SIGTERM'); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 1000); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
setTimeout(stop, waitMinutes * 60 * 1000);
