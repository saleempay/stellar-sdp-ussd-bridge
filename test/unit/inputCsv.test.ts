import { describe, expect, it } from 'vitest';
import { InputFileError, parseInputCsv } from '../../src/provision/index.js';

describe('parseInputCsv', () => {
  it('parses phone,id,amount and tolerates a BOM and CRLF', () => {
    // 20 USDC in the original fixture is above the 5 USDC per-payment cap (L3), so the row reads 2.
    const rows = parseInputCsv('﻿phone,id,amount\r\n+999700000001,r1,1.5\r\n+999700000002,r2,2\r\n');
    expect(rows).toEqual([
      { rowIndex: 1, phone: '+999700000001', id: 'r1', amount: '1.5' },
      { rowIndex: 2, phone: '+999700000002', id: 'r2', amount: '2' },
    ]);
  });

  it('refuses the pin column without the allow flag and accepts it with it', () => {
    const text = 'phone,id,amount,pin\n+999700000001,r1,1,4729\n';
    expect(() => parseInputCsv(text)).toThrow(/allow-pin-column/);
    expect(parseInputCsv(text, { allowPinColumn: true })[0]?.pin).toBe('4729');
  });

  it('refuses unknown or missing columns, bad amounts, empty cells and duplicates, naming the row', () => {
    const cases: Array<[string, RegExp]> = [
      ['phone,id,amount,email\n+999700000001,r1,1,x\n', /unknown: \[email\]/],
      ['phone,amount\n+999700000001,1\n', /missing: \[id\]/],
      ['phone,id,amount\n+999700000001,r1,-1\n', /row 1: amount/],
      ['phone,id,amount\n+999700000001,r1,1.12345678\n', /row 1: amount/],
      ['phone,id,amount\n+999700000001,r1,0\n', /row 1: amount/],
      ['phone,id,amount\n,r1,1\n', /row 1: phone is empty/],
      ['phone,id,amount\n+999700000001,,1\n', /row 1: id is empty/],
      ['phone,id,amount\n+999700000001,r1,1\n+999 700 000 001,r2,1\n', /row 2: phone repeats row 1/],
      ['phone,id,amount\n+999700000001,r1,1\n+999700000002,r1,1\n', /row 2: id repeats row 1/],
      ['phone,id,amount\n+999700000001,r1\n', /expected 3 fields, found 2/],
      ['phone,id,amount\n', /no rows/],
      ['', /empty/],
    ];
    for (const [text, re] of cases) {
      expect(() => parseInputCsv(text, { allowPinColumn: true }), text).toThrow(InputFileError);
      expect(() => parseInputCsv(text, { allowPinColumn: true }), text).toThrow(re);
    }
  });
});

describe('parseInputCsv caps (L3, rulings of 10 October 2026)', () => {
  const file = (...amounts: string[]) => `phone,id,amount\n${amounts.map((a, i) => `+25470000000${i + 1},r${i + 1},${a}`).join('\n')}\n`;

  it('per-payment cap: 5 passes at the boundary, one stroop more refuses the whole file naming the row and the variable', () => {
    expect(parseInputCsv(file('5', '5.0000000'))).toHaveLength(2);
    expect(() => parseInputCsv(file('1', '5.0000001'))).toThrow(InputFileError);
    expect(() => parseInputCsv(file('1', '5.0000001'))).toThrow(/row 2: amount 5\.0000001 exceeds the per-payment cap of 5 USDC \(MAX_PAYMENT_USDC\)/);
    expect(() => parseInputCsv(file('6'))).toThrow(/per-payment cap/);
  });

  it('per-batch cap: a sum of exactly 25 passes, one stroop more refuses naming the total and the variable', () => {
    expect(parseInputCsv(file('5', '5', '5', '5', '5'))).toHaveLength(5);
    expect(() => parseInputCsv(file('5', '5', '5', '5', '5', '0.0000001'))).toThrow(InputFileError);
    expect(() => parseInputCsv(file('5', '5', '5', '5', '5', '0.0000001'))).toThrow(/file total 25\.0000001 USDC exceeds the per-batch cap of 25 USDC \(MAX_BATCH_USDC\)/);
  });

  it('sums 7-decimal rows exactly, with no floating point drift', () => {
    // 4.9999999 * 5 = 24.9999995; adding 0.0000005 lands exactly on 25.
    expect(parseInputCsv(file('4.9999999', '4.9999999', '4.9999999', '4.9999999', '4.9999999', '0.0000005'))).toHaveLength(6);
    expect(() => parseInputCsv(file('4.9999999', '4.9999999', '4.9999999', '4.9999999', '4.9999999', '0.0000006'))).toThrow(/file total 25\.0000001 USDC/);
    expect(parseInputCsv(file('0.1', '0.2', '0.7'))).toHaveLength(3);
  });

  it('a caller may pass other caps; the defaults are 5 and 25', () => {
    expect(() => parseInputCsv(file('6'), { caps: { maxPaymentUsdc: '10', maxBatchUsdc: '10' } })).not.toThrow();
    expect(() => parseInputCsv(file('6', '5'), { caps: { maxPaymentUsdc: '10', maxBatchUsdc: '10' } })).toThrow(/per-batch cap of 10/);
    expect(() => parseInputCsv(file('5.5'))).toThrow(/per-payment cap of 5 USDC/);
  });

  it('refuses before returning any row (nothing downstream can run on a partial file)', () => {
    let rows: unknown;
    try { rows = parseInputCsv(file('1', '2', '30')); } catch { rows = undefined; }
    expect(rows).toBeUndefined();
  });
});

