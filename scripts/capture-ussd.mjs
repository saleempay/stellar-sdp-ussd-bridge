#!/usr/bin/env node
/**
 * Run the bridge's USSD service for an Africa's Talking sandbox session and
 * record every callback and response, masked, for the evidence.
 *
 *   npm run ussd:capture -- --tunnel-url https://<your-tunnel-host> [--wait-minutes 15]
 *
 * The script starts no tunnel. Expose the port yourself (for example with
 * cloudflared), pass the tunnel BASE URL, and set the sandbox callback to
 * that base URL followed by USSD_CALLBACK_PATH from .env. The banner shows
 * the path masked; the full value is never printed.
 *
 * Writes test-output/ussd-capture/<timestamp>.json (MSISDN masked, every
 * four-digit input masked, callback path masked). Every request is recorded
 * whatever its status, with method, path as segment lengths, whether the
 * path matched the callback path, query presence, content type and length,
 * user agent and the tunnel's forwarding headers, so a gateway callback can
 * be told from a browser hit or a probe. Stops on Ctrl-C or after
 * --wait-minutes.
 */
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { captureBanner, createUssdServer, describeExchange, recordingListener, ussdConfigFromEnv } from '../dist/index.js';

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const tunnelUrl = (opt('--tunnel-url') ?? process.env.TUNNEL_BASE_URL ?? '').replace(/\/+$/, '');
const waitMinutes = Number(opt('--wait-minutes') ?? 30);
let env;
try { env = parseEnv(readFileSync('.env', 'utf8')); } catch { console.error('.env not found'); process.exit(2); }
const cfg = ussdConfigFromEnv(env);
if (!cfg.callbackPath) { console.error('USSD_CALLBACK_PATH is not set in .env (a long random segment, never printed)'); process.exit(2); }

const exchanges = [];
const events = [];
const started = new Date().toISOString().replace(/[:.]/g, '-');
mkdirSync('test-output/ussd-capture', { recursive: true });
const outPath = `test-output/ussd-capture/${started}.json`;
const flush = () => writeFileSync(outPath, `${JSON.stringify({ started, tunnelBaseUrl: tunnelUrl || null, exchanges, events }, null, 2)}\n`);

const { listener } = createUssdServer({ ...cfg, log: (line) => { events.push({ at: new Date().toISOString(), line }); } });
const server = createServer(recordingListener(listener, (e) => {
  exchanges.push(e);
  flush();
  // every request, 404s included: method, path as segment lengths, match, headers; never the path
  console.log(describeExchange(e));
  if (e.fields.text !== undefined) console.log(`  text=${JSON.stringify(e.fields.text)}`);
}, { callbackPath: cfg.callbackPath }));
const port = Number(env.USSD_PORT ?? 8085);
server.listen(port, () => {
  console.log(captureBanner(port, cfg.callbackPath, tunnelUrl || undefined));
  console.log(`Recording to ${outPath}. Creation on dial: ${cfg.createOnDial ? 'on' : 'off'}. Data dir: ${cfg.dataDir}. Stops in ${waitMinutes} minutes or on Ctrl-C.`);
});
const stop = () => { flush(); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 1000); };
process.on('SIGINT', stop);
setTimeout(stop, waitMinutes * 60 * 1000);
