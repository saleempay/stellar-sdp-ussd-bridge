import { describe, expect, it } from 'vitest';
import { SdpTenantClient } from '../../src/sdp/client.js';
import { PaymentsIncompleteError, formatBatchReport, paymentsOf, runBatch, totalAmount, type BatchDeps } from '../../src/sdp/batch.js';
import { fakeFetch, type Recorded } from './helpers.js';

const USDC = { code: 'USDC', issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5' };
const DIST = 'G'.padEnd(56, 'D');
const R1 = 'G'.padEnd(56, '1');
const R2 = 'G'.padEnd(56, '2');

/**
 * A fake SDP whose payments advance one step per poll, plus a fake Horizon.
 * The payments list is served in pages of `pageSize` rows (default 2) with
 * `pagination.next` set while rows remain, as the SDP does; the two rows
 * of disbursement d1 sit on different pages behind rows of other
 * disbursements, so a one-page reader would see only part of the batch.
 */
function fakeWorld(opts: { fail?: boolean; stuck?: boolean; pageSize?: number; totalPayments?: number; wrong?: 'recipient' | 'amount' | 'source' | 'failed' } = {}) {
  let polls = 0;
  let status = 'READY';
  const sequence = opts.fail ? ['READY', 'PENDING', 'FAILED'] : ['READY', 'PENDING', 'SUCCESS'];
  const patched: Recorded[] = [];
  const pageRequests: Array<{ page: number; pageLimit: number }> = [];
  const pageSize = opts.pageSize ?? 2;
  const route = (r: Recorded) => {
    const u = new URL(r.url);
    const p = u.pathname;
    if (p === '/disbursements/d1/status') { patched.push(r); status = 'STARTED'; return { status: 200, body: {} }; }
    if (p === '/disbursements/d1') {
      const idx = Math.min(polls, sequence.length - 1);
      const final = sequence[idx] !== 'READY' && sequence[idx] !== 'PENDING';
      return { status: 200, body: { id: 'd1', name: 'batch', total_payments: opts.totalPayments ?? 2, status: status === 'STARTED' && final && !opts.stuck ? 'COMPLETED' : status } };
    }
    if (p === '/payments') {
      const page = Number(u.searchParams.get('page') ?? '1');
      const pageLimit = Number(u.searchParams.get('page_limit') ?? '20');
      pageRequests.push({ page, pageLimit });
      // one poll is one pass over the pages: advance the sequence on page 1 only
      const idx = Math.min(page === 1 ? polls : polls - 1, sequence.length - 1);
      if (page === 1) polls += 1;
      const st = opts.stuck ? 'PENDING' : sequence[Math.max(idx, 0)];
      const tx = (s: string, n: string) => (s === 'SUCCESS' || s === 'FAILED' ? `${n}`.repeat(64) : null);
      const all = [
        { id: 'px', amount: '9.0000000', status: 'SUCCESS', stellar_transaction_id: 'c'.repeat(64), disbursement: { id: 'other' } },
        { id: 'p1', amount: '1.5000000', status: st, stellar_transaction_id: tx(st!, 'a'), disbursement: { id: 'd1' }, receiver_wallet: { stellar_address: R1, receiver: { id: 'r1' } } },
        { id: 'py', amount: '4.0000000', status: 'SUCCESS', stellar_transaction_id: 'd'.repeat(64), disbursement: { id: 'other' } },
        { id: 'p2', amount: '2.0000000', status: st, stellar_transaction_id: tx(st!, 'b'), disbursement: { id: 'd1' }, receiver_wallet: { stellar_address: R2, receiver: { id: 'r2' } } },
      ];
      const start = (page - 1) * pageSize;
      const data = all.slice(start, start + pageSize);
      const pages = Math.ceil(all.length / pageSize);
      const pagination: Record<string, unknown> = { pages, total: all.length };
      if (page < pages) pagination.next = `/payments?page=${page + 1}&page_limit=${pageLimit}`;
      return { status: 200, body: { data, pagination } };
    }
    return undefined;
  };
  const { fetchImpl, calls } = fakeFetch(route);
  const client = new SdpTenantClient({ baseUrl: 'http://api:8000', tenantName: 'bridge', token: 't', fetch: fetchImpl });
  const OTHER = 'G'.padEnd(56, '9');
  const horizon: BatchDeps['horizon'] = {
    async transaction(hash) { return { hash, ledger: 5_100_000, created_at: '2026-10-08T10:00:00Z', successful: opts.wrong !== 'failed', source_account: DIST, operation_count: 1 }; },
    async operationsOf(hash) {
      const to = opts.wrong === 'recipient' ? OTHER : hash.startsWith('a') ? R1 : R2;
      const amount = opts.wrong === 'amount' ? '7.0000000' : hash.startsWith('a') ? '1.5000000' : '2.0000000';
      const from = opts.wrong === 'source' ? OTHER : DIST;
      return [{ type: 'payment', created_at: '2026-10-08T10:00:00Z', transaction_hash: hash, from, to, amount, asset_type: 'credit_alphanum4', asset_code: 'USDC', asset_issuer: USDC.issuer }];
    },
    async loadAccount() { throw new Error('not used'); },
  };
  let clock = Date.parse('2026-10-08T10:00:00Z');
  const deps: BatchDeps = { client, horizon, sleep: async (ms) => { clock += ms; }, now: () => clock };
  return { deps, calls, patched, pageRequests };
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

  it('confirms only when the operation pays the row\'s recipient, the row\'s amount, from the distribution account', async () => {
    const ok = await runBatch(fakeWorld().deps, { disbursementId: 'd1', asset: USDC, pollMs: 1000, distributionAccount: DIST });
    expect(ok.payments.every((p) => p.confirmError === undefined)).toBe(true);
    for (const [wrong, text] of [
      ['recipient', /recipient G999...9999 is not the SDP row's/],
      ['amount', /amount 7.0000000 is not the SDP row's 1.5000000/],
      ['source', /source G999...9999 is not the distribution account/],
      ['failed', /not successful on Horizon/],
    ] as const) {
      const r = await runBatch(fakeWorld({ wrong }).deps, { disbursementId: 'd1', asset: USDC, pollMs: 1000, distributionAccount: DIST });
      expect(r.payments[0]?.confirmError, wrong).toMatch(text);
      expect(formatBatchReport(r)).toContain('confirm: mismatch');
      expect(`${formatBatchReport(r)} ${JSON.stringify(r)}`).not.toContain(R1);
    }
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

  it('paymentsOf reads every page at page_limit 100 and keeps only the disbursement\'s payments', async () => {
    const w = fakeWorld();
    const ps = await paymentsOf(w.deps.client, 'd1');
    expect(ps.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(w.pageRequests).toEqual([{ page: 1, pageLimit: 100 }, { page: 2, pageLimit: 100 }]);
  });

  it('paymentsOf refuses a set whose count differs from the disbursement\'s rows', async () => {
    const w = fakeWorld({ totalPayments: 3 });
    await expect(paymentsOf(w.deps.client, 'd1', undefined, 3)).rejects.toBeInstanceOf(PaymentsIncompleteError);
    expect(await paymentsOf(w.deps.client, 'd1', undefined, 2)).toHaveLength(2);
  });

  it('runBatch fails rather than judging a batch complete on a partial set', async () => {
    const w = fakeWorld({ totalPayments: 3 });
    await expect(runBatch(w.deps, { disbursementId: 'd1', asset: USDC, pollMs: 1000 })).rejects.toThrow(/incomplete/);
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
