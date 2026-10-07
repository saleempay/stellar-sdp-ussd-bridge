#!/usr/bin/env node
/**
 * Provision recipients for an SDP wallet-address disbursement.
 *
 *   npm run provision -- --input recipients.csv --output sdp-disbursement.csv [--data data] [--allow-pin-column]
 *
 * Input: phone,id,amount (plus an optional pin column, refused without
 * --allow-pin-column; testnet automation only, recipients set their PIN on
 * first dial). For each row the bridge makes sure a Stellar account with a
 * USDC trustline exists and is bound to the number, then writes the SDP
 * file. Running it twice creates nothing new and writes the same bytes.
 *
 * Prints masked phones and accounts, full transaction hashes, and the
 * SHA-256 of the output file. Never prints a secret. Exit 0 when every row
 * is created, trustline_added or unchanged with no PIN refused; 1 otherwise;
 * 2 on a configuration or input file error (nothing sent).
 */
import { mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parseEnv } from 'node:util';
import { JsonFileAccountStore, JsonFilePinStore, LocalKeypairSigner } from 'stellar-ussd-sep10-adapter';
import {
  BridgeError,
  FetchHorizon,
  TESTNET_HORIZON_URL,
  TESTNET_NETWORK_PASSPHRASE,
  TESTNET_USDC_ISSUER,
  USDC_CODE,
  formatProvisionReport,
  maskAccount,
  parseInputCsv,
  provisionRecipients,
  sha256Hex,
  writeSdpCsv,
} from '../dist/index.js';

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const input = opt('--input');
const output = opt('--output');
const dataDir = opt('--data') ?? 'data';
const allowPinColumn = args.includes('--allow-pin-column');
if (!input || !output) {
  console.error('usage: npm run provision -- --input <recipients.csv> --output <sdp-disbursement.csv> [--data <dir>] [--allow-pin-column]');
  process.exit(2);
}

let env;
try { env = parseEnv(readFileSync('.env', 'utf8')); } catch { console.error('.env not found; run npm run sponsor:setup first'); process.exit(2); }
for (const k of ['SPONSOR_PUBLIC_KEY', 'SPONSOR_SECRET_KEY']) {
  if (!env[k]) { console.error(`${k} missing in .env`); process.exit(2); }
}
const horizonUrl = env.HORIZON_URL || TESTNET_HORIZON_URL;
const networkPassphrase = env.NETWORK_PASSPHRASE || TESTNET_NETWORK_PASSPHRASE;
if (networkPassphrase !== TESTNET_NETWORK_PASSPHRASE) { console.error('this bridge runs on testnet only'); process.exit(2); }
const asset = { code: env.ASSET_CODE || USDC_CODE, issuer: env.ASSET_ISSUER || TESTNET_USDC_ISSUER };

let rows;
try {
  rows = parseInputCsv(readFileSync(input, 'utf8'), { allowPinColumn });
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
  sponsorPublicKey,
  asset,
  networkPassphrase,
  paymentIdPrefix: basename(input).replace(/\.csv$/i, ''),
};

console.log(`sponsor ${maskAccount(sponsorPublicKey)}, asset ${asset.code}:${maskAccount(asset.issuer)}, ${rows.length} rows, data in ${dataDir}/`);
let report;
try {
  report = await provisionRecipients(rows, deps);
} catch (e) {
  console.error(`run refused before any transaction: ${e instanceof BridgeError ? `${e.code}: ` : ''}${e.message}`);
  process.exit(2);
}
console.log(formatProvisionReport(report));
const csv = writeSdpCsv(report.sdpRows);
writeFileSync(output, csv);
const hash = sha256Hex(csv);
console.log(`wrote ${output}: ${report.sdpRows.length} rows, sha256 ${hash}`);
appendFileSync(join(dataDir, 'provision-log.jsonl'), `${JSON.stringify({ at: new Date().toISOString(), input: basename(input), output, sha256: hash, counts: report.counts, outcomes: report.outcomes.map(({ accountId: _a, ...o }) => o) })}\n`);
const ok = report.counts.failed === 0 && report.counts.pinRefused === 0;
process.exit(ok ? 0 : 1);
