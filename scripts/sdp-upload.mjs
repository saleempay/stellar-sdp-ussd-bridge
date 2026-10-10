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
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { SdpTenantClient, loadEnvFile, partialSidecarPath, promptMfaCode, readPartialSidecar, sdpConfigFromEnv, sha256Hex, uploadDisbursementFile } from '../dist/index.js';

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

const cfg = sdpConfigFromEnv(loadEnvFile('sdp/.env'));
const tenant = cfg.tenants[0];
const anon = new SdpTenantClient({ baseUrl: cfg.apiUrl, tenantName: tenant.name });
const client = anon.withToken(await anon.login(tenant.ownerEmail, tenant.ownerPassword, { mfaCode: promptMfaCode() }));
const r = await uploadDisbursementFile(client, { name, csv, filename: basename(file), walletId: opt('--wallet-id'), usdcIssuer: cfg.network.assetIssuer });
console.log(`tenant ${tenant.name}, distribution account ${r.walletId ?? '(single)'}`);
console.log(`disbursement ${r.disbursement.id} "${name}": status ${r.statusAfterUpload}, ${r.receiverCount} receivers, wallet statuses ${r.receiverWalletStatuses.join(', ')}`);
