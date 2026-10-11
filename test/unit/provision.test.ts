import { describe, expect, it } from 'vitest';
import { verifyPin } from 'stellar-ussd-sep10-adapter';
import { provisionRecipients, SponsorUnderfundedError, type InputRow, type ProvisionDeps } from '../../src/provision/index.js';
import { EXISTING, FakeHorizon, FakeSigner, GONE, NETWORK, SPONSOR, USDC, rejection, serverError, stores, timeout } from './provisionFakes.js';

function setup(opts: { sponsorXlm?: string } = {}) {
  const horizon = new FakeHorizon();
  horizon.addAccount(SPONSOR, { xlm: opts.sponsorXlm ?? '100.0000000' });
  const signer = new FakeSigner();
  const s = stores();
  const deps: ProvisionDeps = { horizon, signer, ...s, sponsorPublicKey: SPONSOR, asset: USDC, networkPassphrase: NETWORK, paymentIdPrefix: 'batch' };
  return { horizon, signer, deps, ...s };
}
const rows: InputRow[] = [
  { rowIndex: 1, phone: '+999700000001', id: 'r1', amount: '1.5' },
  { rowIndex: 2, phone: '+999700000002', id: 'r2', amount: '2' },
];

/** The fake Horizon does not decode XDR; after a successful creation the test registers the account on it. */
async function createdAccountsOnChain(horizon: FakeHorizon, report: Awaited<ReturnType<typeof provisionRecipients>>) {
  for (const o of report.outcomes) if (o.accountId && o.status === 'created') horizon.addAccount(o.accountId, { xlm: '0.0000000', trustlines: [USDC], sponsored: 3 });
}

