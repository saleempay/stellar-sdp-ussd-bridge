import { describe, expect, it } from 'vitest';
import { SdpAdminClient, SdpHttpError, SdpTenantClient } from '../../src/sdp/client.js';
import { fakeFetch } from './helpers.js';

describe('SdpAdminClient', () => {
  it('sends Basic auth built from account and key, and parses tenants', async () => {
    const { fetchImpl, calls } = fakeFetch((r) =>
      r.url.endsWith('/tenants') ? { status: 200, body: [{ id: 't1', name: 'bridge', is_default: true }] } : undefined,
    );
    const admin = new SdpAdminClient({ baseUrl: 'http://admin:8003/', adminAccount: 'SDP-admin', adminApiKey: 'k3y', fetch: fetchImpl });
    const tenants = await admin.listTenants();
    expect(tenants[0]?.name).toBe('bridge');
    expect(calls[0]?.url).toBe('http://admin:8003/tenants');
    expect(calls[0]?.headers.Authorization).toBe(`Basic ${Buffer.from('SDP-admin:k3y').toString('base64')}`);
  });

  it('getTenant returns null on 404 and the tenant on 200', async () => {
    const { fetchImpl } = fakeFetch((r) =>
      r.url.endsWith('/tenants/bridge') ? { status: 200, body: { id: 't1', name: 'bridge' } } : { status: 404, body: { error: 'not found' } },
    );
    const admin = new SdpAdminClient({ baseUrl: 'http://a', adminAccount: 'x', adminApiKey: 'y', fetch: fetchImpl });
    expect(await admin.getTenant('missing')).toBeNull();
    expect((await admin.getTenant('bridge'))?.id).toBe('t1');
  });

  it('createTenant posts the 7.0.0 request body and accepts only 201', async () => {
    const { fetchImpl, calls } = fakeFetch((r) => (r.method === 'POST' ? { status: 201, body: { id: 't9', name: 'bridge' } } : undefined));
    const admin = new SdpAdminClient({ baseUrl: 'http://a', adminAccount: 'x', adminApiKey: 'y', fetch: fetchImpl });
    const t = await admin.createTenant({
      name: 'bridge', owner_email: 'o@b.local', owner_first_name: 'T', owner_last_name: 'O',
      organization_name: 'Org', distribution_account_type: 'DISTRIBUTION_ACCOUNT.STELLAR.DB_VAULT',
      base_url: 'http://localhost:8000', sdp_ui_base_url: 'http://localhost:3000',
    });
    expect(t.id).toBe('t9');
    const body = JSON.parse(calls[0]!.body!);
    expect(Object.keys(body).sort()).toEqual([
      'base_url', 'distribution_account_type', 'name', 'organization_name', 'owner_email', 'owner_first_name', 'owner_last_name', 'sdp_ui_base_url',
    ]);
    expect(calls[0]?.headers['Content-Type']).toBe('application/json');
  });

  it('createTenant on a 200 (not 201) is an error carrying status and path, never the auth header', async () => {
    const { fetchImpl } = fakeFetch(() => ({ status: 200, body: { id: 'x' } }));
    const admin = new SdpAdminClient({ baseUrl: 'http://a', adminAccount: 'acct', adminApiKey: 'secretkey', fetch: fetchImpl });
    const err = await admin
      .createTenant({ name: 'b', owner_email: '', owner_first_name: '', owner_last_name: '', organization_name: '', distribution_account_type: '', base_url: '', sdp_ui_base_url: '' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SdpHttpError);
    const e = err as SdpHttpError;
    expect(e.status).toBe(200);
    expect(e.path).toBe('/tenants');
    expect(e.message).not.toContain('secretkey');
  });

  it('setDefaultTenant posts {id} to /tenants/default-tenant', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({ status: 200, body: { id: 't1', is_default: true } }));
    const admin = new SdpAdminClient({ baseUrl: 'http://a', adminAccount: 'x', adminApiKey: 'y', fetch: fetchImpl });
    const t = await admin.setDefaultTenant('t1');
    expect(t.is_default).toBe(true);
    expect(calls[0]?.url).toBe('http://a/tenants/default-tenant');
    expect(JSON.parse(calls[0]!.body!)).toEqual({ id: 't1' });
  });

  it('health is false on a network error and on a non-200', async () => {
    const boom = async () => { throw new Error('ECONNREFUSED'); };
    expect(await new SdpAdminClient({ baseUrl: 'http://a', adminAccount: 'x', adminApiKey: 'y', fetch: boom }).health()).toBe(false);
    const { fetchImpl } = fakeFetch(() => ({ status: 503 }));
    expect(await new SdpAdminClient({ baseUrl: 'http://a', adminAccount: 'x', adminApiKey: 'y', fetch: fetchImpl }).health()).toBe(false);
  });
});

