#!/usr/bin/env node
/**
 * Start a disbursement in the bridge tenant, follow its payments to a
 * final state, and confirm every payment on Horizon.
 *
 *   npm run sdp:batch -- --disbursement <id> [--check-only] [--skip-start] [--timeout-minutes 10] [--second-run "<reason>"]
 *
 * Before anything starts (L3, rulings of 10 October 2026):
 * - the distribution account's USDC balance must not exceed MAX_ACCOUNT_USDC
 *   (default 100); an over-funded account refuses, in --check-only too;
 * - a disbursement in STARTED refuses, no flag lifts it; a disbursement in
 *   PAUSED refuses unless --second-run "<reason>" is given and none of its
 *   payments is READY or PENDING (the states that reach the network without a
 *   further operator action);
 * - the run log (BATCH_RUN_LOG, default data/batch-run-log.jsonl) must record
 *   no completed batch for the current UTC day, unless --second-run "<reason>"
 *   is given; the reason is written to the run log.
 *
 * --check-only prints the balance against the disbursement's total and the
 * ceiling and exits without starting anything. Writes
 * test-output/d4-batch/<run>/evidence.json (accounts masked, full hashes).
 * Exit codes: 0 batch completed; 1 a payment failed or the wait timed out;
 * 2 usage or configuration; 3 refused by a cap or a guard.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BatchGuardError,
  CapConfigError,
  FetchHorizon,
  RunLog,
  DEFAULT_RUN_LOG_PATH,
  RUN_LOG_ENV,
  SdpTenantClient,
  USDC_CODE,
  accountCeilingReason,
  capsFromEnv,
  formatBatchReport,
  guardBatchStart,
  loadEnvFile,
  maskAccount,
  paymentsOf,
  promptMfaCode,
  runBatch,
  sdpConfigFromEnv,
  selectDistributionWalletId,
  totalAmount,
  verifyHorizonNetwork,
} from '../dist/index.js';

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const disbursementId = opt('--disbursement');
if (!disbursementId) { console.error('usage: npm run sdp:batch -- --disbursement <id> [--check-only] [--skip-start] [--timeout-minutes 10] [--second-run "<reason>"]'); process.exit(2); }
const checkOnly = args.includes('--check-only');
const skipStart = args.includes('--skip-start');
const timeoutMs = Number(opt('--timeout-minutes') ?? 10) * 60_000;
const secondRunReason = args.includes('--second-run') ? (opt('--second-run') ?? '').trim() : undefined;
if (args.includes('--second-run') && !secondRunReason) { console.error('--second-run needs a reason in quotes; it is written to the run log'); process.exit(2); }

const envFile = loadEnvFile('sdp/.env');
const cfg = sdpConfigFromEnv(envFile);
try { await verifyHorizonNetwork(cfg.network); } catch (e) { console.error(e.message); process.exit(2); }
let caps;
try { caps = capsFromEnv({ ...envFile, ...process.env }); } catch (e) { console.error(e instanceof CapConfigError ? e.message : String(e)); process.exit(2); }
const asset = { code: USDC_CODE, issuer: cfg.network.assetIssuer };
const tenant = cfg.tenants[0];
const anon = new SdpTenantClient({ baseUrl: cfg.apiUrl, tenantName: tenant.name, strictMfa: cfg.strictMfa });
const client = await anon.authenticate(tenant.ownerEmail, tenant.ownerPassword, { mfaCode: promptMfaCode() });
const walletId = await selectDistributionWalletId(client);
const accounts = await client.listDistributionWallets();
const account = accounts.find((a) => a.id === walletId) ?? accounts[0];
const horizon = new FetchHorizon(cfg.network.horizonUrl, { timeoutMs: 20_000 });
const runLog = new RunLog(process.env[RUN_LOG_ENV] || envFile[RUN_LOG_ENV] || DEFAULT_RUN_LOG_PATH);

const d = await client.getDisbursement(disbursementId, walletId);
// every page, and the count must equal the disbursement's rows
const payments = await paymentsOf(client, disbursementId, walletId, d.total_payments);
const total = totalAmount(payments);
const onChain = await horizon.loadAccount(account.distribution_account_address);
const usdc = onChain.balances.find((b) => b.asset_code === asset.code && b.asset_issuer === asset.issuer)?.balance ?? '0';
console.log(`network ${cfg.network.networkType}, tenant ${tenant.name}, distribution account ${maskAccount(account.distribution_account_address)} (${account.name}), USDC balance ${usdc}, ceiling ${caps.maxAccountUsdc}`);
console.log(`disbursement ${d.id} "${d.name}": status ${d.status}, ${payments.length} payments, total ${total} USDC`);

// Cap: an over-funded distribution account refuses, before any start.
const ceiling = accountCeilingReason(usdc, caps);
if (ceiling) { console.error(`refused: ${ceiling}`); process.exit(3); }

if (checkOnly) {
  console.log(Number(usdc) >= Number(total) ? 'balance covers the total' : 'balance does NOT cover the total');
  console.log(`balance within the ${caps.maxAccountUsdc} USDC ceiling`);
  try {
    const seen = await guardBatchStart({ client, walletId, disbursementId, runLog: runLog.read(), now: new Date(), secondRunReason });
    const pausedNote = seen.pausedAllowed.length
      ? `; ${seen.pausedAllowed.length} paused disbursement(s) allowed past by the reason, with ${seen.pausedInProgress.length} payment(s) totalling ${totalAmount(seen.pausedInProgress)} USDC that the SDP still counts against the balance`
      : '';
    console.log(`guards pass: nothing STARTED; ${seen.completedToday.length} completed batch(es) recorded today${secondRunReason ? ' (second run allowed by the given reason)' : ''}${pausedNote}`);
  } catch (e) {
    if (e instanceof BatchGuardError) { console.error(`guards would refuse a start: ${e.reasons.join('; ')}`); process.exit(3); }
    throw e;
  }
  process.exit(0);
}

// Guards, only when this run is the one starting the disbursement.
let pausedAllowed = [];
if (!skipStart) {
  try {
    const seen = await guardBatchStart({ client, walletId, disbursementId, runLog: runLog.read(), now: new Date(), secondRunReason });
    pausedAllowed = seen.pausedAllowed.map((d) => d.id);
  } catch (e) {
    if (e instanceof BatchGuardError) { console.error(`refused: ${e.reasons.join('; ')}`); process.exit(3); }
    throw e;
  }
}

const run = new Date().toISOString().replace(/[:.]/g, '-');
const dir = join('test-output', 'd4-batch', run);
mkdirSync(dir, { recursive: true });
const base = { tenant: tenant.name, network: cfg.network.networkType, disbursementId: d.id, total };
if (!skipStart) runLog.append({ at: new Date().toISOString(), event: 'started', ...base, ...(secondRunReason ? { secondRunReason } : {}), ...(pausedAllowed.length ? { pausedAllowed } : {}) });
const result = await runBatch(
  { client, horizon, sleep: (ms) => new Promise((r) => setTimeout(r, ms)), now: () => Date.now() },
  { disbursementId, walletId, asset, timeoutMs, skipStart, distributionAccount: account.distribution_account_address },
);
runLog.append({ at: new Date().toISOString(), event: 'finished', ...base, finalStatus: result.finalStatus, timedOut: result.timedOut, ...(secondRunReason ? { secondRunReason } : {}) });
console.log(formatBatchReport(result));
const after = await horizon.loadAccount(account.distribution_account_address);
const evidence = {
  run, tenant: tenant.name, network: cfg.network.networkType, distributionAccount: maskAccount(account.distribution_account_address), disbursement: { id: d.id, name: d.name, statusBefore: d.status, total },
  caps, secondRunReason: secondRunReason ?? null,
  usdcBefore: usdc, usdcAfter: after.balances.find((b) => b.asset_code === asset.code && b.asset_issuer === asset.issuer)?.balance ?? '0',
  result,
};
writeFileSync(join(dir, 'evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`);
console.log(`evidence written to ${dir}/evidence.json; run log ${runLog.path}`);
// The point of the step is on-chain confirmation, so a payment whose
// confirmation found a mismatch, or whose transaction is not successful
// on Horizon, fails the run as a non-SUCCESS status does.
const unconfirmed = result.payments.some((p) => p.confirmError !== undefined || p.successful === false);
process.exit(result.timedOut || unconfirmed || result.payments.some((p) => p.status !== 'SUCCESS') ? 1 : 0);
