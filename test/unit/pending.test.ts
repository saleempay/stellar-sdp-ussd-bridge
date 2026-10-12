import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { JsonFilePendingStore } from '../../src/provision/pending.js';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe('JsonFilePendingStore', () => {
  it('starts empty without a file, writes a mode 600 file, and reads back what it wrote', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pending-'));
    dirs.push(dir);
    const path = join(dir, 'nested', 'pending-creations.json');
    const store = new JsonFilePendingStore(path);
    expect(await store.get('+99970000001')).toBeUndefined();
    await store.put('+99970000001', { accountId: 'G'.padEnd(56, 'A'), at: '2026-10-11T00:00:00Z' });
    expect((await store.get('+99970000001'))?.accountId).toBe('G'.padEnd(56, 'A'));
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ '+99970000001': { accountId: 'G'.padEnd(56, 'A'), at: '2026-10-11T00:00:00Z' } });
    await store.delete('+99970000001');
    expect(await store.get('+99970000001')).toBeUndefined();
    await store.delete('+99970000001');
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({});
  });
});