describe('provisionRecipients', () => {
  it('creates an account with a trustline per new phone, in one sponsored transaction each, and writes SDP rows in input order', async () => {
    const { horizon, deps, accountStore } = setup();
    const report = await provisionRecipients(rows, deps);
    expect(report.outcomes.map((o) => o.status)).toEqual(['created', 'created']);
    expect(horizon.submissions).toHaveLength(2);
    expect(report.outcomes[0]?.txHash).toBe('hash-0001');
    expect(await accountStore.get('+999700000001')).toBe(report.outcomes[0]?.accountId);
    expect(report.sdpRows).toEqual([
      { phone: '+999700000001', walletAddress: report.outcomes[0]!.accountId, walletAddressMemo: '', id: 'r1', amount: '1.5', paymentID: 'batch-r1' },
      { phone: '+999700000002', walletAddress: report.outcomes[1]!.accountId, walletAddressMemo: '', id: 'r2', amount: '2', paymentID: 'batch-r2' },
    ]);
    expect(report.outcomes[0]?.phoneMasked).toBe('+9997***0001');
  });

  it('a second run submits nothing, reports unchanged, and produces the same SDP rows', async () => {
    const { horizon, deps } = setup();
    const first = await provisionRecipients(rows, deps);
    await createdAccountsOnChain(horizon, first);
    const second = await provisionRecipients(rows, deps);
    expect(second.outcomes.map((o) => o.status)).toEqual(['unchanged', 'unchanged']);
    expect(horizon.submissions).toHaveLength(2);
    expect(second.sdpRows).toEqual(first.sdpRows);
  });

  it('adds only the trustline when the mapped account exists without one and the signer holds its key', async () => {
    const { horizon, deps, accountStore } = setup();
    await accountStore.put('+999700000001', EXISTING);
    horizon.addAccount(EXISTING, { xlm: '0', sponsored: 2 });
    deps.signer = Object.assign(new FakeSigner(), { keys: new Set([SPONSOR, EXISTING]) });
    const report = await provisionRecipients([rows[0]!], deps);
    expect(report.outcomes[0]?.status).toBe('trustline_added');
    expect(horizon.submissions).toHaveLength(1);
  });

  it('with the reference signer (no key for the mapped account) the trustline path reports signer_unavailable, not trustline_failure, and submits nothing', async () => {
    const { horizon, deps, accountStore } = setup();
    await accountStore.put('+999700000001', EXISTING);
    horizon.addAccount(EXISTING, { xlm: '0', sponsored: 2 });
    const report = await provisionRecipients([rows[0]!], deps);
    expect(report.outcomes[0]?.status).toBe('failed');
    expect(report.outcomes[0]?.errorCode).toBe('signer_unavailable');
    expect(report.outcomes[0]?.message).toContain('receive-only');
    expect(horizon.submissions).toHaveLength(0);
    expect(await accountStore.get('+999700000001')).toBe(EXISTING);
  });

  it('a failing row never stops the others and each failure carries its typed code', async () => {
    const { horizon, deps } = setup();
    horizon.nextErrors = [undefined, rejection('tx_failed', ['op_success', 'op_success', 'op_no_trust'])];
    const many: InputRow[] = [
      { rowIndex: 1, phone: 'not a phone', id: 'r1', amount: '1' },
      rows[0]!,
      { rowIndex: 3, phone: '+999700000003', id: 'r3', amount: '1' },
      { rowIndex: 4, phone: '+999700000004', id: 'r4', amount: '1' },
    ];
    const report = await provisionRecipients(many, deps);
    expect(report.outcomes.map((o) => [o.status, o.errorCode])).toEqual([
      ['failed', 'invalid_phone'],
      ['created', undefined],
      ['failed', 'trustline_failure'],
      ['created', undefined],
    ]);
    expect(report.sdpRows.map((r) => r.id)).toEqual(['r1', 'r4']);
    expect(report.counts).toEqual({ created: 2, trustlineAdded: 0, unchanged: 0, failed: 2, uncertain: 0, pinRefused: 0 });
  });

  it('classifies a creation rejection by change_trust result code, wherever the operation sits', async () => {
    const { horizon, deps } = setup();
    horizon.nextErrors = [
      rejection('tx_failed', ['op_success', 'op_success', 'op_no_issuer', 'op_success']),
      rejection('tx_failed', ['op_success', 'op_invalid_limit']),
      rejection('tx_failed', ['op_success', 'op_success', 'op_success', 'op_bad_auth']),
    ];
    const many: InputRow[] = [rows[0]!, rows[1]!, { rowIndex: 3, phone: '+999700000003', id: 'r3', amount: '1' }];
    const report = await provisionRecipients(many, deps);
    expect(report.outcomes.map((o) => o.errorCode)).toEqual(['trustline_failure', 'trustline_failure', 'resolver_failure']);
  });

  it('refuses the whole run before any transaction when the sponsor cannot pay for it', async () => {
    const { horizon, deps } = setup({ sponsorXlm: '2.0000000' });
    const err = await provisionRecipients(rows, deps).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SponsorUnderfundedError);
    expect((err as SponsorUnderfundedError).message).toContain(`${SPONSOR.slice(0, 4)}...${SPONSOR.slice(-4)}`);
    expect(horizon.submissions).toHaveLength(0);
  });

  it('maps an underfunded network result to sponsor_underfunded on the row', async () => {
    const { horizon, deps } = setup();
    horizon.nextErrors = [rejection('tx_insufficient_balance', [])];
    const report = await provisionRecipients([rows[0]!], deps);
    expect(report.outcomes[0]?.errorCode).toBe('sponsor_underfunded');
  });

  it('maps a Horizon timeout to horizon_timeout with the operation name', async () => {
    const { horizon, deps } = setup();
    horizon.nextErrors = [timeout('submitTransaction')];
    const report = await provisionRecipients([rows[0]!], deps);
    expect(report.outcomes[0]?.errorCode).toBe('horizon_timeout');
    expect(report.outcomes[0]?.message).toContain('submitTransaction');
  });

  it('a mapping whose account is not on chain is a resolver failure and the mapping is kept', async () => {
    const { deps, accountStore } = setup();
    await accountStore.put('+999700000001', GONE);
    const report = await provisionRecipients([rows[0]!], deps);
    expect(report.outcomes[0]?.errorCode).toBe('resolver_failure');
    expect(report.outcomes[0]?.message).toContain(`${GONE.slice(0, 4)}...${GONE.slice(-4)}`);
    expect(await accountStore.get('+999700000001')).toBe(GONE);
  });

  it('a store write failure after creation is a resolver failure that names the created account', async () => {
    const { deps } = setup();
    deps.accountStore = { get: async () => undefined, put: async () => { throw new Error('disk full'); }, delete: async () => {} };
    const report = await provisionRecipients([rows[0]!], deps);
    expect(report.outcomes[0]?.errorCode).toBe('resolver_failure');
    expect(report.outcomes[0]?.message).toContain('reconcile');
  });
});

