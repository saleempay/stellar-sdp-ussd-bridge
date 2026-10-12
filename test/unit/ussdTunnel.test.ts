import { describe, expect, it } from 'vitest';
import { normaliseHostname, parseQuickTunnelHostname, tunnelCommand, tunnelConfigFromEnv, tunnelStartNotice } from '../../src/ussd/index.js';

const PATH = '/ussd/3f9c2a7e1b4d8f6a0c5e9b2d7a1f4c8e';

describe('tunnel configuration', () => {
  it('defaults to a quick tunnel and refuses an unknown mode', () => {
    expect(tunnelConfigFromEnv({})).toEqual({ mode: 'quick' });
    expect(() => tunnelConfigFromEnv({ USSD_TUNNEL_MODE: 'magic' })).toThrow(/quick, named or external/);
  });
  it('named mode needs a fixed hostname and a token or a name', () => {
    expect(() => tunnelConfigFromEnv({ USSD_TUNNEL_MODE: 'named' })).toThrow(/USSD_TUNNEL_HOSTNAME/);
    expect(() => tunnelConfigFromEnv({ USSD_TUNNEL_MODE: 'named', USSD_TUNNEL_HOSTNAME: 'ussd.example.org' })).toThrow(/USSD_TUNNEL_TOKEN or USSD_TUNNEL_NAME/);
    expect(tunnelConfigFromEnv({ USSD_TUNNEL_MODE: 'named', USSD_TUNNEL_HOSTNAME: 'https://USSD.example.org/', USSD_TUNNEL_NAME: 'bridge' })).toEqual({ mode: 'named', hostname: 'ussd.example.org', name: 'bridge' });
  });
  it('normalises a hostname given as a URL', () => {
    expect(normaliseHostname('https://a-b-c.trycloudflare.com/')).toBe('a-b-c.trycloudflare.com');
    expect(normaliseHostname('Host.Example.org:443')).toBe('host.example.org');
  });
});

describe('tunnel command', () => {
  it('quick: cloudflared tunnel --url on the server port', () => {
    expect(tunnelCommand({ mode: 'quick' }, 8085)).toEqual({ command: 'cloudflared', args: ['tunnel', '--no-autoupdate', '--url', 'http://localhost:8085'] });
  });
  it('named: run with a token, or run --url with a name', () => {
    expect(tunnelCommand({ mode: 'named', hostname: 'h', token: 'tok' }, 8085)!.args).toEqual(['tunnel', '--no-autoupdate', 'run', '--token', 'tok']);
    expect(tunnelCommand({ mode: 'named', hostname: 'h', name: 'bridge' }, 8085)!.args).toEqual(['tunnel', '--no-autoupdate', 'run', '--url', 'http://localhost:8085', 'bridge']);
  });
  it('external: nothing to run', () => {
    expect(tunnelCommand({ mode: 'external', hostname: 'h' }, 8085)).toBeUndefined();
  });
});

describe('quick tunnel hostname from the cloudflared log', () => {
  it('finds the trycloudflare hostname and ignores other lines', () => {
    expect(parseQuickTunnelHostname('2026-10-11T06:57Z INF |  https://Swap-Plant-Dinner-Womens.trycloudflare.com  |')).toBe('swap-plant-dinner-womens.trycloudflare.com');
    expect(parseQuickTunnelHostname('INF Requesting new quick Tunnel on trycloudflare.com...')).toBeUndefined();
    expect(parseQuickTunnelHostname('https://api.trycloudflare.com/tunnel')).toBe('api.trycloudflare.com');
  });
});

describe('tunnel start notice', () => {
  it('prints the hostname in full, the base URL and the dashboard reminder; never the path', () => {
    const n = tunnelStartNotice({ at: '2026-10-11T07:00:00.000Z', hostname: 'a-b-c-d.trycloudflare.com', mode: 'quick', restart: false });
    expect(n).toContain('hostname a-b-c-d.trycloudflare.com');
    expect(n).toContain('https://a-b-c-d.trycloudflare.com');
    expect(n).toContain('dashboard callback must be set');
    expect(n).toContain('USSD_CALLBACK_PATH');
    expect(n).not.toContain(PATH);
  });
  it('a restart names both hostnames and says the dashboard must be updated', () => {
    const n = tunnelStartNotice({ at: '2026-10-11T07:30:00.000Z', hostname: 'new-host.trycloudflare.com', mode: 'quick', restart: true }, 'old-host.trycloudflare.com');
    expect(n).toContain('TUNNEL RESTARTED');
    expect(n).toContain('from old-host.trycloudflare.com to new-host.trycloudflare.com');
    expect(n).toContain('must be UPDATED');
  });
});
