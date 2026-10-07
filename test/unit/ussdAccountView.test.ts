import { describe, expect, it } from 'vitest';
import { AccountNotOnChainError, NoUsdcTrustlineError, loadAccountView, selectLastReceived } from '../../src/ussd/index.js';
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
    await expect(loadAccountView({ horizon: { async loadAccount() { throw new Error('timeout'); }, async paymentsFor() { return []; } }, asset: USDC }, ME)).rejects.toThrow('timeout');
  });
});
