import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { captureBanner, describeExchange, maskCallbackFields, maskCallbackPath, maskMsisdn, maskPinTokens, pathSegmentLengths, recordingListener, type Exchange } from '../../src/ussd/index.js';

const PATH = '/ussd/3f9c2a7e1b4d8f6a0c5e9b2d7a1f4c8e';

describe('capture banner (adapter issue #8 rule)', () => {
  it('never shows the full callback path or the stale /ussd/callback text; shows the tunnel base URL only', () => {
    const b = captureBanner(8085, PATH, 'https://example-tunnel.trycloudflare.com');
    expect(b).not.toContain(PATH);
    expect(b).not.toContain(PATH.slice(1));
    expect(b).not.toContain('/ussd/callback');
    expect(b).toContain('/****4c8e');
    expect(b).toContain('USSD_CALLBACK_PATH');
    expect(b).toContain('https://example-tunnel.trycloudflare.com');
    expect(b).not.toContain('https://example-tunnel.trycloudflare.com/');
  });
  it('masks to the last four characters behind a fixed mask', () => {
    expect(maskCallbackPath(PATH)).toBe('/****4c8e');
    expect(maskCallbackPath('/short')).toBe('/****');
  });
});

describe('transcript masking', () => {
  it('masks the MSISDN middle and every four digit token', () => {
    expect(maskMsisdn('+999738035311')).toBe('+9997***5311');
    expect(maskPinTokens('1*4729*4729')).toBe('1*####*####');
    expect(maskPinTokens('1*2')).toBe('1*2');
    expect(maskCallbackFields('sessionId=s1&phoneNumber=%2B999738035311&text=1*4729&serviceCode=*384*43808%23')).toEqual({ sessionId: 's1', phoneNumber: '+9997***5311', text: '1*####', serviceCode: '*384*43808#' });
  });
});

describe('path as segment lengths', () => {
  it('describes a path without writing it; a trailing slash shows as a final 0', () => {
    expect(pathSegmentLengths(PATH)).toEqual([4, 32]);
    expect(pathSegmentLengths(`${PATH}/`)).toEqual([4, 32, 0]);
    expect(pathSegmentLengths('/')).toEqual([0]);
    expect(pathSegmentLengths(`${PATH}?x=1`)).toEqual([4, 32]);
  });
});

describe('recording listener: request facts for every status', () => {
  let server: Server;
  let base: string;
  const exchanges: Exchange[] = [];
  // a stand-in for the adapter listener: POST on the callback path answers CON, anything else 404
  const stub = (req: IncomingMessage, res: ServerResponse) => {
    if (req.method === 'POST' && (req.url ?? '').split('?')[0] === PATH) {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('CON Saleem');
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('not found');
  };
  beforeAll(async () => {
    server = createServer(recordingListener(stub, (e) => exchanges.push(e), { callbackPath: PATH }));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });
  const last = () => exchanges[exchanges.length - 1]!;

  it('records a gateway style POST: method, match, headers, lengths, masked fields', async () => {
    const body = 'sessionId=s1&phoneNumber=%2B999738035311&text=1*4729&serviceCode=*384*45210%23';
    const res = await fetch(`${base}${PATH}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'user-agent': 'gateway-test/1.0',
        'x-forwarded-for': '203.0.113.9',
        'cf-connecting-ip': '203.0.113.9',
        'x-forwarded-proto': 'https',
        'cf-ipcountry': 'KE',
      },
      body,
    });
    expect(res.status).toBe(200);
    const e = last();
    expect(e.status).toBe(200);
    expect(e.response).toBe('CON Saleem');
    expect(e.request).toMatchObject({
      method: 'POST',
      pathSegmentLengths: [4, 32],
      pathMatches: true,
      hasQuery: false,
      contentType: 'application/x-www-form-urlencoded',
      contentLength: body.length,
      bodyBytes: body.length,
      userAgent: 'gateway-test/1.0',
      forwardedFor: '203.0.113.9',
      connectingIp: '203.0.113.9',
      forwardedProto: 'https',
      country: 'KE',
    });
    expect(e.fields).toEqual({ sessionId: 's1', phoneNumber: '+9997***5311', text: '1*####', serviceCode: '*384*45210#' });
  });

  it('records a GET on the callback path as a 404 with no body and match=true', async () => {
    const res = await fetch(`${base}${PATH}`, { headers: { 'user-agent': 'browser-test' } });
    expect(res.status).toBe(404);
    const e = last();
    expect(e.status).toBe(404);
    expect(e.fields).toEqual({});
    expect(e.request).toMatchObject({ method: 'GET', pathMatches: true, pathSegmentLengths: [4, 32], bodyBytes: 0, userAgent: 'browser-test', contentType: null, forwardedFor: null, connectingIp: null, forwardedProto: null, country: null });
  });

  it('records a POST with a trailing slash as a 404 with match=false and a final 0 segment', async () => {
    const res = await fetch(`${base}${PATH}/`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'sessionId=s2&phoneNumber=%2B999738035311&text=' });
    expect(res.status).toBe(404);
    const e = last();
    expect(e.request).toMatchObject({ method: 'POST', pathMatches: false, pathSegmentLengths: [4, 32, 0], hasQuery: false });
    expect(e.fields.sessionId).toBe('s2');
  });

  it('records a POST on / and a query string', async () => {
    await fetch(`${base}/?probe=1`, { method: 'POST', body: '' });
    const e = last();
    expect(e.status).toBe(404);
    expect(e.request).toMatchObject({ method: 'POST', pathMatches: false, pathSegmentLengths: [0], hasQuery: true, bodyBytes: 0 });
  });

  it('records a HEAD as a 404 and leaves pathMatches null when no callback path is configured', async () => {
    const res = await fetch(`${base}${PATH}`, { method: 'HEAD' });
    expect(res.status).toBe(404);
    expect(last().request.method).toBe('HEAD');
    const plain = createServer(recordingListener(stub, (e) => exchanges.push(e)));
    await new Promise<void>((r) => plain.listen(0, '127.0.0.1', r));
    await fetch(`http://127.0.0.1:${(plain.address() as AddressInfo).port}/`);
    await new Promise<void>((r) => plain.close(() => r()));
    expect(last().request.pathMatches).toBeNull();
  });

  it('never writes the path text or the raw PIN into a record, and the console line carries the facts', () => {
    const serialized = JSON.stringify(exchanges);
    expect(serialized).not.toContain(PATH);
    expect(serialized).not.toContain(PATH.slice(1));
    expect(serialized).not.toContain('4729');
    expect(serialized).not.toContain('254738035311');
    const line = describeExchange(exchanges[0]!);
    expect(line).toContain('POST');
    expect(line).toContain('path=[4,32]');
    expect(line).toContain('match=yes');
    expect(line).toContain('ua="gateway-test/1.0"');
    expect(line).toContain('proto=https');
    expect(line).toContain('-> 200');
    expect(line).not.toContain(PATH);
  });
});
