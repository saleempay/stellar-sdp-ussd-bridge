import { describe, expect, it } from 'vitest';
import { SdpAdminClient, SdpTenantClient, type Tenant } from '../../src/sdp/client.js';
import { ReadinessError, formatReport, provisionTenant, type ReadinessConfig, type ReadinessDeps } from '../../src/sdp/readiness.js';
import { TESTNET_USDC_ISSUER } from '../../src/sdp/facts.js';
import { fakeFetch, type Recorded } from './helpers.js';

/** An in-memory SDP: enough state to exercise every readiness step. */
function fakeSdp(opts: { apiDown?: number; tenantExists?: boolean; tenantStatus?: string; noDistributionAccount?: boolean; isDefault?: boolean; invitationsOff?: boolean; walletEnabled?: boolean; usdcIssuer?: string; noUserManaged?: boolean; otherUserManagedName?: string; mfaDisabled?: boolean | null; strictMfa?: boolean } = {}) {
  const state = {
    apiHealthCallsLeft: opts.apiDown ?? 0,
    tenant: opts.tenantExists
      ? ({ id: 't1', name: 'bridge', status: opts.tenantStatus ?? 'TENANT_ACTIVATED', is_default: opts.isDefault ?? false, base_url: null, sdp_ui_base_url: null, distribution_account_address: opts.noDistributionAccount ? null : 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW', distribution_account_type: 'DISTRIBUTION_ACCOUNT.STELLAR.DB_VAULT', distribution_account_status: 'ACTIVE' } as Tenant)
      : null,
    invitationsOff: opts.invitationsOff ?? false,
    walletEnabled: opts.walletEnabled ?? false,
    usdcIssuer: opts.usdcIssuer ?? TESTNET_USDC_ISSUER,
    passwords: new Map<string, string>(),
    resetTokens: new Map<string, string>(),
    /** organizations.mfa_disabled; null means the DISABLE_MFA flag (true on this fake stack) decides */
    mfaDisabled: opts.mfaDisabled === undefined ? true : opts.mfaDisabled,
    mfaBodies: [] as Array<Record<string, unknown>>,
  };
  const mfaRequired = () => state.mfaDisabled === false;
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
    if (p === '/login') {
      const b = JSON.parse(r.body!);
      if (state.passwords.get(b.email) !== b.password) return { status: 401, body: { error: 'bad' } };
      return mfaRequired() ? { status: 200, body: { message: 'MFA code sent to email. Check your inbox and spam folders.' } } : { status: 200, body: { token: 'tok' } };
    }
    if (p === '/mfa') { const b = JSON.parse(r.body!); state.mfaBodies.push(b); return b.mfa_code === '246810' ? { status: 200, body: { token: 'tok-mfa' } } : { status: 401, body: { error: 'bad code' } }; }
    if (p === '/forgot-password') { state.resetTokens.set(JSON.parse(r.body!).email, 'reset-tok-1'); return { status: 200, body: { message: 'maybe' } }; }
    if (p === '/reset-password') { const b = JSON.parse(r.body!); const email = [...state.resetTokens.entries()].find(([, t]) => t === b.reset_token)?.[0]; if (!email) return { status: 400, body: { error: 'Invalid reset password token.' } }; state.passwords.set(email, b.password); state.resetTokens.delete(email); return { status: 200 }; }
    if (p === '/organization' && r.method === 'GET') return { status: 200, body: { name: 'Org', receiver_invitations_disabled: state.invitationsOff, mfa_disabled: state.mfaDisabled } };
    if (p === '/organization' && r.method === 'PATCH') {
      const patch = JSON.parse(r.form!.data!.value) as Record<string, unknown>;
      if ('receiver_invitations_disabled' in patch) state.invitationsOff = patch.receiver_invitations_disabled === true;
      if ('mfa_disabled' in patch) state.mfaDisabled = patch.mfa_disabled as boolean;
      return { status: 200, body: { message: 'ok' } };
    }
    if (p === '/wallets' && r.method === 'GET') return { status: 200, body: opts.noUserManaged ? [] : [{ id: 'w-um', name: opts.otherUserManagedName ?? 'User Managed Wallet', enabled: state.walletEnabled, user_managed: true }] };
    if (p === '/wallets/w-um' && r.method === 'PATCH') { state.walletEnabled = JSON.parse(r.body!).enabled; return { status: 200, body: { id: 'w-um', name: 'User Managed Wallet', enabled: state.walletEnabled } }; }
    if (p === '/assets') return { status: 200, body: [{ id: 'a-xlm', code: 'XLM', issuer: '' }, { id: 'a-usdc', code: 'USDC', issuer: state.usdcIssuer }] };
    return undefined;
  };
  const asked: string[] = [];
  const { fetchImpl, calls } = fakeFetch(route);
  const admin = new SdpAdminClient({ baseUrl: 'http://localhost:8003', adminAccount: 'SDP-admin', adminApiKey: 'k', fetch: fetchImpl });
  const tenantClient = (name: string) => new SdpTenantClient({ baseUrl: 'http://localhost:8000', tenantName: name, fetch: fetchImpl, strictMfa: opts.strictMfa ?? false });
  const deps: ReadinessDeps = {
    admin,
    tenantClient,
    readResetToken: async (_t, email) => { const t = state.resetTokens.get(email); if (!t) throw new Error('no reset message in log'); return t; },
    mfaCode: async (email) => { asked.push(email); return '246810'; },
    sleep: async () => {},
    now: (() => { let t = 0; return () => (t += 1000); })(),
  };
  return { deps, calls, state, asked };
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
      'api health:ok', 'admin health:ok', 'tenant exists:done', 'owner login:done', 'mfa setting:ok',
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
      'api health:ok', 'admin health:ok', 'tenant exists:already', 'owner login:already', 'mfa setting:ok',
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

  it('fails when the named wallet is absent instead of enabling whichever user managed wallet comes first', async () => {
    const { deps, calls } = fakeSdp({ otherUserManagedName: 'Some Other Wallet' });
    const err = (await provisionTenant(cfg, deps).catch((e: unknown) => e)) as ReadinessError;
    expect(err.step).toBe('user managed wallet');
    expect(err.message).toContain('"User Managed Wallet"');
    expect(err.message).toContain('"Some Other Wallet"');
    expect(calls.some((c) => c.method === 'PATCH' && c.url.includes('/wallets/'))).toBe(false);
  });

  it('never carries the login password into results or errors', async () => {
    const { deps } = fakeSdp({ noUserManaged: true });
    const err = (await provisionTenant(cfg, deps).catch((e: unknown) => e)) as ReadinessError;
    const text = `${err.message} ${formatReport(err.results)}`;
    expect(text).not.toContain('pw-never-printed');
    const { deps: ok } = fakeSdp();
    expect(formatReport(await provisionTenant(cfg, ok))).not.toContain('pw-never-printed');
  });

  it('refuses an existing tenant whose status is not usable, naming the status and the usable set', async () => {
    for (const status of ['TENANT_CREATED', 'TENANT_DEACTIVATED']) {
      const { deps, calls } = fakeSdp({ tenantExists: true, tenantStatus: status });
      const err = (await provisionTenant(cfg, deps).catch((e: unknown) => e)) as ReadinessError;
      expect(err).toBeInstanceOf(ReadinessError);
      expect(err.step).toBe('tenant exists');
      expect(err.message).toContain(status);
      expect(err.message).toContain('TENANT_PROVISIONED, TENANT_ACTIVATED');
      // nothing after the tenant step ran: no login, no organisation patch
      expect(calls.some((c) => c.url.endsWith('/login'))).toBe(false);
    }
  });

  it('accepts an existing tenant in either usable status', async () => {
    for (const status of ['TENANT_PROVISIONED', 'TENANT_ACTIVATED']) {
      const { deps } = fakeSdp({ tenantExists: true, tenantStatus: status });
      const results = await provisionTenant(cfg, deps);
      expect(results.find((r) => r.step === 'tenant exists')?.outcome).toBe('already');
    }
  });

  it('refuses an existing tenant with no distribution account address', async () => {
    const { deps } = fakeSdp({ tenantExists: true, noDistributionAccount: true });
    const err = (await provisionTenant(cfg, deps).catch((e: unknown) => e)) as ReadinessError;
    expect(err.step).toBe('tenant exists');
    expect(err.message).toContain('no distribution account address');
  });

  it('masks the distribution account in the tenant step detail', async () => {
    const { deps } = fakeSdp({ tenantExists: true });
    const results = await provisionTenant(cfg, deps);
    const detail = results.find((r) => r.step === 'tenant exists')!.detail;
    expect(detail).toContain('GABC...TUVW');
    expect(detail).not.toContain('GABCDEFGHIJKLMNOPQRSTUVWXYZ234567');
  });
});

