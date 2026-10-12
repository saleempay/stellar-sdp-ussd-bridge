import { describe, expect, it } from 'vitest';
import { InMemoryAccountStore } from 'stellar-ussd-sep10-adapter';
import { InMemoryPendingStore } from '../../src/provision/pending.js';
import { createOnDial, withInFlightGuard } from '../../src/ussd/createOnDial.js';
import { CreationCappedError, CreationPendingError } from '../../src/ussd/errors.js';
import { FakeHorizon, FakeSigner, NETWORK, SPONSOR, USDC, timeout } from './provisionFakes.js';

const MSISDN = '+999738035311';

function setup(opts: { sponsorXlm?: string; caps?: { minSponsorXlm: number; maxPerHour: number } } = {}) {
  const horizon = new FakeHorizon();
  horizon.addAccount(SPONSOR, { xlm: opts.sponsorXlm ?? '100.0000000' });
  const signer = new FakeSigner();
  const store = new InMemoryAccountStore();
  const pendingStore = new InMemoryPendingStore();
  const logs: string[] = [];
  let clock = Date.parse('2026-10-11T08:00:00Z');
  const create = createOnDial({ store, signer, horizon, networkPassphrase: NETWORK, sponsorPublicKey: SPONSOR, asset: USDC, pendingStore, log: (l) => logs.push(l), now: () => clock, ...(opts.caps ? { caps: opts.caps } : {}) });
  return { horizon, signer, store, pendingStore, logs, create, advance: (ms: number) => { clock += ms; } };
}

describe('withInFlightGuard', () => {
  it('shares one running call per key and runs again once it has settled', async () => {
    let calls = 0;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => { release = r; });
    const guarded = withInFlightGuard(async (key: string) => { calls += 1; await gate; return `${key}:${calls}`; });
    const a = guarded('k');
    const b = guarded('k');
    const other = guarded('other');
    release();
    expect(await a).toBe('k:2');
    expect(await b).toBe('k:2');
    expect(await other).toBe('other:2');
    expect(calls).toBe(2);
    expect(await guarded('k')).toBe('k:3');
  });
});

