import { describe, expect, it } from 'vitest';
import { ConfigError, dashboardUrlFor, readinessConfigFor, sdpConfigFromEnv } from '../../src/sdp/env.js';
import { NetworkConfigError } from '../../src/sdp/network.js';

/** Made-up values for a network that is not testnet; nothing here names a real network. */
const OTHER = {
  NETWORK_TYPE: 'othernet',
  NETWORK_PASSPHRASE: 'Other Network ; Example Only',
  HORIZON_URL: 'https://horizon.example.test',
  ASSET_ISSUER: 'G'.padEnd(56, 'A'),
  EXPLORER_BASE_URL: 'https://explorer.example.test/other',
  BRIDGE_ACKNOWLEDGE_REAL_FUNDS: 'yes',
};
const refusal = (env: Record<string, string>): NetworkConfigError => {
  try { sdpConfigFromEnv(env); } catch (e) { expect(e).toBeInstanceOf(NetworkConfigError); return e as NetworkConfigError; }
  throw new Error('expected a refusal');
};

const full = {
  ADMIN_ACCOUNT: 'SDP-admin', ADMIN_API_KEY: 'k', PORT: '8000', ADMIN_PORT: '8003',
  BRIDGE_TENANT_NAME: 'bridge', BRIDGE_OWNER_EMAIL: 'owner@bridge.local', BRIDGE_OWNER_PASSWORD: 'p1',
  SCOPETEST_TENANT_NAME: 'scopetest', SCOPETEST_OWNER_EMAIL: 'owner@scopetest.local', SCOPETEST_OWNER_PASSWORD: 'p2',
};

describe('sdpConfigFromEnv', () => {
  it('builds the bridge tenant and the scope test tenant, each with its own dashboard URL', () => {
    const cfg = sdpConfigFromEnv(full);
    expect(cfg.apiUrl).toBe('http://localhost:8000');
    expect(cfg.adminUrl).toBe('http://localhost:8003');
    expect(cfg.tenants.map((t) => t.name)).toEqual(['bridge', 'scopetest']);
    const r = readinessConfigFor(cfg, cfg.tenants[0]!);
    expect(r.tenant.ownerEmail).toBe('owner@bridge.local');
    expect(r.uiUrlFor('bridge')).toBe('http://bridge.localhost:3000');
    expect(cfg.strictMfa).toBe(false);
    expect(cfg.resetThroughLog).toBe(true);
    expect(r.networkType).toBe('testnet');
    expect(r.resetThroughLog).toBe(true);
    expect(dashboardUrlFor('https://sdp.example.org', 'bridge')).toBe('https://sdp.example.org');
  });

  it('names missing keys without echoing any value', () => {
    const { BRIDGE_OWNER_PASSWORD: _omit, ...rest } = full;
    const err = (() => { try { sdpConfigFromEnv({ ...rest, ADMIN_API_KEY: '' }); } catch (e) { return e as Error; } return undefined; })();
    expect(err).toBeInstanceOf(ConfigError);
    expect(err?.message).toContain('ADMIN_API_KEY');
    expect(err?.message).toContain('BRIDGE_OWNER_PASSWORD');
    expect(err?.message).not.toContain('p2');
  });
});

describe('sdpConfigFromEnv: the email sender off testnet (fix round of 18 October)', () => {
  it('testnet accepts DRY_RUN, the compose default, and an unset sender', () => {
    expect(sdpConfigFromEnv({ ...full, EMAIL_SENDER_TYPE: 'DRY_RUN' }).resetThroughLog).toBe(true);
    expect(sdpConfigFromEnv(full).resetThroughLog).toBe(true);
  });

  it('another network refuses an unset sender, naming the variable and the reason', () => {
    const err = refusal({ ...full, ...OTHER });
    expect(err.reasons.join(' ')).toContain('EMAIL_SENDER_TYPE is not set');
    expect(err.reasons.join(' ')).toContain('log');
  });

  it('another network refuses DRY_RUN in any case', () => {
    for (const v of ['DRY_RUN', 'dry_run', ' Dry_Run ']) {
      const err = refusal({ ...full, ...OTHER, EMAIL_SENDER_TYPE: v });
      expect(err.reasons.join(' ')).toContain('EMAIL_SENDER_TYPE is DRY_RUN');
    }
  });

  it('another network with a real sender passes, in strict MFA mode and with the log reset path off', () => {
    const cfg = sdpConfigFromEnv({ ...full, ...OTHER, EMAIL_SENDER_TYPE: 'AWS_EMAIL' });
    expect(cfg.strictMfa).toBe(true);
    expect(cfg.resetThroughLog).toBe(false);
    expect(readinessConfigFor(cfg, cfg.tenants[0]!).resetThroughLog).toBe(false);
  });
});