describe('ambiguous submissions (timeout, 5xx, no result codes)', () => {
  const row = rows[0]!;

  it('a timeout after the creation landed: the account is read back, adopted, mapped, and never created twice', async () => {
    const { horizon, signer, deps, accountStore, pendingStore } = setup();
    horizon.nextErrors = [timeout('submitTransaction')];
    horizon.landOnNextError = () => signer.lastCreated;
    const first = await provisionRecipients([row], deps);
    const o = first.outcomes[0]!;
    expect(o.status).toBe('created');
    expect(o.errorCode).toBeUndefined();
    expect(o.accountId).toBe(signer.lastCreated);
    expect(o.txHash).toBeUndefined();
    expect(o.message).toContain('confirmed on chain after an ambiguous submission');
    expect(await accountStore.get(row.phone)).toBe(signer.lastCreated);
    expect(await pendingStore.get(row.phone)).toBeUndefined();
    expect(first.sdpRows.map((r) => r.walletAddress)).toEqual([signer.lastCreated]);
    const second = await provisionRecipients([row], deps);
    expect(second.outcomes[0]?.status).toBe('unchanged');
    expect(horizon.submissions).toHaveLength(0);
  });

  it('a timeout with nothing landed: the row fails as horizon_timeout, the pending record is cleared, the next run creates', async () => {
    const { horizon, deps, pendingStore, accountStore } = setup();
    horizon.nextErrors = [timeout('submitTransaction')];
    const first = await provisionRecipients([row], deps);
    expect(first.outcomes[0]?.errorCode).toBe('horizon_timeout');
    expect(first.outcomes[0]?.status).toBe('failed');
    expect(await pendingStore.get(row.phone)).toBeUndefined();
    expect(await accountStore.get(row.phone)).toBeUndefined();
    const second = await provisionRecipients([row], deps);
    expect(second.outcomes[0]?.status).toBe('created');
    expect(horizon.submissions).toHaveLength(1);
  });

  it('a 5xx on submission is non-definitive too: the landed account is adopted', async () => {
    const { horizon, signer, deps } = setup();
    horizon.nextErrors = [serverError(503)];
    horizon.landOnNextError = () => signer.lastCreated;
    const report = await provisionRecipients([row], deps);
    expect(report.outcomes[0]?.status).toBe('created');
    expect(report.outcomes[0]?.accountId).toBe(signer.lastCreated);
  });

  it('a timeout and then an unreadable Horizon: uncertain with the account id, no SDP row, the pending record kept; a later run adopts it', async () => {
    const { horizon, signer, deps, pendingStore, accountStore } = setup();
    horizon.nextErrors = [timeout('submitTransaction')];
    horizon.landOnNextError = () => signer.lastCreated;
    signer.onCreate = (id) => horizon.failLoadFor.set(id, timeout('loadAccount'));
    const first = await provisionRecipients([row], deps);
    const o = first.outcomes[0]!;
    expect(o.status).toBe('uncertain');
    expect(o.errorCode).toBe('creation_uncertain');
    expect(o.accountId).toBe(signer.lastCreated);
    expect(o.message).toContain('reconcile');
    expect(first.sdpRows).toEqual([]);
    expect(first.counts.uncertain).toBe(1);
    expect(first.counts.failed).toBe(0);
    expect((await pendingStore.get(row.phone))?.accountId).toBe(signer.lastCreated);
    expect(await accountStore.get(row.phone)).toBeUndefined();
    // Horizon is back: the pending record is checked first and adopted, nothing is submitted
    horizon.failLoadFor.clear();
    const created = signer.lastCreated;
    const second = await provisionRecipients([row], deps);
    expect(second.outcomes[0]?.status).toBe('created');
    expect(second.outcomes[0]?.accountId).toBe(created);
    expect(second.outcomes[0]?.message).toContain('pending record');
    expect(await accountStore.get(row.phone)).toBe(created);
    expect(await pendingStore.get(row.phone)).toBeUndefined();
    expect(horizon.submissions).toHaveLength(0);
  });

  it('a stale pending record whose account never landed is forgotten and a fresh creation runs', async () => {
    const { horizon, deps, pendingStore } = setup();
    await pendingStore.put(row.phone, { accountId: GONE, at: '2026-10-10T00:00:00Z' });
    const report = await provisionRecipients([row], deps);
    expect(report.outcomes[0]?.status).toBe('created');
    expect(report.outcomes[0]?.accountId).not.toBe(GONE);
    expect(horizon.submissions).toHaveLength(1);
    expect(await pendingStore.get(row.phone)).toBeUndefined();
  });

  it('a definitive rejection never reads the account back and clears the pending record', async () => {
    const { horizon, deps, pendingStore } = setup();
    horizon.nextErrors = [rejection('tx_failed', ['op_success', 'op_success', 'op_no_trust'])];
    const report = await provisionRecipients([row], deps);
    expect(report.outcomes[0]?.errorCode).toBe('trustline_failure');
    expect(await pendingStore.get(row.phone)).toBeUndefined();
  });
});

