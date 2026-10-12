import { describe, expect, it } from 'vitest';
import { assessDialReadiness, checkDns, probeBody, probeScreenOne, readinessReport, type FetchFn, type ResolveFn } from '../../src/ussd/index.js';

const PATH = '/ussd/3f9c2a7e1b4d8f6a0c5e9b2d7a1f4c8e';
const HOST = 'four-word-host-name.trycloudflare.com';
const okResolve: ResolveFn = async (server) => [server === '1.1.1.1' ? '104.16.0.1' : '104.16.0.2'];
const fetchOk: FetchFn = async () => ({ status: 200, text: async () => 'CON Saleem\n1. My account\n2. About' });

describe('DNS on two public resolvers', () => {
  it('reports each resolver separately', async () => {
    const r = await checkDns(HOST, ['1.1.1.1', '8.8.8.8'], async (server) => { if (server === '8.8.8.8') throw Object.assign(new Error('x'), { code: 'ENOTFOUND' }); return ['104.16.0.1']; });
    expect(r).toEqual([{ server: '1.1.1.1', addresses: ['104.16.0.1'] }, { server: '8.8.8.8', addresses: [], error: 'ENOTFOUND' }]);
  });
});

describe('screen 1 probe', () => {
  it('sends a well-formed initial dial and accepts 200 CON Saleem only', async () => {
    const seen: { url: string; body: string; method: string }[] = [];
    const f: FetchFn = async (url, init) => { seen.push({ url, body: init.body, method: init.method }); return { status: 200, text: async () => 'CON Saleem\n1. My account\n2. About' }; };
    const p = await probeScreenOne(`https://${HOST}/`, PATH, f, () => 1_700_000_000_000);
    expect(p.ok).toBe(true);
    expect(seen[0]!.url).toBe(`https://${HOST}${PATH}`);
    expect(seen[0]!.method).toBe('POST');
    const fields = new URLSearchParams(seen[0]!.body);
    expect(fields.get('sessionId')).toBe('readiness-1700000000000');
    expect(fields.get('text')).toBe('');
    expect(fields.get('phoneNumber')).toBeTruthy();
    expect(probeBody('s')).toContain('sessionId=s');
  });
  it('a 404 "not found", a 502 page or a network error is not ready', async () => {
    expect((await probeScreenOne(HOST, PATH, async () => ({ status: 404, text: async () => 'not found' }))).ok).toBe(false);
    expect((await probeScreenOne(HOST, PATH, async () => ({ status: 502, text: async () => '<html>Bad gateway' }))).ok).toBe(false);
    const p = await probeScreenOne(HOST, PATH, async () => { throw new Error('getaddrinfo ENOTFOUND'); });
    expect(p.ok).toBe(false);
    expect(p.error).toContain('ENOTFOUND');
  });
});

describe('dial readiness', () => {
  it('ready only when both resolvers answer and the probe returns screen 1', async () => {
    const r = await assessDialReadiness(HOST, PATH, { resolve: okResolve, fetchImpl: fetchOk, now: () => 0 });
    expect(r.ready).toBe(true);
    expect(r.reasons).toEqual([]);
    const report = readinessReport(r);
    expect(report).toContain('READY TO DIAL');
    expect(report).toContain(HOST);
    expect(report).not.toContain(PATH);
  });
  it('a resolver miss skips the probe and is NOT READY with the reason', async () => {
    const r = await assessDialReadiness(HOST, PATH, { resolve: async (server) => { if (server === '8.8.8.8') throw Object.assign(new Error(), { code: 'ENOTFOUND' }); return ['1.2.3.4']; }, fetchImpl: async () => { throw new Error('must not be called'); } });
    expect(r.ready).toBe(false);
    expect(r.reasons[0]).toContain('does not resolve on 8.8.8.8');
    expect(r.probe.error).toContain('skipped');
    expect(readinessReport(r)).toContain('NOT READY TO DIAL');
  });
  it('a wrong-path style 404 is NOT READY and names the status and body', async () => {
    const r = await assessDialReadiness(HOST, PATH, { resolve: okResolve, fetchImpl: async () => ({ status: 404, text: async () => 'not found' }) });
    expect(r.ready).toBe(false);
    expect(r.reasons[0]).toContain('returned 404');
    expect(r.reasons[0]).toContain('"not found"');
  });
});
