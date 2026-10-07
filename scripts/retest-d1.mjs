#!/usr/bin/env node
/**
 * Deliverable 1 retest on SDP 7.0.0, testnet. Produces the receiver
 * scoping and batch status evidence recorded in EVIDENCE.md.
 *
 *   1. create a receiver test account on testnet with a USDC trustline
 *   2. in the bridge tenant, create a second distribution account so the
 *      tenant has two scopes
 *   3. create a wallet-address disbursement in the default account, upload
 *      one instruction, record the status after each step
 *   4. scoping: the receiver is visible from the account that created it,
 *      not from the second account, and not from the other tenant; a direct
 *      payment to it from the second account is refused
 *   5. transitions: STARTED, then the payment outcome over 90 seconds, then
 *      PAUSED and STARTED again
 *
 * Writes test-output/retest-d1.json with every account masked. Prints a
 * summary. Never prints a secret.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { Asset, BASE_FEE, Horizon, Keypair, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import {
  CONTACT_TYPE_PHONE_AND_WALLET_ADDRESS,
  SdpHttpError,
  SdpTenantClient,
  TESTNET_HORIZON_URL,
  TESTNET_USDC_ISSUER,
  loadEnvFile,
  maskAccount,
  sdpConfigFromEnv,
} from '../dist/index.js';

const cfg = sdpConfigFromEnv(loadEnvFile('sdp/.env'));
const FRIENDBOT_URL = process.env.FRIENDBOT_URL || 'https://friendbot.stellar.org';
const horizon = new Horizon.Server(TESTNET_HORIZON_URL);
const maskAll = (v) => JSON.parse(JSON.stringify(v).replace(/G[A-Z2-7]{55}/g, (m) => maskAccount(m)));
const stamp = () => new Date().toISOString();
const record = { startedAt: stamp(), sdpVersion: '7.0.0', network: 'testnet', steps: [] };
const log = (step, detail) => { record.steps.push({ at: stamp(), step, ...maskAll(detail) }); console.log(`${step}: ${JSON.stringify(maskAll(detail))}`); };
const outcome = async (fn) => { try { return { ok: true, value: await fn() }; } catch (e) { return e instanceof SdpHttpError ? { ok: false, status: e.status, error: e.body.slice(0, 300) } : { ok: false, error: String(e).slice(0, 300) }; } };

async function login(tenant) {
  const c = new SdpTenantClient({ baseUrl: cfg.apiUrl, tenantName: tenant.name });
  return c.withToken(await c.login(tenant.ownerEmail, tenant.ownerPassword));
}
const [bridgeSpec, scopeSpec] = cfg.tenants;
const bridge = await login(bridgeSpec);
const other = await login(scopeSpec);

// 1. receiver test account with a USDC trustline
const receiverKp = Keypair.random();
const fb = await fetch(`${FRIENDBOT_URL}?addr=${encodeURIComponent(receiverKp.publicKey())}`);
if (!fb.ok) throw new Error(`friendbot HTTP ${fb.status}`);
const funding = await fb.json();
const acct = await horizon.loadAccount(receiverKp.publicKey());
const tx = new TransactionBuilder(acct, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
  .addOperation(Operation.changeTrust({ asset: new Asset('USDC', TESTNET_USDC_ISSUER) }))
  .setTimeout(60)
  .build();
tx.sign(receiverKp);
const trust = await horizon.submitTransaction(tx);
log('receiver account', { account: receiverKp.publicKey(), fundingTx: funding.hash, trustlineTx: trust.hash, trustlineLedger: trust.ledger });
const phone = `+2547${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;

// 2. two distribution accounts in the bridge tenant
let accounts = await bridge.listDistributionWallets();
const primary = accounts.find((a) => a.is_default) ?? accounts[0];
let second = accounts.find((a) => a.name === 'scope-b');
if (!second) {
  const created = await outcome(() => bridge.createDistributionWallet({ name: 'scope-b', description: 'D1 receiver scoping retest' }));
  log('create second distribution account', created);
  accounts = await bridge.listDistributionWallets();
  second = accounts.find((a) => a.name === 'scope-b');
}
log('distribution accounts', accounts.map((a) => ({ id: a.id, name: a.name, is_default: a.is_default, status: a.status, address: a.distribution_account_address })));

// 3. disbursement in the primary account
const usdc = (await bridge.listAssets()).find((a) => a.code === 'USDC' && a.issuer === TESTNET_USDC_ISSUER);
// wallet_id is refused for this contact type (disbursement_handler.go:66-76);
// the SDP selects the enabled user managed wallet itself.
const name = `D1 retest ${stamp()}`;
const d = await bridge.createDisbursement({ name, asset_id: usdc.id, registration_contact_type: CONTACT_TYPE_PHONE_AND_WALLET_ADDRESS }, primary.id);
log('disbursement created', { id: d.id, status: d.status, registration_contact_type: d.registration_contact_type, wallet: d.wallet?.name });
const csv = `phone,id,amount,walletAddress\n${phone},d1-r1,1.5,${receiverKp.publicKey()}\n`;
const up = await outcome(() => bridge.uploadInstructions(d.id, csv, 'd1-retest.csv', primary.id));
const afterUpload = await bridge.getDisbursement(d.id, primary.id);
log('instructions uploaded', { upload: up, status: afterUpload.status });
const dr = await bridge.listDisbursementReceivers(d.id, primary.id);
const row = dr.data[0] ?? {};
const receiverId = row.id ?? row.receiver?.id;
log('disbursement receiver', { receiverId, receiverWalletStatus: row.receiver_wallet?.status, stellarAddress: row.receiver_wallet?.stellar_address, phone: row.phone_number ?? row.receiver?.phone_number });

// 4. scoping
const seenPrimary = await bridge.listReceivers(phone, primary.id);
const seenSecond = await bridge.listReceivers(phone, second.id);
const seenOther = await other.listReceivers(phone);
log('receiver list by scope', { primaryAccount: seenPrimary.data.length, secondAccount: seenSecond.data.length, otherTenant: seenOther.data.length });
const get = async (client, walletId) => outcome(async () => { const r = await client.listReceivers(undefined, walletId); return r.data.some((x) => x.id === receiverId); });
log('receiver id visible', { primaryAccount: await get(bridge, primary.id), secondAccount: await get(bridge, second.id), otherTenant: await get(other) });
const directPay = async (client, walletId, label) => {
  const r = await outcome(async () => {
    const res = await fetch(`${cfg.apiUrl}/payments`, {
      method: 'POST',
      headers: { 'SDP-Tenant-Name': client.tenantName, Authorization: `Bearer ${await tokenOf(client)}`, 'Content-Type': 'application/json', ...(walletId ? { 'X-Wallet-Id': walletId } : {}) },
      body: JSON.stringify({ amount: '1', asset: { id: (await client.listAssets()).find((a) => a.code === 'USDC').id }, receiver: { id: receiverId }, wallet: { id: (await client.listWallets({ user_managed: true }))[0].id } }),
    });
    return { status: res.status, body: (await res.text()).slice(0, 300) };
  });
  log(`direct payment from ${label}`, r);
};
async function tokenOf(client) { return client.login(client.tenantName === bridgeSpec.name ? bridgeSpec.ownerEmail : scopeSpec.ownerEmail, client.tenantName === bridgeSpec.name ? bridgeSpec.ownerPassword : scopeSpec.ownerPassword); }
await directPay(bridge, second.id, 'second account (same tenant)');
await directPay(other, undefined, 'other tenant');

// 5. transitions
const started = await outcome(() => bridge.patchDisbursementStatus(d.id, 'STARTED', primary.id));
log('patch STARTED', { result: started, status: (await bridge.getDisbursement(d.id, primary.id)).status });
const timeline = [];
let last;
const deadline = Date.now() + 90_000;
while (Date.now() < deadline) {
  const p = (await bridge.listPayments(primary.id)).data.find((x) => x.disbursement?.id === d.id);
  const key = p ? `${p.status}|${p.stellar_transaction_id ?? ''}|${(p.status_history ?? []).at(-1)?.status_message ?? ''}` : 'no payment row';
  if (key !== last) { timeline.push({ at: stamp(), status: p?.status ?? '(none)', txHash: p?.stellar_transaction_id || null, message: (p?.status_history ?? []).at(-1)?.status_message ?? null }); last = key; }
  if (p && ['SUCCESS', 'FAILED', 'CANCELED'].includes(p.status)) break;
  await new Promise((r) => setTimeout(r, 5000));
}
log('payment timeline (90 s window)', { timeline, disbursementStatus: (await bridge.getDisbursement(d.id, primary.id)).status });
const paused = await outcome(() => bridge.patchDisbursementStatus(d.id, 'PAUSED', primary.id));
log('patch PAUSED', { result: paused, status: (await bridge.getDisbursement(d.id, primary.id)).status });
const restarted = await outcome(() => bridge.patchDisbursementStatus(d.id, 'STARTED', primary.id));
log('patch STARTED again', { result: restarted, status: (await bridge.getDisbursement(d.id, primary.id)).status });
const balances = (await horizon.loadAccount(primary.distribution_account_address)).balances.map((b) => ({ asset: b.asset_code ?? 'XLM', balance: b.balance }));
log('primary distribution account balances', { address: primary.distribution_account_address, balances });

record.finishedAt = stamp();
mkdirSync('test-output', { recursive: true });
writeFileSync('test-output/retest-d1.json', `${JSON.stringify(record, null, 2)}\n`);
console.log('\nwritten test-output/retest-d1.json');
