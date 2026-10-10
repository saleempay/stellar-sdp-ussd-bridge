#!/usr/bin/env node
/**
 * Provision recipients for an SDP wallet-address disbursement.
 *
 *   npm run provision -- --input recipients.csv --output sdp-disbursement.csv [--data data] [--allow-pin-column] [--allow-partial]
 *
 * Input: phone,id,amount (plus an optional pin column, refused without
 * --allow-pin-column; testnet automation only, recipients set their PIN on
 * first dial). For each row the bridge makes sure a Stellar account with a
 * USDC trustline exists and is bound to the number, then writes the SDP
 * file. Running it twice creates nothing new and writes the same bytes.
 *
 * Prints masked phones and accounts, full transaction hashes, and the
 * SHA-256 of the output file. Never prints a secret. Exit 0 when every row
 * is created, trustline_added or unchanged with no PIN refused; 1 otherwise
 * (a failed or uncertain row); 2 on a configuration or input file error
 * (nothing sent). An uncertain row names an account whose creation may have
 * landed; data/pending-creations.json keeps it for the next run to check.
 *
 * When any row failed or is uncertain the output file is NOT written: a
 * file missing rows looks complete to the SDP. Pass --allow-partial to
 * write the rows that succeeded together with <output>.partial.json, the
 * sidecar sdp:upload checks (it refuses the file unless --accept-partial).
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parseEnv } from 'node:util';
import { JsonFileAccountStore, JsonFilePinStore, LocalKeypairSigner } from 'stellar-ussd-sep10-adapter';
import {
  BridgeError,
  CapConfigError,
  FetchHorizon,
  JsonFilePendingStore,
  NetworkConfigError,
  USDC_CODE,
  assertNetwork,
  assertSameNetwork,
  capsFromEnv,
  formatProvisionReport,
  maskAccount,
  parseInputCsv,
  partialSidecarFor,
  partialSidecarPath,
  provisionRecipients,
  sha256Hex,
  verifyHorizonNetwork,
  writeSdpCsv,
} from '../dist/index.js';

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const input = opt('--input');
const output = opt('--output');
const dataDir = opt('--data') ?? 'data';
const allowPinColumn = args.includes('--allow-pin-column');
const allowPartial = args.includes('--allow-partial');
if (!input || !output) {
  console.error('usage: npm run provision -- --input <recipients.csv> --output <sdp-disbursement.csv> [--data <dir>] [--allow-pin-column] [--allow-partial]');
  process.exit(2);
}

let env;
try { env = parseEnv(readFileSync('.env', 'utf8')); } catch { console.error('.env not found; run npm run sponsor:setup first'); process.exit(2); }
for (const k of ['SPONSOR_PUBLIC_KEY', 'SPONSOR_SECRET_KEY']) {
  if (!env[k]) { console.error(`${k} missing in .env`); process.exit(2); }
}
// Boot assertion: testnet values must be the testnet constants; any other
// network needs every value supplied and BRIDGE_ACKNOWLEDGE_REAL_FUNDS=yes.
let network;
try { network = assertNetwork(env); } catch (e) { console.error(e instanceof NetworkConfigError ? e.message : String(e)); process.exit(2); }
// The SDP that will pay from this file reads sdp/.env; both files must name
// the same network. On testnet a missing sdp/.env is noted; elsewhere it is
// required, so the comparison can never be skipped by leaving it out.
const SDP_ENV_PATH = 'sdp/.env';
if (existsSync(SDP_ENV_PATH)) {
  try { assertSameNetwork({ label: '.env', env }, { label: SDP_ENV_PATH, env: parseEnv(readFileSync(SDP_ENV_PATH, 'utf8')) }); } catch (e) { console.error(e instanceof NetworkConfigError ? e.message : String(e)); process.exit(2); }
} else if (network.networkType !== 'testnet') {
  console.error(`${SDP_ENV_PATH} not found: a run on network type "${network.networkType}" needs both .env and ${SDP_ENV_PATH} so their network values can be compared`);
  process.exit(2);
} else {
  console.log(`${SDP_ENV_PATH} not present; network comparison with the SDP skipped (testnet)`);
}
const horizonUrl = network.horizonUrl;
const networkPassphrase = network.networkPassphrase;
const asset = { code: env.ASSET_CODE || USDC_CODE, issuer: network.assetIssuer };

// Caps (MAX_PAYMENT_USDC, MAX_BATCH_USDC; defaults 5 and 25) are applied to
// the file before anything is created or written.
let caps;
try { caps = capsFromEnv({ ...env, ...process.env }); } catch (e) { console.error(e instanceof CapConfigError ? e.message : String(e)); process.exit(2); }
let rows;
try {
  rows = parseInputCsv(readFileSync(input, 'utf8'), { allowPinColumn, caps });
} catch (e) {
  console.error(`input file refused: ${e.message}`);
  process.exit(2);
}

const signer = new LocalKeypairSigner();
const sponsorPublicKey = signer.importSecret(env.SPONSOR_SECRET_KEY);
if (sponsorPublicKey !== env.SPONSOR_PUBLIC_KEY) { console.error('SPONSOR_PUBLIC_KEY does not match SPONSOR_SECRET_KEY'); process.exit(2); }
mkdirSync(dataDir, { recursive: true });
const deps = {
  horizon: new FetchHorizon(horizonUrl, { timeoutMs: Number(env.HORIZON_TIMEOUT_MS || 15000) }),
  signer,
  accountStore: new JsonFileAccountStore(join(dataDir, 'accounts.json')),
  pinStore: allowPinColumn ? new JsonFilePinStore(join(dataDir, 'pins.json')) : undefined,
  // written before each creation is submitted; see src/provision/pending.ts
  pendingStore: new JsonFilePendingStore(join(dataDir, 'pending-creations.json')),
  sponsorPublicKey,
  asset,
  networkPassphrase,
  paymentIdPrefix: basename(input).replace(/\.csv$/i, ''),
};

// Live half of the boot assertion: Horizon's root must report the configured passphrase.
try { await verifyHorizonNetwork(network, { timeoutMs: Number(env.HORIZON_TIMEOUT_MS || 15000) }); } catch (e) { console.error(e instanceof NetworkConfigError ? e.message : String(e)); process.exit(2); }
console.log(`network ${network.networkType} (Horizon root confirms the passphrase), sponsor ${maskAccount(sponsorPublicKey)}, asset ${asset.code}:${maskAccount(asset.issuer)}, ${rows.length} rows within caps ${caps.maxPaymentUsdc}/${caps.maxBatchUsdc} USDC, data in ${dataDir}/`);
let report;
try {
  report = await provisionRecipients(rows, deps);
} catch (e) {
  console.error(`run refused before any transaction: ${e instanceof BridgeError ? `${e.code}: ` : ''}${e.message}`);
  process.exit(2);
}
console.log(formatProvisionReport(report));
const omitted = report.counts.failed + report.counts.uncertain;
const csv = writeSdpCsv(report.sdpRows);
const hash = sha256Hex(csv);
let written = false;
if (omitted > 0 && !allowPartial) {
  console.error(`${output} NOT written: ${omitted} row(s) failed or uncertain and the file would look complete without them. Fix and re-run, or pass --allow-partial to write the ${report.sdpRows.length} row(s) that succeeded with a sidecar that sdp:upload checks.`);
} else {
  writeFileSync(output, csv);
  written = true;
  const sidecar = partialSidecarFor(report, output, hash);
  if (sidecar) {
    writeFileSync(partialSidecarPath(output), `${JSON.stringify(sidecar, null, 2)}\n`);
    console.log(`wrote ${output}: ${report.sdpRows.length} rows, sha256 ${hash}; PARTIAL, ${omitted} row(s) omitted (input rows ${sidecar.omitted.map((o) => o.rowIndex).join(', ')}); sidecar ${partialSidecarPath(output)}`);
  } else {
    // a complete file must not carry a sidecar from an earlier partial run
    rmSync(partialSidecarPath(output), { force: true });
    console.log(`wrote ${output}: ${report.sdpRows.length} rows, sha256 ${hash}`);
  }
}
appendFileSync(join(dataDir, 'provision-log.jsonl'), `${JSON.stringify({ at: new Date().toISOString(), input: basename(input), output, written, sha256: hash, counts: report.counts, outcomes: report.outcomes.map(({ accountId: _a, ...o }) => o) })}\n`);
const ok = report.counts.failed === 0 && report.counts.uncertain === 0 && report.counts.pinRefused === 0;
process.exit(ok ? 0 : 1);
