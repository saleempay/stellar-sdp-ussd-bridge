import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SdpTenantClient } from '../../src/sdp/client.js';
import {
  BatchGuardError,
  IN_FLIGHT_DISBURSEMENT_STATUSES,
  RunLog,
  completedBatchesOn,
  guardBatchStart,
  utcDay,
  type RunLogEntry,
} from '../../src/sdp/batchGuards.js';
import { fakeFetch, type Recorded } from './helpers.js';

const NOW = new Date('2026-10-26T15:00:00Z');
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

type FakePayment = { id: string; status: string; amount: string; disbursement: string };
function tenantWith(disbursements: Array<{ id: string; name: string; status: string }>, payments: FakePayment[] = []) {
  const { fetchImpl, calls } = fakeFetch((r: Recorded) => {
    const u = new URL(r.url);
    if (u.pathname === '/disbursements') {
      const wanted = (u.searchParams.get('status') ?? '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
      const data = disbursements.filter((d) => !wanted.length || wanted.includes(d.status));
      return { status: 200, body: data.length ? { data, pagination: { total: data.length } } : { data: [], pagination: {} } };
    }
    if (u.pathname === '/payments') {
      // one status per request (payment_query_validator.go:62-70), paged
      const status = u.searchParams.get('status');
      const limit = Number(u.searchParams.get('page_limit') ?? 20);
      const page = Number(u.searchParams.get('page') ?? 1);
      const all = payments.filter((p) => !status || p.status === status.toUpperCase()).map((p) => ({ id: p.id, status: p.status, amount: p.amount, disbursement: { id: p.disbursement } }));
      const data = all.slice((page - 1) * limit, page * limit);
      return { status: 200, body: { data, pagination: { total: all.length } } };
    }
    return undefined;
  });
  return { client: new SdpTenantClient({ baseUrl: 'http://api:8000', tenantName: 'bridge', token: 't', fetch: fetchImpl }), calls };
}
const pay = (id: string, status: string, disbursement: string, amount = '1.0000000'): FakePayment => ({ id, status, amount, disbursement });

const finished = (at: string, finalStatus: string, disbursementId = 'd-old'): RunLogEntry => ({ at, event: 'finished', tenant: 'bridge', network: 'testnet', disbursementId, total: '12.5000000', finalStatus });

describe('guardBatchStart: disbursements in flight', () => {
  it('passes when the tenant has nothing in STARTED or PAUSED, asking the SDP for exactly those statuses', async () => {
    const t = tenantWith([{ id: 'd1', name: 'ready one', status: 'READY' }, { id: 'd0', name: 'done', status: 'COMPLETED' }]);
    const seen = await guardBatchStart({ client: t.client, walletId: 'dw1', disbursementId: 'd1', runLog: [], now: NOW });
    expect(seen.inFlight).toEqual([]);
    expect(seen.pausedAllowed).toEqual([]);
    const u = new URL(t.calls[0]!.url);
    expect(u.pathname).toBe('/disbursements');
    expect(u.searchParams.get('status')).toBe(IN_FLIGHT_DISBURSEMENT_STATUSES.join(','));
    expect(t.calls[0]?.headers['X-Wallet-Id']).toBe('dw1');
  });

  it('STARTED refuses, without and with the flag', async () => {
    const t = tenantWith([{ id: 'd1', name: 'mine', status: 'READY' }, { id: 'd9', name: 'stage', status: 'STARTED' }]);
    const err = await guardBatchStart({ client: t.client, disbursementId: 'd1', runLog: [], now: NOW }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BatchGuardError);
    expect((err as BatchGuardError).reasons).toEqual(['the tenant has disbursement d9 ("stage") in STARTED; no flag lifts this, pause or finish it first']);
    const withFlag = await guardBatchStart({ client: t.client, disbursementId: 'd1', runLog: [], now: NOW, secondRunReason: 'drain' }).catch((e: unknown) => e);
    expect((withFlag as BatchGuardError).reasons).toEqual(['the tenant has disbursement d9 ("stage") in STARTED; no flag lifts this, pause or finish it first']);
  });

  it('PAUSED refuses without the flag, pointing at --second-run', async () => {
    const t = tenantWith([{ id: 'd9', name: 'paused one', status: 'PAUSED' }]);
    const err = await guardBatchStart({ client: t.client, disbursementId: 'd1', runLog: [], now: NOW }).catch((e: unknown) => e);
    expect((err as BatchGuardError).reasons).toEqual(['the tenant has disbursement d9 ("paused one") in PAUSED; pass --second-run "<reason>" to start another while it stays paused']);
  });

  for (const state of ['READY', 'PENDING'] as const) {
    it(`PAUSED with a ${state} payment refuses even with the flag`, async () => {
      const t = tenantWith([{ id: 'd9', name: 'paused one', status: 'PAUSED' }], [pay('p1', 'SUCCESS', 'd9'), pay('p2', state, 'd9'), pay('px', state, 'other')]);
      const err = await guardBatchStart({ client: t.client, disbursementId: 'd1', runLog: [], now: NOW, secondRunReason: 'drain' }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BatchGuardError);
      expect((err as BatchGuardError).reasons).toEqual([`paused disbursement d9 ("paused one") still has 1 payment(s) in ${state}, which can reach the network; wait for them to finish or fail`]);
    });
  }

  it('PAUSED with every payment terminal starts with the flag and reports the paused commitments', async () => {
    const t = tenantWith([{ id: 'd9', name: 'paused one', status: 'PAUSED' }], [pay('p1', 'SUCCESS', 'd9'), pay('p2', 'FAILED', 'd9'), pay('p3', 'CANCELED', 'd9'), pay('px', 'READY', 'other')]);
    const seen = await guardBatchStart({ client: t.client, disbursementId: 'd1', runLog: [], now: NOW, secondRunReason: 'drain to treasury' });
    expect(seen.pausedAllowed.map((d) => d.id)).toEqual(['d9']);
    expect(seen.pausedInProgress).toEqual([]);
    // the payments were asked for one in-progress status at a time, 100 per page
    const paymentCalls = t.calls.filter((c) => c.url.includes('/payments'));
    expect(paymentCalls.map((c) => new URL(c.url).searchParams.get('status'))).toEqual(['READY', 'PENDING', 'PAUSED']);
    expect(paymentCalls.every((c) => new URL(c.url).searchParams.get('page_limit') === '100')).toBe(true);
  });

  it('PAUSED with its payments PAUSED (what a pause does to READY payments) starts with the flag; the paused amounts are reported for the drain', async () => {
    const t = tenantWith([{ id: 'd9', name: 'paused one', status: 'PAUSED' }], [pay('p1', 'PAUSED', 'd9', '2.5000000'), pay('p2', 'PAUSED', 'd9', '3.0000000'), pay('p3', 'SUCCESS', 'd9', '1.0000000')]);
    const seen = await guardBatchStart({ client: t.client, disbursementId: 'd1', runLog: [], now: NOW, secondRunReason: 'drain' });
    expect(seen.pausedAllowed.map((d) => d.id)).toEqual(['d9']);
    expect(seen.pausedInProgress.map((p) => [p.id, p.amount])).toEqual([['p1', '2.5000000'], ['p2', '3.0000000']]);
  });

  it('pages through more than 100 payments of one status', async () => {
    const many = Array.from({ length: 150 }, (_, i) => pay(`q${i}`, 'PAUSED', i === 149 ? 'd9' : 'other'));
    const t = tenantWith([{ id: 'd9', name: 'paused one', status: 'PAUSED' }], many);
    const seen = await guardBatchStart({ client: t.client, disbursementId: 'd1', runLog: [], now: NOW, secondRunReason: 'drain' });
    expect(seen.pausedInProgress.map((p) => p.id)).toEqual(['q149']);
    const pausedPages = t.calls.filter((c) => c.url.includes('status=PAUSED')).map((c) => new URL(c.url).searchParams.get('page'));
    expect(pausedPages).toEqual(['1', '2']);
  });

  it('refuses when the target itself is already in flight, pointing at --skip-start', async () => {
    const t = tenantWith([{ id: 'd1', name: 'mine', status: 'STARTED' }]);
    const err = await guardBatchStart({ client: t.client, disbursementId: 'd1', runLog: [], now: NOW }).catch((e: unknown) => e);
    expect((err as BatchGuardError).reasons).toEqual(['disbursement d1 is already STARTED; use --skip-start to follow it instead of starting it']);
  });
});

describe('guardBatchStart: the run log', () => {
  it('refuses when a completed batch is recorded for the current UTC day', async () => {
    const t = tenantWith([]);
    const log = [finished('2026-10-26T09:00:00Z', 'COMPLETED')];
    const err = await guardBatchStart({ client: t.client, disbursementId: 'd1', runLog: log, now: NOW }).catch((e: unknown) => e);
    expect((err as BatchGuardError).reasons).toEqual(['the run log already records a completed batch today (d-old); pass --second-run "<reason>" to run another']);
  });

  it('passes when the completed batch was another day, or today\'s batch did not complete', async () => {
    const t = tenantWith([]);
    await expect(guardBatchStart({ client: t.client, disbursementId: 'd1', runLog: [finished('2026-10-25T23:59:59Z', 'COMPLETED')], now: NOW })).resolves.toBeDefined();
    await expect(guardBatchStart({ client: t.client, disbursementId: 'd1', runLog: [finished('2026-10-26T09:00:00Z', 'STARTED'), { ...finished('2026-10-26T09:00:00Z', 'x'), event: 'started', finalStatus: undefined }], now: NOW })).resolves.toBeDefined();
  });

  it('the UTC day boundary decides, not local time', async () => {
    const t = tenantWith([]);
    const justBeforeMidnight = finished('2026-10-25T23:59:59.999Z', 'COMPLETED');
    await expect(guardBatchStart({ client: t.client, disbursementId: 'd1', runLog: [justBeforeMidnight], now: new Date('2026-10-26T00:00:00Z') })).resolves.toBeDefined();
    await expect(guardBatchStart({ client: t.client, disbursementId: 'd1', runLog: [justBeforeMidnight], now: new Date('2026-10-25T00:00:00Z') })).rejects.toBeInstanceOf(BatchGuardError);
    expect(utcDay('2026-10-25T23:59:59.999Z')).toBe('2026-10-25');
  });

  it('--second-run with a reason passes the run-log guard and reports what it saw', async () => {
    const t = tenantWith([]);
    const log = [finished('2026-10-26T09:00:00Z', 'COMPLETED', 'd-morning')];
    const seen = await guardBatchStart({ client: t.client, disbursementId: 'd1', runLog: log, now: NOW, secondRunReason: 'drain to treasury' });
    expect(seen.completedToday.map((e) => e.disbursementId)).toEqual(['d-morning']);
  });

  it('both reasons are reported together', async () => {
    const t = tenantWith([{ id: 'd9', name: 'stage', status: 'PAUSED' }]);
    const err = await guardBatchStart({ client: t.client, disbursementId: 'd1', runLog: [finished('2026-10-26T09:00:00Z', 'COMPLETED')], now: NOW }).catch((e: unknown) => e);
    expect((err as BatchGuardError).reasons).toHaveLength(2);
    expect((err as BatchGuardError).message).toContain('batch refused');
  });
});

describe('RunLog file', () => {
  it('reads an absent file as empty, appends one JSON object per line, and the second-run reason is kept', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bridge-runlog-'));
    dirs.push(dir);
    const log = new RunLog(join(dir, 'nested', 'batch-run-log.jsonl'));
    expect(log.read()).toEqual([]);
    log.append({ at: '2026-10-26T09:00:00Z', event: 'started', tenant: 'bridge', network: 'testnet', disbursementId: 'd1', total: '25.0000000', secondRunReason: 'drain to treasury', pausedAllowed: ['d9'] });
    log.append(finished('2026-10-26T09:01:00Z', 'COMPLETED', 'd1'));
    const lines = readFileSync(log.path, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!).secondRunReason).toBe('drain to treasury');
    expect(JSON.parse(lines[0]!).pausedAllowed).toEqual(['d9']);
    expect(log.read()).toHaveLength(2);
    expect(completedBatchesOn(log.read(), '2026-10-26').map((e) => e.disbursementId)).toEqual(['d1']);
    expect(completedBatchesOn(log.read(), '2026-10-27')).toEqual([]);
  });
});
