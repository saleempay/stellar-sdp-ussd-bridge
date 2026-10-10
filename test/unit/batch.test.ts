import { describe, expect, it } from 'vitest';
import { SdpTenantClient } from '../../src/sdp/client.js';
import { formatBatchReport, paymentsOf, runBatch, totalAmount, type BatchDeps } from '../../src/sdp/batch.js';
import { fakeFetch, type Recorded } from './helpers.js';

const USDC = { code: 'USDC', issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5' };
const DIST = 'G'.padEnd(56, 'D');
const R1 = 'G'.padEnd(56, '1');
const R2 = 'G'.padEnd(56, '2');

/** A fake SDP whose payments advance one step per poll, plus a fake Horizon. */
function fakeWorld(opts: { fail?: boolean; stuck?: boolean } = {}) {
  let polls = 0;
  let status = 'READY';
  const sequence = opts.fail ? ['READY', 'PENDING', 'FAILED'] : ['READY', 'PENDING', 'SUCCESS'];
  const patched: Recorded[] = [];
  const route = (r: Recorded) => {
    const p = new URL(r.url).pathname;
    if (p === '/disbursements/d1/status') { patched.push(r); status = 'STARTED'; return { status: 200, body: {} }; }
    if (p === '/disbursements/d1') {
      const idx = Math.min(polls, sequence.length - 1);
      const final = sequence[idx] !== 'READY' && sequence[idx] !== 'PENDING';
      return { status: 200, body: { id: 'd1', name: 'batch', status: status === 'STARTED' && final && !opts.stuck ? 'COMPLETED' : status } };
    }
    if (p === '/payments') {
      const idx = Math.min(polls, sequence.length - 1);
      polls += 1;
      const st = opts.stuck ? 'PENDING' : sequence[idx];
      const tx = (s: string, n: string) => (s === 'SUCCESS' || s === 'FAILED' ? `${n}`.repeat(64) : null);
      return { status: 200, body: { data: [
        { id: 'p1', amount: '1.5000000', status: st, stellar_transaction_id: tx(st!, 'a'), disbursement: { id: 'd1' }, receiver_wallet: { stellar_address: R1, receiver: { id: 'r1' } } },
        { id: 'p2', amount: '2.0000000', status: st, stellar_transaction_id: tx(st!, 'b'), disbursement: { id: 'd1' }, receiver_wallet: { stellar_address: R2, receiver: { id: 'r2' } } },
        { id: 'px', amount: '9.0000000', status: 'SUCCESS', stellar_transaction_id: 'c'.repeat(64), disbursement: { id: 'other' } },
      ], pagination: {} } };
    }
    return undefined;
  };
  const { fetchImpl, calls } = fakeFetch(route);
  const client = new SdpTenantClient({ baseUrl: 'http://api:8000', tenantName: 'bridge', token: 't', fetch: fetchImpl });
  const horizon: BatchDeps['horizon'] = {
    async transaction(hash) { return { hash, ledger: 5_100_000, created_at: '2026-10-08T10:00:00Z', successful: true, source_account: DIST, operation_count: 1 }; },
    async operationsOf(hash) { return [{ type: 'payment', created_at: '2026-10-08T10:00:00Z', transaction_hash: hash, from: DIST, to: hash.startsWith('a') ? R1 : R2, amount: hash.startsWith('a') ? '1.5000000' : '2.0000000', asset_type: 'credit_alphanum4', asset_code: 'USDC', asset_issuer: USDC.issuer }]; },
    async loadAccount() { throw new Error('not used'); },
  };
  let clock = Date.parse('2026-10-08T10:00:00Z');
  const deps: BatchDeps = { client, horizon, sleep: async (ms) => { clock += ms; }, now: () => clock };
  return { deps, calls, patched };
}

describe('runBatch', () => {
  it('starts the disbursement, follows payments to SUCCESS and COMPLETED, and confirms each on Horizon', async () => {
    const w = fakeWorld();
    const r = await runBatch(w.deps, { disbursementId: 'd1', walletId: 'dw1', asset: USDC, pollMs: 1000 });
    expect(w.patched).toHaveLength(1);
    expect(JSON.parse(w.patched[0]!.body!)).toEqual({ status: 'STARTED' });
    expect(w.patched[0]?.headers['X-Wallet-Id']).toBe('dw1');
    expect(r.started).toBe(true);
    expect(r.finalStatus).toBe('COMPLETED');
    expect(r.timedOut).toBe(false);
    expect(r.payments.map((p) => [p.status, p.operation?.to, p.operation?.amount])).toEqual([
      ['SUCCESS', 'GGGG...2222'.replace('GGGG...2222', `${R1.slice(0, 4)}...${R1.slice(-4)}`), '1.5000000'],
      ['SUCCESS', `${R2.slice(0, 4)}...${R2.slice(-4)}`, '2.0000000'],
    ]);
    expect(r.payments.every((p) => p.ledger === 5_100_000 && p.successful)).toBe(true);
    expect(r.timeline.map((t) => t.payments.map((p) => p.status).join(','))).toEqual(['READY,READY', 'PENDING,PENDING', 'SUCCESS,SUCCESS']);
    expect(r.payments.every((p) => p.txHash && p.txHash.length === 64)).toBe(true);
  });

  it('reports FAILED payments as terminal and does not pretend they succeeded', async () => {
    const w = fakeWorld({ fail: true });
    const r = await runBatch(w.deps, { disbursementId: 'd1', asset: USDC, pollMs: 1000 });
    expect(r.payments.map((p) => p.status)).toEqual(['FAILED', 'FAILED']);
    expect(formatBatchReport(r)).toContain('FAILED');
  });

  it('times out when payments never reach a terminal state and says so', async () => {
    const w = fakeWorld({ stuck: true });
    const r = await runBatch(w.deps, { disbursementId: 'd1', asset: USDC, pollMs: 1000, timeoutMs: 5000 });
    expect(r.timedOut).toBe(true);
    expect(r.payments.every((p) => p.status === 'PENDING' && p.txHash === null)).toBe(true);
    expect(formatBatchReport(r)).toContain('timed out');
  });

  it('skipStart sends no status patch', async () => {
    const w = fakeWorld();
    const r = await runBatch(w.deps, { disbursementId: 'd1', asset: USDC, pollMs: 1000, skipStart: true });
    expect(w.patched).toHaveLength(0);
    expect(r.started).toBe(false);
  });

  it('paymentsOf keeps only the disbursement\'s payments', async () => {
    const w = fakeWorld();
    const ps = await paymentsOf(w.deps.client, 'd1');
    expect(ps.map((p) => p.id)).toEqual(['p1', 'p2']);
  });

  it('masks accounts in the report and never carries a full address', async () => {
    const w = fakeWorld();
    const r = await runBatch(w.deps, { disbursementId: 'd1', asset: USDC, pollMs: 1000 });
    const text = `${formatBatchReport(r)} ${JSON.stringify(r)}`;
    expect(text).not.toContain(R1);
    expect(text).not.toContain(DIST);
  });
});

describe('totalAmount', () => {
  it('sums decimal strings exactly', () => {
    expect(totalAmount([{ amount: '1.5' }, { amount: '2' }, { amount: '2.5' }, { amount: '3' }, { amount: '3.5' }])).toBe('12.5000000');
    expect(totalAmount([{ amount: '0.0000001' }, { amount: '0.0000002' }])).toBe('0.0000003');
    expect(totalAmount([])).toBe('0.0000000');
  });
});
