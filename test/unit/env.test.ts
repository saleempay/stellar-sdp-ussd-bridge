import { describe, expect, it } from 'vitest';
import { ConfigError, dashboardUrlFor, readinessConfigFor, sdpConfigFromEnv } from '../../src/sdp/env.js';

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
