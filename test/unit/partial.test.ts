import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { partialSidecarFor, partialSidecarPath, readPartialSidecar } from '../../src/provision/partial.js';
import type { ProvisionReport } from '../../src/provision/types.js';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

const report: ProvisionReport = {
  outcomes: [
    { rowIndex: 1, phoneMasked: '+9997***0001', status: 'created', pin: 'none', accountId: 'GA' },
    { rowIndex: 2, phoneMasked: '+9997***0002', status: 'failed', pin: 'none', errorCode: 'horizon_timeout', message: 'x' },
    { rowIndex: 3, phoneMasked: '+9997***0003', status: 'uncertain', pin: 'none', errorCode: 'creation_uncertain', message: 'y', accountId: 'GB' },
    { rowIndex: 4, phoneMasked: '+9997***0004', status: 'unchanged', pin: 'none', accountId: 'GC' },
  ],
  counts: { created: 1, trustlineAdded: 0, unchanged: 1, failed: 1, uncertain: 1, pinRefused: 0 },
  sdpRows: [
    { phone: '+999700000001', walletAddress: 'GA', walletAddressMemo: '', id: 'r1', amount: '1', paymentID: 'b-r1' },
    { phone: '+999700000004', walletAddress: 'GC', walletAddressMemo: '', id: 'r4', amount: '1', paymentID: 'b-r4' },
  ],
};

describe('partial-output sidecar', () => {
  it('names the omitted rows by index and code, never by phone, and carries the file hash', () => {
    const s = partialSidecarFor(report, 'out.csv', 'abc', new Date('2026-10-11T00:00:00Z'))!;
    expect(s).toEqual({
      output: 'out.csv', sha256: 'abc', writtenAt: '2026-10-11T00:00:00.000Z', rowsWritten: 2, rowsOmitted: 2,
      omitted: [{ rowIndex: 2, status: 'failed', code: 'horizon_timeout' }, { rowIndex: 3, status: 'uncertain', code: 'creation_uncertain' }],
    });
    expect(JSON.stringify(s)).not.toContain('+9997');
    expect(partialSidecarPath('out.csv')).toBe('out.csv.partial.json');
  });

  it('is undefined for a complete run', () => {
    const complete: ProvisionReport = { ...report, outcomes: report.outcomes.filter((o) => o.status === 'created' || o.status === 'unchanged') };
    expect(partialSidecarFor(complete, 'out.csv', 'abc')).toBeUndefined();
  });

  it('reads back what was written, is undefined when absent, and refuses a file that is not a sidecar', () => {
    const dir = mkdtempSync(join(tmpdir(), 'partial-'));
    dirs.push(dir);
    const path = join(dir, 'out.csv.partial.json');
    expect(readPartialSidecar(path)).toBeUndefined();
    const s = partialSidecarFor(report, 'out.csv', 'abc')!;
    writeFileSync(path, JSON.stringify(s));
    expect(readPartialSidecar(path)).toEqual(s);
    writeFileSync(path, JSON.stringify({ hello: 1 }));
    expect(() => readPartialSidecar(path)).toThrow(/not a partial-output sidecar/);
  });
});
