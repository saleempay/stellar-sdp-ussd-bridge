/**
 * Live testnet run of the provisioning bridge: five recipients, then the
 * same input again. Gated on RUN_TESTNET_E2E=1 and a .env with the sponsor
 * (npm run sponsor:setup). When sdp/.env is present and the SDP tenant is
 * up, the generated file is also uploaded to the bridge tenant.
 *
 * Writes test-output/d2-e2e/<run>/ with the input, the output, and
 * evidence.json (phones and accounts masked; the output file itself holds
 * full recipient addresses, as the SDP needs them). No secret is written.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { describe, expect, it } from 'vitest';
import { JsonFileAccountStore, LocalKeypairSigner } from 'stellar-ussd-sep10-adapter';
import {
  FetchHorizon,
  SdpTenantClient,
  TESTNET_HORIZON_URL,
  TESTNET_NETWORK_PASSPHRASE,
  TESTNET_USDC_ISSUER,
  USDC_CODE,
  formatProvisionReport,
  loadEnvFile,
  maskAccount,
  maskPhone,
  parseInputCsv,
  provisionRecipients,
  sdpConfigFromEnv,
  sha256Hex,
  uploadDisbursementFile,
  writeSdpCsv,
} from '../../src/index.js';

const enabled = process.env.RUN_TESTNET_E2E === '1';

describe.skipIf(!enabled)('D2 live: five recipients on testnet', () => {
  it('provisions five recipients, then changes nothing on a second run', async () => {
    const env = parseEnv(readFileSync('.env', 'utf8')) as Record<string, string>;
    expect(env.SPONSOR_SECRET_KEY, 'run npm run sponsor:setup first').toBeTruthy();
    const horizon = new FetchHorizon(env.HORIZON_URL || TESTNET_HORIZON_URL, { timeoutMs: 30_000 });
    const signer = new LocalKeypairSigner();
    const sponsor = signer.importSecret(env.SPONSOR_SECRET_KEY!);
    const asset = { code: env.ASSET_CODE || USDC_CODE, issuer: env.ASSET_ISSUER || TESTNET_USDC_ISSUER };
    const run = new Date().toISOString().replace(/[:.]/g, '-');
    const dir = join('test-output', 'd2-e2e', run);
    mkdirSync(dir, { recursive: true });

    // five synthetic numbers in the sandbox convention, unique per run
    const seed = String(Math.floor(Math.random() * 1e6)).padStart(6, '0');
    const input = `phone,id,amount\n${[1.5, 2, 2.5, 3, 3.5].map((a, i) => `+2547${seed}${i + 1}${i + 1},r${i + 1},${a}`).join('\n')}\n`;
    writeFileSync(join(dir, 'recipients.csv'), input);
    const rows = parseInputCsv(input);
    const deps = {
      horizon, signer, accountStore: new JsonFileAccountStore(join(dir, 'accounts.json')),
      sponsorPublicKey: sponsor, asset, networkPassphrase: TESTNET_NETWORK_PASSPHRASE, paymentIdPrefix: 'recipients',
    };

    const sponsorBefore = await horizon.loadAccount(sponsor);
    const txBefore = await horizon.countTransactions(sponsor);

    const first = await provisionRecipients(rows, deps);
    expect(first.outcomes.map((o) => o.status)).toEqual(['created', 'created', 'created', 'created', 'created']);
    const csv1 = writeSdpCsv(first.sdpRows);
    writeFileSync(join(dir, 'd2-disbursement.csv'), csv1);

    // read every new account back from the ledger
    const accounts = [];
    for (const o of first.outcomes) {
      const a = await horizon.loadAccount(o.accountId!);
      const usdc = a.balances.find((b) => b.asset_code === asset.code && b.asset_issuer === asset.issuer);
      expect(usdc, `trustline on ${o.accountMasked}`).toBeDefined();
      accounts.push({ account: o.accountMasked, txHash: o.txHash, ledger: o.ledger, numSponsored: a.numSponsored, xlm: a.balances.find((b) => b.asset_type === 'native')?.balance, usdc: usdc?.balance });
      expect(a.numSponsored).toBe(3);
    }
    const sponsorAfter1 = await horizon.loadAccount(sponsor);
    const txAfter1 = await horizon.countTransactions(sponsor);
    expect(txAfter1 - txBefore).toBe(5);

    const second = await provisionRecipients(rows, deps);
    expect(second.outcomes.map((o) => o.status)).toEqual(['unchanged', 'unchanged', 'unchanged', 'unchanged', 'unchanged']);
    const csv2 = writeSdpCsv(second.sdpRows);
    expect(csv2).toBe(csv1);
    const txAfter2 = await horizon.countTransactions(sponsor);
    expect(txAfter2).toBe(txAfter1);

    // upload to the SDP tenant; skipped only when sdp/.env is absent or
    // the tenant is down, never on an SDP error
    let sdp: Record<string, unknown>;
    let client: SdpTenantClient | undefined;
    try {
      const cfg = sdpConfigFromEnv(loadEnvFile('sdp/.env'));
      const tenant = cfg.tenants[0]!;
      const anon = new SdpTenantClient({ baseUrl: cfg.apiUrl, tenantName: tenant.name });
      if (await anon.health()) client = anon.withToken(await anon.login(tenant.ownerEmail, tenant.ownerPassword));
      sdp = client ? { tenant: tenant.name } : { skipped: 'SDP tenant not reachable' };
    } catch (e) {
      sdp = { skipped: `no SDP configuration: ${(e as Error).message.split('\n')[0]}` };
    }
    if (client) {
      const up = await uploadDisbursementFile(client, { name: `D2 e2e ${run}`, csv: csv1, filename: 'd2-disbursement.csv' });
      sdp = { ...sdp, distributionAccount: up.walletId, disbursementId: up.disbursement.id, statusAfterUpload: up.statusAfterUpload, receivers: up.receiverCount, receiverWalletStatuses: up.receiverWalletStatuses };
      expect(up.statusAfterUpload).toBe('READY');
      expect(up.receiverWalletStatuses).toEqual(['REGISTERED', 'REGISTERED', 'REGISTERED', 'REGISTERED', 'REGISTERED']);
    }

    const evidence = {
      run, network: 'testnet', horizon: horizon.baseUrl, asset: { code: asset.code, issuer: maskAccount(asset.issuer) },
      sponsor: { account: maskAccount(sponsor), xlmBefore: sponsorBefore.balances.find((b) => b.asset_type === 'native')?.balance, xlmAfterFirstRun: sponsorAfter1.balances.find((b) => b.asset_type === 'native')?.balance, numSponsoringBefore: sponsorBefore.numSponsoring, numSponsoringAfter: sponsorAfter1.numSponsoring, transactionsBefore: txBefore, transactionsAfterFirstRun: txAfter1, transactionsAfterSecondRun: txAfter2 },
      firstRun: { report: formatProvisionReport(first), accounts, phones: rows.map((r) => maskPhone(r.phone)) },
      secondRun: { report: formatProvisionReport(second), outputIdentical: csv1 === csv2 },
      output: { file: 'd2-disbursement.csv', sha256: sha256Hex(csv1), rows: first.sdpRows.length, header: csv1.split('\n')[0] },
      sdp,
    };
    writeFileSync(join(dir, 'evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`);
    console.log(`evidence written to ${dir}/evidence.json`);
  }, 600_000);
});
