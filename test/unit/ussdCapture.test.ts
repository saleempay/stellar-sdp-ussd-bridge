import { describe, expect, it } from 'vitest';
import { captureBanner, maskCallbackFields, maskCallbackPath, maskMsisdn, maskPinTokens } from '../../src/ussd/index.js';

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
    expect(maskMsisdn('+254738035311')).toBe('+2547***5311');
    expect(maskPinTokens('1*4729*4729')).toBe('1*####*####');
    expect(maskPinTokens('1*2')).toBe('1*2');
    expect(maskCallbackFields('sessionId=s1&phoneNumber=%2B254738035311&text=1*4729&serviceCode=*384*43808%23')).toEqual({ sessionId: 's1', phoneNumber: '+2547***5311', text: '1*####', serviceCode: '*384*43808#' });
  });
});
