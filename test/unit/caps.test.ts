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
