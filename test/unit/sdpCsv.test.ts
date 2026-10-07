import { describe, expect, it } from 'vitest';
import { SDP_CSV_HEADER, SdpCsvFieldError, sha256Hex, writeSdpCsv } from '../../src/provision/index.js';

const row = { phone: '+254700000001', walletAddress: 'GABC', walletAddressMemo: '', id: 'r1', amount: '1.5', paymentID: 'batch-r1' };

describe('writeSdpCsv', () => {
  it('writes the 7.0.0 template header in the template order', () => {
    expect([...SDP_CSV_HEADER]).toEqual(['phone', 'walletAddress', 'walletAddressMemo', 'id', 'amount', 'paymentID']);
    expect(writeSdpCsv([row])).toBe('phone,walletAddress,walletAddressMemo,id,amount,paymentID\n+254700000001,GABC,,r1,1.5,batch-r1\n');
  });

  it('is byte stable and LF only, with a trailing newline and no BOM', () => {
    const a = writeSdpCsv([row, { ...row, id: 'r2', paymentID: 'batch-r2' }]);
    const b = writeSdpCsv([row, { ...row, id: 'r2', paymentID: 'batch-r2' }]);
    expect(a).toBe(b);
    expect(a.includes('\r')).toBe(false);
    expect(a.charCodeAt(0)).not.toBe(0xfeff);
    expect(a.endsWith('\n')).toBe(true);
    expect(sha256Hex(a)).toBe(sha256Hex(b));
  });

  it('refuses a field that would need quoting instead of quoting it', () => {
    for (const bad of ['a,b', 'a"b', 'a\nb', 'a\rb']) {
      expect(() => writeSdpCsv([{ ...row, id: bad }])).toThrow(SdpCsvFieldError);
    }
  });

  it('writes an empty file as the header only', () => {
    expect(writeSdpCsv([])).toBe('phone,walletAddress,walletAddressMemo,id,amount,paymentID\n');
  });
});
