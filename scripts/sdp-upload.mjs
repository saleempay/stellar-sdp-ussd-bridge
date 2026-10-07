#!/usr/bin/env node
/**
 * Upload an SDP disbursement file produced by the bridge to the bridge
 * tenant: creates the disbursement (contact type phone number and wallet
 * address, asset USDC) and uploads the file. Prints the disbursement id,
 * its status and the receiver wallet statuses. Does not start it.
 *
 *   npm run sdp:upload -- --file docs/evidence/d2-disbursement.csv --name "D2 evidence"
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { SdpTenantClient, loadEnvFile, sdpConfigFromEnv, uploadDisbursementFile } from '../dist/index.js';

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const file = opt('--file');
const name = opt('--name') ?? `Upload ${new Date().toISOString()}`;
if (!file) { console.error('usage: npm run sdp:upload -- --file <sdp-disbursement.csv> [--name <name>] [--wallet-id <id>]'); process.exit(2); }

const cfg = sdpConfigFromEnv(loadEnvFile('sdp/.env'));
const tenant = cfg.tenants[0];
const anon = new SdpTenantClient({ baseUrl: cfg.apiUrl, tenantName: tenant.name });
const client = anon.withToken(await anon.login(tenant.ownerEmail, tenant.ownerPassword));
const r = await uploadDisbursementFile(client, { name, csv: readFileSync(file, 'utf8'), filename: basename(file), walletId: opt('--wallet-id') });
console.log(`tenant ${tenant.name}, distribution account ${r.walletId ?? '(single)'}`);
console.log(`disbursement ${r.disbursement.id} "${name}": status ${r.statusAfterUpload}, ${r.receiverCount} receivers, wallet statuses ${r.receiverWalletStatuses.join(', ')}`);
