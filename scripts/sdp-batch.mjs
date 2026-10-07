#!/usr/bin/env node
/**
 * Start a disbursement in the bridge tenant, follow its payments to a
 * final state, and confirm every payment on Horizon.
 *
 *   npm run sdp:batch -- --disbursement <id> [--check-only] [--skip-start] [--timeout-minutes 10]
 *
 * --check-only prints the distribution account's USDC balance against the
 * disbursement's total and exits without starting anything. Writes
 * test-output/d4-batch/<run>/evidence.json (accounts masked, full hashes).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  FetchHorizon,
  SdpTenantClient,
  TESTNET_HORIZON_URL,
  TESTNET_USDC_ISSUER,
  USDC_CODE,
  formatBatchReport,
  loadEnvFile,
  maskAccount,
  paymentsOf,
  runBatch,
  sdpConfigFromEnv,
  selectDistributionWalletId,
  totalAmount,
} from '../dist/index.js';

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const disbursementId = opt('--disbursement');
if (!disbursementId) { console.error('usage: npm run sdp:batch -- --disbursement <id> [--check-only] [--skip-start] [--timeout-minutes 10]'); process.exit(2); }
const checkOnly = args.includes('--check-only');
const skipStart = args.includes('--skip-start');
const timeoutMs = Number(opt('--timeout-minutes') ?? 10) * 60_000;
const asset = { code: USDC_CODE, issuer: TESTNET_USDC_ISSUER };

const cfg = sdpConfigFromEnv(loadEnvFile('sdp/.env'));
const tenant = cfg.tenants[0];
const anon = new SdpTenantClient({ baseUrl: cfg.apiUrl, tenantName: tenant.name });
const client = anon.withToken(await anon.login(tenant.ownerEmail, tenant.ownerPassword));
const walletId = await selectDistributionWalletId(client);
const accounts = await client.listDistributionWallets();
const account = accounts.find((a) => a.id === walletId) ?? accounts[0];
const horizon = new FetchHorizon(TESTNET_HORIZON_URL, { timeoutMs: 20_000 });

const d = await client.getDisbursement(disbursementId, walletId);
const payments = await paymentsOf(client, disbursementId, walletId);
const total = totalAmount(payments);
const onChain = await horizon.loadAccount(account.distribution_account_address);
const usdc = onChain.balances.find((b) => b.asset_code === asset.code && b.asset_issuer === asset.issuer)?.balance ?? '0';
console.log(`tenant ${tenant.name}, distribution account ${maskAccount(account.distribution_account_address)} (${account.name}), USDC balance ${usdc}`);
console.log(`disbursement ${d.id} "${d.name}": status ${d.status}, ${payments.length} payments, total ${total} USDC`);
if (checkOnly) {
  console.log(Number(usdc) >= Number(total) ? 'balance covers the total' : 'balance does NOT cover the total');
  process.exit(0);
}

const run = new Date().toISOString().replace(/[:.]/g, '-');
const dir = join('test-output', 'd4-batch', run);
mkdirSync(dir, { recursive: true });
const result = await runBatch(
  { client, horizon, sleep: (ms) => new Promise((r) => setTimeout(r, ms)), now: () => Date.now() },
  { disbursementId, walletId, asset, timeoutMs, skipStart },
);
console.log(formatBatchReport(result));
const after = await horizon.loadAccount(account.distribution_account_address);
const evidence = {
  run, tenant: tenant.name, distributionAccount: maskAccount(account.distribution_account_address), disbursement: { id: d.id, name: d.name, statusBefore: d.status, total },
  usdcBefore: usdc, usdcAfter: after.balances.find((b) => b.asset_code === asset.code && b.asset_issuer === asset.issuer)?.balance ?? '0',
  result,
};
writeFileSync(join(dir, 'evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`);
console.log(`evidence written to ${dir}/evidence.json`);
process.exit(result.timedOut || result.payments.some((p) => p.status !== 'SUCCESS') ? 1 : 0);
