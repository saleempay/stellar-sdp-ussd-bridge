#!/usr/bin/env node
/**
 * Upload an SDP disbursement file produced by the bridge to the bridge
 * tenant: creates the disbursement (contact type phone number and wallet
 * address, asset USDC) and uploads the file. Prints the disbursement id,
 * its status and the receiver wallet statuses. Does not start it.
 *
 *   npm run sdp:upload -- --file docs/evidence/d2-disbursement.csv --name "D2 evidence"
 *
 * A file written by `provision --allow-partial` carries a sidecar
 * (<file>.partial.json) naming the rows it lacks; the upload is refused
 * unless --accept-partial is passed, and refused as well when the sidecar
 * does not describe this file's bytes.
 */
import { existsSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { parseEnv } from 'node:util';
import { NetworkConfigError, SdpTenantClient, assertSameNetwork, loadEnvFile, partialSidecarPath, promptMfaCode, readPartialSidecar, sdpConfigFromEnv, sha256Hex, uploadDisbursementFile, verifyHorizonNetwork } from '../dist/index.js';

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const file = opt('--file');
const name = opt('--name') ?? `Upload ${new Date().toISOString()}`;
const acceptPartial = args.includes('--accept-partial');
if (!file) { console.error('usage: npm run sdp:upload -- --file <sdp-disbursement.csv> [--name <name>] [--wallet-id <id>] [--accept-partial]'); process.exit(2); }

const csv = readFileSync(file, 'utf8');
const sidecar = readPartialSidecar(partialSidecarPath(file));
if (sidecar) {
  const matches = sidecar.sha256 === sha256Hex(csv);
  const what = matches
    ? `${file} is PARTIAL: ${sidecar.rowsOmitted} input row(s) omitted (${sidecar.omitted.map((o) => `${o.rowIndex}:${o.code ?? o.status}`).join(', ')}), written ${sidecar.writtenAt}`
    : `${file} has a partial-output sidecar that does not describe its current bytes (${partialSidecarPath(file)})`;
  if (!acceptPartial) { console.error(`${what}. Upload refused; pass --accept-partial to upload it anyway.`); process.exit(2); }
  console.log(`${what}. Uploading anyway (--accept-partial).`);
}

const sdpEnv = loadEnvFile('sdp/.env');
const cfg = sdpConfigFromEnv(sdpEnv);
// The file being uploaded was written by provision from .env; both files must name the same network.
if (existsSync('.env')) {
  try { assertSameNetwork({ label: 'sdp/.env', env: sdpEnv }, { label: '.env', env: parseEnv(readFileSync('.env', 'utf8')) }); } catch (e) { console.error(e instanceof NetworkConfigError ? e.message : String(e)); process.exit(2); }
} else if (cfg.network.networkType !== 'testnet') {
  console.error(`.env not found: an upload on network type "${cfg.network.networkType}" needs both files so their network values can be compared`);
  process.exit(2);
} else {
  console.log('.env not present; network comparison with the bridge skipped (testnet)');
}
try { await verifyHorizonNetwork(cfg.network); } catch (e) { console.error(e instanceof NetworkConfigError ? e.message : String(e)); process.exit(2); }
const tenant = cfg.tenants[0];
const anon = new SdpTenantClient({ baseUrl: cfg.apiUrl, tenantName: tenant.name, strictMfa: cfg.strictMfa });
const client = await anon.authenticate(tenant.ownerEmail, tenant.ownerPassword, { mfaCode: promptMfaCode() });
const r = await uploadDisbursementFile(client, { name, csv, filename: basename(file), walletId: opt('--wallet-id'), usdcIssuer: cfg.network.assetIssuer });
console.log(`tenant ${tenant.name}, distribution account ${r.walletId ?? '(single)'}`);
console.log(`disbursement ${r.disbursement.id} "${name}": status ${r.statusAfterUpload}, ${r.receiverCount} receivers, wallet statuses ${r.receiverWalletStatuses.join(', ')}`);