describe('SdpTenantClient', () => {
  const base = { baseUrl: 'http://api:8000', tenantName: 'bridge' };

  it('names the tenant in SDP-Tenant-Name on every call and adds the Bearer token when set', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({ status: 200, body: [] }));
    const anon = new SdpTenantClient({ ...base, fetch: fetchImpl });
    await anon.listAssets();
    await anon.withToken('tok').listAssets();
    expect(calls[0]?.headers['SDP-Tenant-Name']).toBe('bridge');
    expect(calls[0]?.headers.Authorization).toBeUndefined();
    expect(calls[1]?.headers.Authorization).toBe('Bearer tok');
  });

  it('login posts email and password and returns the token', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({ status: 200, body: { token: 'jwt.here' } }));
    const token = await new SdpTenantClient({ ...base, fetch: fetchImpl }).login('op@b.local', 'pw');
    expect(token).toBe('jwt.here');
    expect(calls[0]?.url).toBe('http://api:8000/login');
    expect(JSON.parse(calls[0]!.body!)).toEqual({ email: 'op@b.local', password: 'pw' });
  });

  it('login with an empty token in the body is an error', async () => {
    const { fetchImpl } = fakeFetch(() => ({ status: 200, body: {} }));
    await expect(new SdpTenantClient({ ...base, fetch: fetchImpl }).login('a', 'b')).rejects.toBeInstanceOf(SdpHttpError);
  });

  it('forgotPassword and resetPassword post the 7.0.0 bodies', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({ status: 200, body: {} }));
    const c = new SdpTenantClient({ ...base, fetch: fetchImpl });
    await c.forgotPassword('owner@bridge.local');
    await c.resetPassword('tok-1', 'new-password-123');
    expect(calls[0]?.url).toBe('http://api:8000/forgot-password');
    expect(JSON.parse(calls[0]!.body!)).toEqual({ email: 'owner@bridge.local' });
    expect(calls[1]?.url).toBe('http://api:8000/reset-password');
    expect(JSON.parse(calls[1]!.body!)).toEqual({ password: 'new-password-123', reset_token: 'tok-1' });
  });

  it('patchOrganization sends a multipart form whose data field is the JSON patch', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({ status: 200, body: { message: 'updated' } }));
    await new SdpTenantClient({ ...base, token: 't', fetch: fetchImpl }).patchOrganization({ receiver_invitations_disabled: true });
    expect(calls[0]?.method).toBe('PATCH');
    expect(calls[0]?.url).toBe('http://api:8000/organization');
    expect(calls[0]?.form?.data?.value).toBe('{"receiver_invitations_disabled":true}');
    expect(calls[0]?.headers['Content-Type']).toBeUndefined();
  });

  it('listWallets passes the user_managed and enabled filters as query parameters', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({ status: 200, body: [] }));
    const c = new SdpTenantClient({ ...base, token: 't', fetch: fetchImpl });
    await c.listWallets();
    await c.listWallets({ user_managed: true });
    await c.listWallets({ user_managed: true, enabled: false });
    expect(calls.map((x) => x.url)).toEqual([
      'http://api:8000/wallets',
      'http://api:8000/wallets?user_managed=true',
      'http://api:8000/wallets?enabled=false&user_managed=true',
    ]);
  });

  it('patchWallet sends {enabled} as JSON to /wallets/{id}', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({ status: 200, body: { id: 'w1', enabled: true } }));
    const w = await new SdpTenantClient({ ...base, token: 't', fetch: fetchImpl }).patchWallet('w1', { enabled: true });
    expect(w.enabled).toBe(true);
    expect(calls[0]?.url).toBe('http://api:8000/wallets/w1');
    expect(JSON.parse(calls[0]!.body!)).toEqual({ enabled: true });
  });

  it('uploadInstructions posts the csv as the multipart field "file" and refuses a non .csv name', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({ status: 200, body: { message: 'ok' } }));
    const c = new SdpTenantClient({ ...base, token: 't', fetch: fetchImpl });
    await c.uploadInstructions('d1', 'phone,id,amount,walletAddress\n', 'batch.csv', 'dw1');
    expect(calls[0]?.url).toBe('http://api:8000/disbursements/d1/instructions');
    expect(calls[0]?.form?.file?.filename).toBe('batch.csv');
    expect(calls[0]?.form?.file?.type).toBe('text/csv');
    expect(calls[0]?.form?.file?.value).toBe('phone,id,amount,walletAddress\n');
    expect(calls[0]?.headers['X-Wallet-Id']).toBe('dw1');
    await expect(c.uploadInstructions('d1', '', 'batch.txt')).rejects.toThrow(/\.csv/);
  });

  it('createDisbursement accepts 201 only and sets X-Wallet-Id when given', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({ status: 201, body: { id: 'd1', name: 'n', status: 'DRAFT' } }));
    const c = new SdpTenantClient({ ...base, token: 't', fetch: fetchImpl });
    const d = await c.createDisbursement(
      { name: 'n', asset_id: 'a', registration_contact_type: 'PHONE_NUMBER_AND_WALLET_ADDRESS' },
      'dw1',
    );
    expect(d.status).toBe('DRAFT');
    expect(JSON.parse(calls[0]!.body!)).toEqual({ name: 'n', asset_id: 'a', registration_contact_type: 'PHONE_NUMBER_AND_WALLET_ADDRESS' });
    expect(calls[0]?.headers['X-Wallet-Id']).toBe('dw1');
    const d2 = fakeFetch(() => ({ status: 200, body: {} }));
    await expect(
      new SdpTenantClient({ ...base, token: 't', fetch: d2.fetchImpl }).createDisbursement(
        { name: 'n', asset_id: 'a', registration_contact_type: 'PHONE_NUMBER_AND_WALLET_ADDRESS' },
      ),
    ).rejects.toBeInstanceOf(SdpHttpError);
  });

  it('patchDisbursementStatus and listReceivers use the 7.0.0 paths and the q parameter', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({ status: 200, body: { data: [], pagination: {} } }));
    const c = new SdpTenantClient({ ...base, token: 't', fetch: fetchImpl });
    await c.patchDisbursementStatus('d1', 'STARTED');
    await c.listReceivers('+2547 00');
    expect(calls[0]?.url).toBe('http://api:8000/disbursements/d1/status');
    expect(JSON.parse(calls[0]!.body!)).toEqual({ status: 'STARTED' });
    expect(calls[1]?.url).toBe('http://api:8000/receivers?q=%2B2547%2000');
  });

  it('an error body is truncated in the message', async () => {
    const { fetchImpl } = fakeFetch(() => ({ status: 500, body: { error: 'x'.repeat(1000) } }));
    const err = (await new SdpTenantClient({ ...base, token: 't', fetch: fetchImpl }).listAssets().catch((e: unknown) => e)) as SdpHttpError;
    expect(err.status).toBe(500);
    expect(err.message.length).toBeLessThan(400);
  });
});
