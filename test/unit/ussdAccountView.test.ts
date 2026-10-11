import { describe, expect, it } from 'vitest';
import { AccountNotOnChainError, AccountReadError, DEFAULT_LEG_TIMEOUT_MS, NoUsdcTrustlineError, VIEW_BUDGET_MS, VIEW_RETRY_PAUSE_MS, describeReadFailure, formatReadFailure, loadAccountView, selectLastReceived } from '../../src/ussd/index.js';
import { HorizonTimeoutError } from '../../src/provision/errors.js';
import { toAccountRecord, type PaymentRecord } from '../../src/provision/horizon.js';

const ME = 'G'.padEnd(56, 'A');
const OTHER = 'G'.padEnd(56, 'B');
const USDC = { code: 'USDC', issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5' };
const rec = (over: Partial<PaymentRecord>): PaymentRecord => ({ type: 'payment', created_at: '2026-10-05T00:00:00Z', transaction_hash: 'h', transaction_successful: true, from: OTHER, to: ME, amount: '1.0000000', asset_type: 'credit_alphanum4', asset_code: 'USDC', asset_issuer: USDC.issuer, ...over });

describe('selectLastReceived', () => {
  it('takes the newest incoming USDC payment, skipping outgoing, other assets, XLM and account creation', () => {
    const records = [
      rec({ type: 'create_account', amount: undefined, asset_type: undefined, asset_code: undefined, created_at: '2026-10-09T00:00:00Z' }),
      rec({ to: OTHER, from: ME, amount: '9.0000000', created_at: '2026-10-08T00:00:00Z' }),
      rec({ asset_code: 'EURC', asset_issuer: 'G'.padEnd(56, 'E'), amount: '8.0000000', created_at: '2026-10-07T00:00:00Z' }),
      rec({ asset_type: 'native', asset_code: undefined, asset_issuer: undefined, amount: '7.0000000', created_at: '2026-10-06T00:00:00Z' }),
      rec({ asset_issuer: 'G'.padEnd(56, 'F'), amount: '6.0000000', created_at: '2026-10-05T12:00:00Z' }),
      rec({ amount: '2.5000000', created_at: '2026-10-05T00:00:00Z' }),
      rec({ amount: '1.0000000', created_at: '2026-10-04T00:00:00Z' }),
    ];
    expect(selectLastReceived(records, ME, USDC)).toEqual({ amount: '2.5000000', createdAt: '2026-10-05T00:00:00Z' });
  });

  it('accepts path payments to the account and skips failed operations', () => {
    expect(selectLastReceived([rec({ type: 'path_payment_strict_send', amount: '3.0000000' })], ME, USDC)?.amount).toBe('3.0000000');
    expect(selectLastReceived([rec({ transaction_successful: false })], ME, USDC)).toBeUndefined();
  });

  it('is undefined with no records or no match', () => {
    expect(selectLastReceived([], ME, USDC)).toBeUndefined();
    expect(selectLastReceived([rec({ to: OTHER })], ME, USDC)).toBeUndefined();
  });
});

describe('loadAccountView', () => {
  const account = (balances: Array<{ asset_type: string; asset_code?: string; asset_issuer?: string; balance: string }>) =>
    toAccountRecord({ id: ME, sequence: '1', subentry_count: 1, num_sponsoring: 0, num_sponsored: 3, balances });

  it('returns the USDC balance and the last received payment', async () => {
    const view = await loadAccountView({
      horizon: { async loadAccount() { return account([{ asset_type: 'credit_alphanum4', asset_code: 'USDC', asset_issuer: USDC.issuer, balance: '12.5000000' }, { asset_type: 'native', balance: '0.0000000' }]); }, async paymentsFor() { return [rec({ amount: '10.0000000' })]; } },
      asset: USDC,
    }, ME);
    expect(view).toEqual({ balance: '12.5000000', lastReceived: { amount: '10.0000000', createdAt: '2026-10-05T00:00:00Z' } });
  });

  it('omits lastReceived when there is none', async () => {
    const view = await loadAccountView({ horizon: { async loadAccount() { return account([{ asset_type: 'credit_alphanum4', asset_code: 'USDC', asset_issuer: USDC.issuer, balance: '0.0000000' }]); }, async paymentsFor() { return []; } }, asset: USDC }, ME);
    expect(view).toEqual({ balance: '0.0000000' });
  });

  it('a missing USDC trustline is NoUsdcTrustlineError', async () => {
    await expect(loadAccountView({ horizon: { async loadAccount() { return account([{ asset_type: 'native', balance: '5.0000000' }]); }, async paymentsFor() { return []; } }, asset: USDC }, ME)).rejects.toBeInstanceOf(NoUsdcTrustlineError);
  });

  it('a 404 is AccountNotOnChainError', async () => {
    const notFound = Object.assign(new Error('nf'), { status: 404 });
    await expect(loadAccountView({ horizon: { async loadAccount() { throw notFound; }, async paymentsFor() { return []; } }, asset: USDC }, ME)).rejects.toBeInstanceOf(AccountNotOnChainError);
  });

  it('any other failure propagates (the machine maps it to E4)', async () => {
    await expect(loadAccountView({ horizon: { async loadAccount() { throw new Error('timeout'); }, async paymentsFor() { return []; } }, asset: USDC, sleep: async () => undefined }, ME)).rejects.toThrow('timeout');
  });
});

describe('loadAccountView: one retry inside the time budget (11 October finding)', () => {
  const ok = () => toAccountRecord({ id: ME, sequence: '1', subentry_count: 1, num_sponsoring: 0, num_sponsored: 3, balances: [{ asset_type: 'credit_alphanum4', asset_code: 'USDC', asset_issuer: USDC.issuer, balance: '3.0000000' }] });
  /** A Horizon fake whose loadAccount fails with each listed error in turn, then succeeds; payments always succeed. */
  function flaky(failures: unknown[]) {
    const calls: string[] = [];
    const queue = [...failures];
    return {
      calls,
      horizon: {
        async loadAccount() { calls.push('loadAccount'); const f = queue.shift(); if (f !== undefined) throw f; return ok(); },
        async paymentsFor() { calls.push('payments'); return [rec({ amount: '3.0000000' })]; },
      },
    };
  }
  const clock = () => { let t = 0; const sleeps: number[] = []; return { now: () => t, sleep: async (ms: number) => { sleeps.push(ms); t += ms; }, advance: (ms: number) => { t += ms; }, sleeps }; };
  const transport = () => new TypeError('fetch failed', { cause: Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }) });
  const horizonStatus = (status: number) => Object.assign(new Error(`Horizon loadAccount returned HTTP ${status}`), { status });

  it('a transport failure then a success shows the account view, after one pause, with the retry logged with the cause code', async () => {
    const f = flaky([transport()]);
    const c = clock();
    const logs: string[] = [];
    const view = await loadAccountView({ horizon: f.horizon, asset: USDC, now: c.now, sleep: c.sleep, log: (l) => logs.push(l) }, ME);
    expect(view).toEqual({ balance: '3.0000000', lastReceived: { amount: '3.0000000', createdAt: '2026-10-05T00:00:00Z' } });
    expect(c.sleeps).toEqual([1_000]);
    expect(f.calls.filter((x) => x === 'loadAccount')).toHaveLength(2);
    expect(logs).toEqual(['event=viewRetry code=TypeError cause=ECONNRESET pauseMs=1000']);
  });

  it('two failures end in AccountReadError carrying the attempt count and the last failure', async () => {
    const f = flaky([transport(), horizonStatus(503)]);
    const c = clock();
    const err = await loadAccountView({ horizon: f.horizon, asset: USDC, now: c.now, sleep: c.sleep }, ME).catch((e) => e);
    expect(err).toBeInstanceOf(AccountReadError);
    expect(err.attempts).toBe(2);
    expect(err.failure).toEqual({ code: 'Error', status: 503 });
    expect(c.sleeps).toEqual([1_000]);
  });

  it('a 404 is AccountNotOnChainError at once: no retry, no pause', async () => {
    const f = flaky([Object.assign(new Error('nf'), { status: 404 })]);
    const c = clock();
    await expect(loadAccountView({ horizon: f.horizon, asset: USDC, now: c.now, sleep: c.sleep }, ME)).rejects.toBeInstanceOf(AccountNotOnChainError);
    expect(c.sleeps).toEqual([]);
    expect(f.calls.filter((x) => x === 'loadAccount')).toHaveLength(1);
  });

  it('another 4xx is not retried; a 5xx and a deadline are', async () => {
    for (const [err, attempts] of [[horizonStatus(400), 1], [horizonStatus(429), 1], [horizonStatus(502), 2], [new HorizonTimeoutError('loadAccount', 2_500), 2]] as Array<[unknown, number]>) {
      const f = flaky([err, err]);
      const c = clock();
      const e = await loadAccountView({ horizon: f.horizon, asset: USDC, now: c.now, sleep: c.sleep }, ME).catch((x) => x);
      expect(e).toBeInstanceOf(AccountReadError);
      expect(e.attempts).toBe(attempts);
    }
  });

  it('no retry when a second attempt would not fit the budget (elapsed + pause + leg > budget)', async () => {
    const f = flaky([transport()]);
    const c = clock();
    const slowHorizon = { ...f.horizon, async loadAccount() { c.advance(4_000); return f.horizon.loadAccount(); } };
    const e = await loadAccountView({ horizon: slowHorizon, asset: USDC, now: c.now, sleep: c.sleep, legTimeoutMs: 2_500, budgetMs: 7_000 }, ME).catch((x) => x);
    expect(e).toBeInstanceOf(AccountReadError);
    expect(e.attempts).toBe(1);
    expect(c.sleeps).toEqual([]);
  });

  it('the worst case of the defaults fits: 2.5 s leg, 1 s pause, 7 s budget', () => {
    expect(DEFAULT_LEG_TIMEOUT_MS + VIEW_RETRY_PAUSE_MS + DEFAULT_LEG_TIMEOUT_MS).toBeLessThanOrEqual(VIEW_BUDGET_MS);
    expect(VIEW_BUDGET_MS).toBeLessThan(8_500);
  });

  it('describeReadFailure gives the error code or class name, the status, and the cause code separately', () => {
    expect(describeReadFailure(transport())).toEqual({ code: 'TypeError', causeCode: 'ECONNRESET' });
    expect(describeReadFailure(new HorizonTimeoutError('payments', 2_500))).toEqual({ code: 'horizon_timeout' });
    expect(describeReadFailure(horizonStatus(500))).toEqual({ code: 'Error', status: 500 });
    expect(formatReadFailure({ code: 'TypeError', status: 503, causeCode: 'ECONNRESET' })).toBe('code=TypeError status=503 cause=ECONNRESET');
  });
});
