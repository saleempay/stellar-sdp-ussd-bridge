import { describe, expect, it } from 'vitest';
import { SdpAdminClient, SdpTenantClient, type Tenant } from '../../src/sdp/client.js';
import { ReadinessError, formatReport, provisionTenant, type ReadinessConfig, type ReadinessDeps } from '../../src/sdp/readiness.js';
import { TESTNET_USDC_ISSUER } from '../../src/sdp/facts.js';
import { fakeFetch, type Recorded } from './helpers.js';

/** An in-memory SDP: enough state to exercise every readiness step. */
function fakeSdp(opts: { apiDown?: number; tenantExists?: boolean; isDefault?: boolean; invitationsOff?: boolean; walletEnabled?: boolean; usdcIssuer?: string; noUserManaged?: boolean } = {}) {
  const state = {
    apiHealthCallsLeft: opts.apiDown ?? 0,
    tenant: opts.tenantExists
      ? ({ id: 't1', name: 'bridge', status: 'TENANT_ACTIVATED', is_default: opts.isDefault ?? false, base_url: null, sdp_ui_base_url: null, distribution_account_address: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW', distribution_account_type: 'DISTRIBUTION_ACCOUNT.STELLAR.DB_VAULT', distribution_account_status: 'ACTIVE' } as Tenant)
      : null,
    invitationsOff: opts.invitationsOff ?? false,
    walletEnabled: opts.walletEnabled ?? false,
    usdcIssuer: opts.usdcIssuer ?? TESTNET_USDC_ISSUER,
    passwords: new Map<string, string>(),
    resetTokens: new Map<string, string>(),
  };
  const route = (r: Recorded) => {
    const u = new URL(r.url);
    const p = u.pathname;
    if (p === '/health') {
      if (u.port === '8000' && state.apiHealthCallsLeft > 0) { state.apiHealthCallsLeft -= 1; return { status: 503 }; }
      return { status: 200, body: { status: 'pass' } };
    }
    if (p === '/tenants/bridge') return state.tenant ? { status: 200, body: state.tenant } : { status: 404, body: { error: 'nf' } };
    if (p === '/tenants' && r.method === 'POST') {
      const body = JSON.parse(r.body!);
      state.tenant = { id: 't-new', name: body.name, status: 'TENANT_PROVISIONED', is_default: false, base_url: body.base_url, sdp_ui_base_url: body.sdp_ui_base_url, distribution_account_address: 'GNEW4567ABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQ', distribution_account_type: body.distribution_account_type, distribution_account_status: 'ACTIVE' };
      return { status: 201, body: state.tenant };
    }
        if (p === '/login') { const b = JSON.parse(r.body!); return state.passwords.get(b.email) === b.password ? { status: 200, body: { token: 'tok' } } : { status: 401, body: { error: 'bad' } }; }
    if (p === '/forgot-password') { state.resetTokens.set(JSON.parse(r.body!).email, 'reset-tok-1'); return { status: 200, body: { message: 'maybe' } }; }
    if (p === '/reset-password') { const b = JSON.parse(r.body!); const email = [...state.resetTokens.entries()].find(([, t]) => t === b.reset_token)?.[0]; if (!email) return { status: 400, body: { error: 'Invalid reset password token.' } }; state.passwords.set(email, b.password); state.resetTokens.delete(email); return { status: 200 }; }
    if (p === '/organization' && r.method === 'GET') return { status: 200, body: { name: 'Org', receiver_invitations_disabled: state.invitationsOff } };
    if (p === '/organization' && r.method === 'PATCH') { state.invitationsOff = JSON.parse(r.form!.data!.value).receiver_invitations_disabled === true; return { status: 200, body: { message: 'ok' } }; }
    if (p === '/wallets' && r.method === 'GET') return { status: 200, body: opts.noUserManaged ? [] : [{ id: 'w-um', name: 'User Managed Wallet', enabled: state.walletEnabled, user_managed: true }] };
    if (p === '/wallets/w-um' && r.method === 'PATCH') { state.walletEnabled = JSON.parse(r.body!).enabled; return { status: 200, body: { id: 'w-um', name: 'User Managed Wallet', enabled: state.walletEnabled } }; }
    if (p === '/assets') return { status: 200, body: [{ id: 'a-xlm', code: 'XLM', issuer: '' }, { id: 'a-usdc', code: 'USDC', issuer: state.usdcIssuer }] };
    return undefined;
  };
  const { fetchImpl, calls } = fakeFetch(route);
  const admin = new SdpAdminClient({ baseUrl: 'http://localhost:8003', adminAccount: 'SDP-admin', adminApiKey: 'k', fetch: fetchImpl });
  const tenantClient = (name: string) => new SdpTenantClient({ baseUrl: 'http://localhost:8000', tenantName: name, fetch: fetchImpl });
  const deps: ReadinessDeps = {
    admin,
    tenantClient,
    readResetToken: async (_t, email) => { const t = state.resetTokens.get(email); if (!t) throw new Error('no reset message in log'); return t; },
    sleep: async () => {},
    now: (() => { let t = 0; return () => (t += 1000); })(),
  };
  return { deps, calls, state };
}

const cfg: ReadinessConfig = {
  apiUrl: 'http://localhost:8000', adminUrl: 'http://localhost:8003', uiUrlFor: (n) => `http://${n}.localhost:3000`,
  adminAccount: 'SDP-admin', adminApiKey: 'k',
  tenant: { name: 'bridge', organizationName: 'Org', ownerEmail: 'owner@bridge.local', ownerPassword: 'pw-never-printed' },
  healthTimeoutMs: 30_000, pollIntervalMs: 1_000,
};

describe('provisionTenant', () => {
  it('provisions a fresh tenant end to end and reports every step as done or ok', async () => {
    const { deps, state } = fakeSdp();
    const results = await provisionTenant(cfg, deps);
    expect(results.map((r) => `${r.step}:${r.outcome}`)).toEqual([
      'api health:ok', 'admin health:ok', 'tenant exists:done', 'owner login:done',
      'invitations disabled:done', 'user managed wallet:done', 'usdc asset:ok',
    ]);
    expect(state.tenant?.sdp_ui_base_url).toBe('http://bridge.localhost:3000');
    expect(state.passwords.get('owner@bridge.local')).toBe('pw-never-printed');
    expect(state.invitationsOff).toBe(true);
    expect(state.walletEnabled).toBe(true);
  });

  it('is idempotent: a second run changes nothing and reports already', async () => {
    const { deps, calls } = fakeSdp();
    await provisionTenant(cfg, deps);
    const writesBefore = calls.filter((c) => c.method !== 'GET').length;
    const second = await provisionTenant(cfg, deps);
    const writesAfter = calls.filter((c) => c.method !== 'GET').length;
    expect(second.map((r) => `${r.step}:${r.outcome}`)).toEqual([
      'api health:ok', 'admin health:ok', 'tenant exists:already', 'owner login:already',
      'invitations disabled:already', 'user managed wallet:already', 'usdc asset:ok',
    ]);
    // the only write on the second run is the login itself
    expect(writesAfter - writesBefore).toBe(1);
  });

  it('waits for the API health endpoint and records the wait', async () => {
    const { deps } = fakeSdp({ apiDown: 3 });
    const results = await provisionTenant(cfg, deps);
    expect(results[0]?.detail).toMatch(/answered 200 after \d+ ms/);
  });

  it('fails with the step name when health never comes', async () => {
    const { deps } = fakeSdp({ apiDown: 1000 });
    const err = (await provisionTenant({ ...cfg, healthTimeoutMs: 5_000 }, deps).catch((e: unknown) => e)) as ReadinessError;
    expect(err).toBeInstanceOf(ReadinessError);
    expect(err.step).toBe('api health');
    expect(err.results).toEqual([]);
  });

  it('fails at the owner login step when the dry run log carries no reset message', async () => {
    const { deps } = fakeSdp();
    const noToken: ReadinessDeps = { ...deps, readResetToken: async () => { throw new Error('no reset message in log'); } };
    const err = (await provisionTenant(cfg, noToken).catch((e: unknown) => e)) as ReadinessError;
    expect(err.step).toBe('owner login');
    expect(err.message).toContain('no reset message in log');
  });

  it('fails at the usdc step when the issuer differs from the pinned one, listing assets with masked issuers', async () => {
    const { deps } = fakeSdp({ usdcIssuer: 'GWRONGISSUERXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX' });
    const err = (await provisionTenant(cfg, deps).catch((e: unknown) => e)) as ReadinessError;
    expect(err.step).toBe('usdc asset');
    expect(err.message).toContain('GWRO...XXXX');
    expect(err.message).not.toContain('GWRONGISSUERXXXXXXXXXX');
    expect(err.results.map((r) => r.step)).toContain('user managed wallet');
  });

  it('fails when no user managed wallet is seeded', async () => {
    const { deps } = fakeSdp({ noUserManaged: true });
    const err = (await provisionTenant(cfg, deps).catch((e: unknown) => e)) as ReadinessError;
    expect(err.step).toBe('user managed wallet');
  });

  it('never carries the login password into results or errors', async () => {
    const { deps } = fakeSdp({ noUserManaged: true });
    const err = (await provisionTenant(cfg, deps).catch((e: unknown) => e)) as ReadinessError;
    const text = `${err.message} ${formatReport(err.results)}`;
    expect(text).not.toContain('pw-never-printed');
    const { deps: ok } = fakeSdp();
    expect(formatReport(await provisionTenant(cfg, ok))).not.toContain('pw-never-printed');
  });

  it('masks the distribution account in the tenant step detail', async () => {
    const { deps } = fakeSdp({ tenantExists: true });
    const results = await provisionTenant(cfg, deps);
    const detail = results.find((r) => r.step === 'tenant exists')!.detail;
    expect(detail).toContain('GABC...TUVW');
    expect(detail).not.toContain('GABCDEFGHIJKLMNOPQRSTUVWXYZ234567');
  });
});
