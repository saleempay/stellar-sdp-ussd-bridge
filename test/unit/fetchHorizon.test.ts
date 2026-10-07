import { describe, expect, it } from 'vitest';
import { decodeSubmissionError, isHorizonNotFound, TransactionFailedError } from 'stellar-ussd-sep10-adapter';
import { FetchHorizon, HorizonResponseError, HorizonTimeoutError, spendableXlm, toAccountRecord } from '../../src/provision/index.js';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('FetchHorizon', () => {
  it('loads an account with sequence, balances and reserve counters', async () => {
    const calls: string[] = [];
    const h = new FetchHorizon('https://horizon.test/', {
      fetch: async (url) => { calls.push(url); return json(200, { id: 'GACC', sequence: '42', subentry_count: 1, num_sponsoring: 0, num_sponsored: 3, balances: [{ asset_type: 'native', balance: '10.0000000' }] }); },
    });
    const a = await h.loadAccount('GACC');
    expect(calls[0]).toBe('https://horizon.test/accounts/GACC');
    expect(a.accountId()).toBe('GACC');
    expect(a.sequenceNumber()).toBe('42');
    a.incrementSequenceNumber();
    expect(a.sequenceNumber()).toBe('43');
    expect(a.numSponsored).toBe(3);
  });

  it('a 404 is recognised by the adapter as not found', async () => {
    const h = new FetchHorizon('https://horizon.test', { fetch: async () => json(404, { status: 404 }) });
    const err = await h.loadAccount('GNOPE').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HorizonResponseError);
    expect(isHorizonNotFound(err)).toBe(true);
  });

  it('posts the XDR as a form field and returns hash and ledger', async () => {
    let body = '';
    const h = new FetchHorizon('https://horizon.test', { fetch: async (_u, init) => { body = String(init?.body); return json(200, { hash: 'abc', ledger: 7 }); } });
    const r = await h.submitTransaction({ toXDR: () => 'AAAA+/=' });
    expect(body).toBe('tx=AAAA%2B%2F%3D');
    expect(r).toEqual({ hash: 'abc', ledger: 7 });
  });

  it('a rejected submission carries result codes the adapter can decode', async () => {
    const h = new FetchHorizon('https://horizon.test', {
      fetch: async () => json(400, { extras: { result_codes: { transaction: 'tx_failed', operations: ['op_success', 'op_success', 'op_low_reserve'] } } }),
    });
    const err = await h.submitTransaction({ toXDR: () => 'x' }).catch((e: unknown) => e);
    const decoded = decodeSubmissionError(err);
    expect(decoded).toBeInstanceOf(TransactionFailedError);
    expect((decoded as TransactionFailedError).operationResultCodes).toEqual(['op_success', 'op_success', 'op_low_reserve']);
  });

  it('a timeout becomes HorizonTimeoutError naming the operation', async () => {
    const h = new FetchHorizon('https://horizon.test', { timeoutMs: 10, fetch: async (_u, init) => new Promise((_r, reject) => init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('t'), { name: 'TimeoutError' })))) });
    const err = await h.loadAccount('GACC').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HorizonTimeoutError);
    expect((err as HorizonTimeoutError).operation).toBe('loadAccount');
  });

  it('spendableXlm subtracts the minimum balance', () => {
    const a = toAccountRecord({ id: 'G', sequence: '1', subentry_count: 2, num_sponsoring: 4, num_sponsored: 0, balances: [{ asset_type: 'native', balance: '10.0000000' }] });
    // (2 + 2 + 4) * 0.5 = 4 reserved
    expect(spendableXlm(a)).toBeCloseTo(6, 7);
  });
});