describe('owner login with MFA enabled on the stack', () => {
  it('passes the prompt into the login of the reset flow and completes; remember_me is never asked', async () => {
    const { deps, state, asked } = fakeSdp({ mfaDisabled: false });
    const results = await provisionTenant(cfg, deps);
    expect(results.map((r) => `${r.step}:${r.outcome}`)).toContain('owner login:done');
    expect(asked).toEqual(['owner@bridge.local']);
    expect(state.mfaBodies.map((b) => b.remember_me)).toEqual([false]);
  });

  it('without a prompt, an MFA-enabled stack fails the owner login step naming /mfa', async () => {
    const { deps, state } = fakeSdp({ mfaDisabled: false });
    state.passwords.set('owner@bridge.local', 'pw-never-printed');
    const err = await provisionTenant(cfg, { ...deps, mfaCode: undefined }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ReadinessError);
    expect((err as ReadinessError).step).toBe('owner login');
    expect((err as ReadinessError).message).toContain('/mfa');
  });
});

describe('mfa setting step (L2 fix round)', () => {
  const other = { ...cfg, networkType: 'othernet' };

  it('testnet: reports the organisation value and changes nothing, whether true, false or null', async () => {
    for (const value of [true, false, null] as const) {
      const { deps, state, calls } = fakeSdp({ mfaDisabled: value });
      const results = await provisionTenant(cfg, deps);
      const step = results.find((r) => r.step === 'mfa setting')!;
      expect(step.outcome).toBe('ok');
      expect(step.detail).toContain(`mfa_disabled is ${String(value)}`);
      expect(step.detail).toContain('testnet, unchanged');
      expect(state.mfaDisabled).toBe(value);
      expect(calls.filter((c) => c.method === 'PATCH' && c.url.endsWith('/organization') && c.form?.data?.value.includes('mfa_disabled'))).toHaveLength(0);
    }
  });

  it('other network, mfa_disabled already false: already, and the login needed the code', async () => {
    const { deps, asked, state } = fakeSdp({ mfaDisabled: false, strictMfa: true });
    state.passwords.set('owner@bridge.local', 'pw-never-printed'); // off testnet the password is set through a real channel first
    const results = await provisionTenant(other, deps);
    const step = results.find((r) => r.step === 'mfa setting')!;
    expect(step.outcome).toBe('already');
    expect(asked.length).toBeGreaterThan(0);
  });

  for (const value of [true, null] as const) {
    it(`other network, mfa_disabled ${String(value)}: the restricted token turns MFA on, then a code is required and the value reads back false`, async () => {
      const { deps, state, asked, calls } = fakeSdp({ mfaDisabled: value, strictMfa: true });
      state.passwords.set('owner@bridge.local', 'pw-never-printed'); // off testnet the password is set through a real channel first
      const results = await provisionTenant(other, deps);
      const step = results.find((r) => r.step === 'mfa setting')!;
      expect(step.outcome).toBe('done');
      expect(step.detail).toContain('login now requires the emailed code');
      expect(state.mfaDisabled).toBe(false);
      // first login got a token without a code (no prompt), the patch went through, then one prompted login
      expect(asked).toEqual(['owner@bridge.local']);
      const patches = calls.filter((c) => c.method === 'PATCH' && c.url.endsWith('/organization')).map((c) => c.form!.data!.value);
      expect(patches[0]).toBe(JSON.stringify({ mfa_disabled: false }));
      // every later step ran on the verified client
      expect(results.map((r) => `${r.step}:${r.outcome}`)).toEqual([
        'api health:ok', 'admin health:ok', 'tenant exists:done', 'owner login:already', 'mfa setting:done',
        'invitations disabled:done', 'user managed wallet:done', 'usdc asset:ok',
      ]);
      expect(state.mfaBodies.every((b) => b.remember_me === false)).toBe(true);
    });
  }

  it('other network: a restricted token cannot be used for anything but the MFA-enabling call', async () => {
    const { deps } = fakeSdp({ mfaDisabled: true, strictMfa: true });
    const restricted = await deps.tenantClient('bridge').authenticate('owner@bridge.local', 'pw-never-printed').catch(() => undefined);
    // the password is not set yet on a fresh fake: set it through the flow first
    const { deps: d2, state } = fakeSdp({ mfaDisabled: true, strictMfa: true });
    state.passwords.set('owner@bridge.local', 'pw-never-printed');
    const c = await d2.tenantClient('bridge').authenticate('owner@bridge.local', 'pw-never-printed');
    expect(restricted).toBeUndefined();
    expect(c.restrictedToMfaEnable).toBe(true);
    await expect(c.getOrganization()).rejects.toThrow(/refused: this token was obtained without a verification code/);
    await expect(c.patchOrganization({ receiver_invitations_disabled: true })).rejects.toThrow(/refused/);
    await expect(c.patchOrganization({ mfa_disabled: false, name: 'x' })).rejects.toThrow(/refused/);
    await expect(c.patchOrganization({ mfa_disabled: false })).resolves.toBeUndefined();
    expect(state.mfaDisabled).toBe(false);
  });
});

