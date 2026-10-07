import { describe, expect, it } from 'vitest';
import { InputFileError, parseInputCsv } from '../../src/provision/index.js';

describe('parseInputCsv', () => {
  it('parses phone,id,amount and tolerates a BOM and CRLF', () => {
    const rows = parseInputCsv('﻿phone,id,amount\r\n+254700000001,r1,1.5\r\n+254700000002,r2,20\r\n');
    expect(rows).toEqual([
      { rowIndex: 1, phone: '+254700000001', id: 'r1', amount: '1.5' },
      { rowIndex: 2, phone: '+254700000002', id: 'r2', amount: '20' },
    ]);
  });

  it('refuses the pin column without the allow flag and accepts it with it', () => {
    const text = 'phone,id,amount,pin\n+254700000001,r1,1,4729\n';
    expect(() => parseInputCsv(text)).toThrow(/allow-pin-column/);
    expect(parseInputCsv(text, { allowPinColumn: true })[0]?.pin).toBe('4729');
  });

  it('refuses unknown or missing columns, bad amounts, empty cells and duplicates, naming the row', () => {
    const cases: Array<[string, RegExp]> = [
      ['phone,id,amount,email\n+254700000001,r1,1,x\n', /unknown: \[email\]/],
      ['phone,amount\n+254700000001,1\n', /missing: \[id\]/],
      ['phone,id,amount\n+254700000001,r1,-1\n', /row 1: amount/],
      ['phone,id,amount\n+254700000001,r1,1.12345678\n', /row 1: amount/],
      ['phone,id,amount\n+254700000001,r1,0\n', /row 1: amount/],
      ['phone,id,amount\n,r1,1\n', /row 1: phone is empty/],
      ['phone,id,amount\n+254700000001,,1\n', /row 1: id is empty/],
      ['phone,id,amount\n+254700000001,r1,1\n+254 700 000 001,r2,1\n', /row 2: phone repeats row 1/],
      ['phone,id,amount\n+254700000001,r1,1\n+254700000002,r1,1\n', /row 2: id repeats row 1/],
      ['phone,id,amount\n+254700000001,r1\n', /expected 3 fields, found 2/],
      ['phone,id,amount\n', /no rows/],
      ['', /empty/],
    ];
    for (const [text, re] of cases) {
      expect(() => parseInputCsv(text, { allowPinColumn: true }), text).toThrow(InputFileError);
      expect(() => parseInputCsv(text, { allowPinColumn: true }), text).toThrow(re);
    }
  });
});
