import { describe, expect, it } from 'vitest';
import {
  CAP_ENV,
  CapConfigError,
  DEFAULT_CAPS,
  accountCeilingReason,
  capsFromEnv,
  compareAmounts,
  fromStroops,
  sumAmounts,
  toStroops,
  disbursementCapReasons,
} from '../../src/sdp/caps.js';

describe('caps: string arithmetic', () => {
  it('converts to and from stroops exactly', () => {
    expect(toStroops('5')).toBe(50_000_000n);
    expect(toStroops('0.0000001')).toBe(1n);
    expect(toStroops('12.5')).toBe(125_000_000n);
    expect(fromStroops(250_000_001n)).toBe('25.0000001');
    expect(fromStroops(0n)).toBe('0.0000000');
  });

  it('compares and sums without floating point', () => {
    expect(compareAmounts('5', '5.0000000')).toBe(0);
    expect(compareAmounts('5.0000001', '5')).toBe(1);
    expect(compareAmounts('4.9999999', '5')).toBe(-1);
    expect(sumAmounts(['0.1', '0.2'])).toBe('0.3000000');
    expect(sumAmounts(['4.9999999', '4.9999999', '4.9999999', '4.9999999', '4.9999999', '0.0000005'])).toBe('25.0000000');
  });

  it('refuses a non-decimal or more than 7 places', () => {
    for (const bad of ['', 'abc', '1.12345678', '-1', '1e3', '1,5']) expect(() => toStroops(bad), bad).toThrow(CapConfigError);
  });
});

describe('capsFromEnv', () => {
  it('defaults are 5, 25 and 100 USDC', () => {
    expect(capsFromEnv({})).toEqual({ maxPaymentUsdc: '5', maxBatchUsdc: '25', maxAccountUsdc: '100' });
    expect(DEFAULT_CAPS).toEqual(capsFromEnv({ MAX_PAYMENT_USDC: '', MAX_BATCH_USDC: '  ', MAX_ACCOUNT_USDC: undefined }));
  });

  it('reads each variable', () => {
    expect(capsFromEnv({ MAX_PAYMENT_USDC: '1', MAX_BATCH_USDC: '2.5', MAX_ACCOUNT_USDC: '10.0000001' })).toEqual({ maxPaymentUsdc: '1', maxBatchUsdc: '2.5', maxAccountUsdc: '10.0000001' });
  });

  for (const key of Object.values(CAP_ENV)) {
    it(`refuses a bad ${key}, naming it`, () => {
      expect(() => capsFromEnv({ [key]: 'five' })).toThrow(CapConfigError);
      expect(() => capsFromEnv({ [key]: 'five' })).toThrow(new RegExp(`${key} must be a positive decimal`));
      expect(() => capsFromEnv({ [key]: '0' })).toThrow(new RegExp(`${key} must be greater than zero`));
      expect(() => capsFromEnv({ [key]: '1.00000001' })).toThrow(CapConfigError);
    });
  }
});

describe('accountCeilingReason', () => {
  it('passes at and below the ceiling, refuses one stroop above, naming the variable', () => {
    expect(accountCeilingReason('100', DEFAULT_CAPS)).toBeNull();
    expect(accountCeilingReason('100.0000000', DEFAULT_CAPS)).toBeNull();
    expect(accountCeilingReason('0', DEFAULT_CAPS)).toBeNull();
    const reason = accountCeilingReason('100.0000001', DEFAULT_CAPS);
    expect(reason).toContain('100.0000001 USDC');
    expect(reason).toContain('MAX_ACCOUNT_USDC ceiling of 100 USDC');
    expect(accountCeilingReason('12.5', { maxAccountUsdc: '12.4999999' })).toContain('ceiling of 12.4999999');
  });
});

describe('disbursementCapReasons: the caps hold on the disbursement about to start (review of 13 October, finding 1)', () => {
  const caps = { maxPaymentUsdc: '5', maxBatchUsdc: '25' };
  // rows that never went through parseInputCsv: a hand-edited file, a re-upload, a dashboard disbursement
  const rows = (...amounts: string[]) => amounts.map((amount, i) => ({ id: `p${i}`, amount }));

  it('passes a disbursement within both caps, at the exact boundary too', () => {
    expect(disbursementCapReasons(rows('5.0000000', '5', '5.0000000', '5', '5'), caps)).toEqual([]);
    expect(disbursementCapReasons([], caps)).toEqual([]);
  });

  it('refuses a payment above the per-payment cap by one stroop, counting the rows above and naming the largest', () => {
    const reasons = disbursementCapReasons(rows('1', '5.0000001', '7.5'), caps);
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toContain('2 of 3 payment(s) in the disbursement are above the MAX_PAYMENT_USDC cap of 5 USDC (largest 7.5 USDC)');
  });

  it('refuses a total above the per-batch cap even when every payment is within the per-payment cap', () => {
    const reasons = disbursementCapReasons(rows('5', '5', '5', '5', '5', '0.0000001'), caps);
    expect(reasons).toEqual(["the disbursement's total of 25.0000001 USDC over 6 payment(s) is above the MAX_BATCH_USDC cap of 25 USDC"]);
  });

  it('reports both reasons together', () => {
    expect(disbursementCapReasons(rows('30'), caps)).toHaveLength(2);
  });
});