describe('PIN binding (testnet pin column)', () => {
  const withPin = (pin: string): InputRow => ({ rowIndex: 1, phone: '+999700000001', id: 'r1', amount: '1', pin });

  it('stores a scrypt hash, never the PIN', async () => {
    const { deps, pinStore } = setup();
    const report = await provisionRecipients([withPin('4729')], deps);
    expect(report.outcomes[0]?.pin).toBe('set');
    const record = await pinStore.get('+999700000001');
    expect(record?.hash).toMatch(/^scrypt\$/);
    expect(JSON.stringify(record)).not.toContain('4729');
  });

  it('never replaces an existing PIN: a second run with a different PIN keeps the first', async () => {
    const { horizon, deps, pinStore } = setup();
    const first = await provisionRecipients([withPin('4729')], deps);
    await createdAccountsOnChain(horizon, first);
    const before = (await pinStore.get('+999700000001'))!.hash;
    const second = await provisionRecipients([withPin('8351')], deps);
    expect(second.outcomes[0]?.pin).toBe('kept');
    expect((await pinStore.get('+999700000001'))!.hash).toBe(before);
    expect(await verifyPin('4729', before)).toBe(true);
    expect(await verifyPin('8351', before)).toBe(false);
  });

  it('refuses a malformed or weak PIN without writing a record; the account outcome stands', async () => {
    for (const bad of ['12', '1234', 'abcd']) {
      const { deps, pinStore } = setup();
      const report = await provisionRecipients([withPin(bad)], deps);
      expect(report.outcomes[0]?.status).toBe('created');
      expect(report.outcomes[0]?.pin).toBe('refused');
      expect(report.outcomes[0]?.errorCode).toBe('pin_input');
      expect(await pinStore.get('+999700000001')).toBeUndefined();
      expect(report.counts.pinRefused).toBe(1);
    }
  });

  it('a PIN with no PIN store configured is refused, not silently dropped', async () => {
    const { deps } = setup();
    deps.pinStore = undefined;
    const report = await provisionRecipients([withPin('4729')], deps);
    expect(report.outcomes[0]?.pin).toBe('refused');
  });
});