describe('owner login: the log reset path is testnet only (fix round of 18 October)', () => {
  it('on another network a failed login is refused before /forgot-password, naming the real channel', async () => {
    const { deps, calls } = fakeSdp({ mfaDisabled: false, strictMfa: true });
    // the fake holds no password for the owner, so the login answers 401
    const err = await provisionTenant({ ...cfg, networkType: 'othernet' }, deps).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ReadinessError);
    expect((err as ReadinessError).step).toBe('owner login');
    expect((err as ReadinessError).message).toContain('testnet only');
    expect((err as ReadinessError).message).toContain('real channel');
    expect(calls.some((c) => c.url.endsWith('/forgot-password'))).toBe(false);
    expect(calls.some((c) => c.url.endsWith('/reset-password'))).toBe(false);
  });

  it('resetThroughLog false is honoured on testnet too, and true on another network only when set explicitly', async () => {
    const refused = await provisionTenant({ ...cfg, resetThroughLog: false }, fakeSdp().deps).catch((e: unknown) => e);
    expect((refused as ReadinessError).step).toBe('owner login');
    const { deps, state } = fakeSdp({ mfaDisabled: false, strictMfa: true });
    const results = await provisionTenant({ ...cfg, networkType: 'othernet', resetThroughLog: true }, deps);
    expect(results.find((r) => r.step === 'owner login')?.outcome).toBe('done');
    expect(state.passwords.get('owner@bridge.local')).toBe('pw-never-printed');
  });

  it('on testnet the reset path still runs (unchanged behaviour)', async () => {
    const { deps, calls } = fakeSdp();
    const results = await provisionTenant(cfg, deps);
    expect(results.find((r) => r.step === 'owner login')?.outcome).toBe('done');
    expect(calls.some((c) => c.url.endsWith('/forgot-password'))).toBe(true);
  });
});