describe('createOnDial', () => {
  it('two overlapping dials for one number produce one submission and the same account', async () => {
    const f = setup();
    const [a, b] = await Promise.all([f.create(MSISDN), f.create(MSISDN)]);
    expect(f.horizon.submissions).toHaveLength(1);
    expect(a.accountId).toBe(b.accountId);
    expect(a.created).toBe(true);
    expect(await f.store.get(MSISDN)).toBe(a.accountId);
    expect(await f.pendingStore.get(MSISDN)).toBeUndefined();
    const again = await f.create(MSISDN);
    expect(again.created).toBe(false);
    expect(f.horizon.submissions).toHaveLength(1);
  });

  it('a timeout after the creation landed: the account is read back, mapped and returned, not created again', async () => {
    const f = setup();
    f.horizon.nextErrors = [timeout('submitTransaction')];
    f.horizon.landOnNextError = () => f.signer.lastCreated;
    const r = await f.create(MSISDN);
    expect(r.accountId).toBe(f.signer.lastCreated);
    expect(r.creationTxHash).toBeUndefined();
    expect(await f.store.get(MSISDN)).toBe(r.accountId);
    expect(f.logs).toContain('creation event=landedAfterAmbiguousSubmission');
    expect((await f.create(MSISDN)).created).toBe(false);
    expect(f.horizon.submissions).toHaveLength(0);
  });

  it('a timeout with nothing landed yet: E4 (pending), the record holds with the time bound, a re-dial inside the bound creates nothing, a re-dial after it creates', async () => {
    const f = setup();
    f.horizon.nextErrors = [timeout('submitTransaction')];
    const err = await f.create(MSISDN).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CreationPendingError);
    expect(f.logs).toContain('creation event=ambiguousNotYetLanded');
    expect(await f.store.get(MSISDN)).toBeUndefined();
    const pending = await f.pendingStore.get(MSISDN);
    expect(pending?.accountId).toBe(f.signer.lastCreated);
    expect(pending?.expiresAt).toBe(new Date(Date.parse('2026-10-11T08:00:00Z') + 40_000).toISOString());
    // the user re-dials within seconds: E4 again, no second creation
    f.advance(5_000);
    const again = await f.create(MSISDN).catch((e: unknown) => e);
    expect(again).toBeInstanceOf(CreationPendingError);
    expect(f.logs).toContain('creation event=pendingStillBound');
    expect(f.horizon.submissions).toHaveLength(0);
    expect((await f.pendingStore.get(MSISDN))?.accountId).toBe(pending?.accountId);
    // after the bound with nothing landed: the retry creates
    f.advance(40_000);
    const r = await f.create(MSISDN);
    expect(r.created).toBe(true);
    expect(r.accountId).not.toBe(pending?.accountId);
    expect(f.horizon.submissions).toHaveLength(1);
    expect(await f.pendingStore.get(MSISDN)).toBeUndefined();
  });

  it('the transaction lands after the client timed out and after the first read-back: the re-dial adopts it, nothing is created twice', async () => {
    const f = setup();
    f.horizon.nextErrors = [timeout('submitTransaction')];
    f.horizon.landLater = { accountId: () => f.signer.lastCreated, afterProbes: 1 };
    await expect(f.create(MSISDN)).rejects.toBeInstanceOf(CreationPendingError);
    const created = f.signer.lastCreated!;
    f.advance(6_000);
    const r = await f.create(MSISDN);
    expect(r.accountId).toBe(created);
    expect(r.created).toBe(true);
    expect(f.logs).toContain('creation event=adoptedPendingAccount');
    expect(f.horizon.submissions).toHaveLength(0);
    expect(await f.store.get(MSISDN)).toBe(created);
    expect(await f.pendingStore.get(MSISDN)).toBeUndefined();
  });

  it('two sessions for one number straddling the busy screen: the second waits on the first, and a third after the pending window adopts or creates once', async () => {
    const f = setup();
    f.horizon.nextErrors = [timeout('submitTransaction')];
    const [a, b] = await Promise.all([f.create(MSISDN).catch((e: unknown) => e), f.create(MSISDN).catch((e: unknown) => e)]);
    expect(a).toBeInstanceOf(CreationPendingError);
    expect(b).toBe(a);
    expect(f.horizon.submissions).toHaveLength(0);
  });

  it('a timeout and an unreadable chain keep the pending record; the next dial adopts the landed account without a second creation', async () => {
    const f = setup();
    f.horizon.nextErrors = [timeout('submitTransaction')];
    f.horizon.landOnNextError = () => f.signer.lastCreated;
    f.signer.onCreate = (id) => f.horizon.failLoadFor.set(id, timeout('loadAccount'));
    await expect(f.create(MSISDN)).rejects.toThrow(/did not answer/);
    const created = f.signer.lastCreated!;
    expect(await f.store.get(MSISDN)).toBeUndefined();
    expect((await f.pendingStore.get(MSISDN))?.accountId).toBe(created);
    f.horizon.failLoadFor.clear();
    const r = await f.create(MSISDN);
    expect(r.accountId).toBe(created);
    expect(r.created).toBe(true);
    expect(f.logs).toContain('creation event=adoptedPendingAccount');
    expect(f.horizon.submissions).toHaveLength(0);
    expect(await f.pendingStore.get(MSISDN)).toBeUndefined();
  });

  it('a definitive rejection is thrown unchanged and clears the pending record', async () => {
    const f = setup();
    const err = Object.assign(new Error('Horizon submitTransaction returned HTTP 400'), { status: 400, response: { status: 400, data: { extras: { result_codes: { transaction: 'tx_failed', operations: ['op_success', 'op_success', 'op_no_issuer'] } } } } });
    f.horizon.nextErrors = [err];
    await expect(f.create(MSISDN)).rejects.toThrow(/tx_failed/);
    expect(await f.pendingStore.get(MSISDN)).toBeUndefined();
    expect(await f.store.get(MSISDN)).toBeUndefined();
  });
});

describe('createOnDial caps', () => {
  it('refuses creation with E3 (CreationCappedError, sponsor_balance) when the sponsor can spend less than the floor', async () => {
    const f = setup({ sponsorXlm: '5.0000000', caps: { minSponsorXlm: 10, maxPerHour: 5 } });
    const err = await f.create(MSISDN).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CreationCappedError);
    expect((err as CreationCappedError).reason).toBe('sponsor_balance');
    expect(f.horizon.submissions).toHaveLength(0);
    expect(await f.pendingStore.get(MSISDN)).toBeUndefined();
  });

  it('refuses the creation after the hourly cap and allows it again an hour later', async () => {
    const f = setup({ caps: { minSponsorXlm: 1, maxPerHour: 2 } });
    await f.create('+999738035311');
    await f.create('+999738035322');
    const err = await f.create('+999738035333').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CreationCappedError);
    expect((err as CreationCappedError).reason).toBe('rate');
    expect(f.horizon.submissions).toHaveLength(2);
    f.advance(60 * 60 * 1000 + 1);
    expect((await f.create('+999738035333')).created).toBe(true);
  });

  it('a mapped number is never capped, and neither is adopting an account that already landed', async () => {
    const f = setup({ sponsorXlm: '0.0000000', caps: { minSponsorXlm: 10, maxPerHour: 0 } });
    await f.store.put(MSISDN, 'G'.padEnd(56, 'M'));
    expect((await f.create(MSISDN)).created).toBe(false);
    const other = '+999738035399';
    f.horizon.addAccount('G'.padEnd(56, 'P'), { xlm: '0', trustlines: [USDC], sponsored: 3 });
    await f.pendingStore.put(other, { accountId: 'G'.padEnd(56, 'P'), at: '2026-10-11T07:00:00Z' });
    const r = await f.create(other);
    expect(r.created).toBe(true);
    expect(r.accountId).toBe('G'.padEnd(56, 'P'));
    expect(f.horizon.submissions).toHaveLength(0);
  });
});
