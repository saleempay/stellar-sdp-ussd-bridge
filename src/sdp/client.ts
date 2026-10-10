/**
 * A small typed client for the SDP 7.0.0 HTTP APIs the bridge uses: the
 * admin (multi-tenant) API on the admin port and the per-tenant API on the
 * main port. Every route, field and header named here was read from the
 * SDP source at tag 7.0.0; the file and line are given next to each.
 *
 * The client takes `fetch` as a dependency so the offline tests can drive
 * it with a fake and assert the exact request shape.
 */
import { randomUUID } from 'node:crypto';
import { TENANT_HEADER, WALLET_ID_HEADER } from './facts.js';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** A non-success HTTP response. The body is truncated; headers are never kept. */
export class SdpHttpError extends Error {
  constructor(
    readonly method: string,
    readonly path: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(`SDP ${method} ${path} returned HTTP ${status}: ${truncate(body)}`);
    this.name = 'SdpHttpError';
  }
}

function truncate(s: string, max = 300): string {
  return s.length <= max ? s : `${s.slice(0, max)}...`;
}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}${path}`;
}

interface Call {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  headers?: Record<string, string>;
  body?: BodyInit;
  /** Accepted status codes. Default: any 2xx. */
  accept?: number[];
}

async function send(fetchImpl: FetchLike, base: string, call: Call): Promise<Response> {
  const res = await fetchImpl(joinUrl(base, call.path), {
    method: call.method,
    headers: call.headers,
    body: call.body,
  });
  const ok = call.accept ? call.accept.includes(res.status) : res.status >= 200 && res.status < 300;
  if (!ok) {
    const text = await res.text().catch(() => '');
    throw new SdpHttpError(call.method, call.path, res.status, text);
  }
  return res;
}

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

// ---------------------------------------------------------------------------
// Admin API (stellar-multitenant/pkg/serve/serve.go:140-164, Basic auth with
// ADMIN_ACCOUNT and ADMIN_API_KEY; internal/serve/middleware/middleware.go:361)
// ---------------------------------------------------------------------------

/** pkg/schema/tenant.go:8-22 */
export interface Tenant {
  id: string;
  name: string;
  status: string;
  is_default: boolean;
  base_url: string | null;
  sdp_ui_base_url: string | null;
  distribution_account_address: string | null;
  distribution_account_type: string;
  distribution_account_status: string;
}

/** stellar-multitenant/internal/validators/tenant_validator.go:16-25 */
export interface CreateTenantRequest {
  name: string;
  owner_email: string;
  owner_first_name: string;
  owner_last_name: string;
  organization_name: string;
  distribution_account_type: string;
  base_url: string;
  sdp_ui_base_url: string;
}

export interface SdpAdminClientOptions {
  baseUrl: string;
  adminAccount: string;
  adminApiKey: string;
  fetch?: FetchLike;
}

export class SdpAdminClient {
  private readonly fetchImpl: FetchLike;
  private readonly base: string;
  private readonly auth: string;

  constructor(opts: SdpAdminClientOptions) {
    this.fetchImpl = opts.fetch ?? ((input, init) => fetch(input, init));
    this.base = opts.baseUrl;
    this.auth = `Basic ${Buffer.from(`${opts.adminAccount}:${opts.adminApiKey}`, 'utf8').toString('base64')}`;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { Authorization: this.auth, Accept: 'application/json', ...extra };
  }

  /** GET /health on the admin port (stellar-multitenant/pkg/serve/serve.go:133). */
  async health(): Promise<boolean> {
    try {
      const res = await this.fetchImpl(joinUrl(this.base, '/health'), { method: 'GET' });
      return res.status === 200;
    } catch {
      return false;
    }
  }

  /** GET /tenants */
  async listTenants(): Promise<Tenant[]> {
    const res = await send(this.fetchImpl, this.base, { method: 'GET', path: '/tenants', headers: this.headers() });
    return json<Tenant[]>(res);
  }

  /** GET /tenants/{name}; null when the SDP answers 404. */
  async getTenant(name: string): Promise<Tenant | null> {
    const res = await send(this.fetchImpl, this.base, {
      method: 'GET',
      path: `/tenants/${encodeURIComponent(name)}`,
      headers: this.headers(),
      accept: [200, 404],
    });
    if (res.status === 404) return null;
    return json<Tenant>(res);
  }

  /** POST /tenants, answers 201 with the tenant. */
  async createTenant(req: CreateTenantRequest): Promise<Tenant> {
    const res = await send(this.fetchImpl, this.base, {
      method: 'POST',
      path: '/tenants',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(req),
      accept: [201],
    });
    return json<Tenant>(res);
  }

  /** POST /tenants/default-tenant with {id} (tenant_validator.go:33-35). */
  async setDefaultTenant(id: string): Promise<Tenant> {
    const res = await send(this.fetchImpl, this.base, {
      method: 'POST',
      path: '/tenants/default-tenant',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ id }),
    });
    return json<Tenant>(res);
  }
}

// ---------------------------------------------------------------------------
// Tenant API (internal/serve/serve.go). The tenant is named in the
// SDP-Tenant-Name header (middleware.go:28,404). Authenticated routes take
// a Bearer token from POST /login (login_handler.go:24-32).
// ---------------------------------------------------------------------------

/** internal/data/assets.go:18-25 */
export interface Asset {
  id: string;
  code: string;
  issuer: string;
}

/** internal/data/wallets.go:25-37 (subset) */
export interface Wallet {
  id: string;
  name: string;
  enabled: boolean;
  user_managed?: boolean;
  assets?: Asset[];
}

/** GET /organization keys, profile_handler.go:405-420 (subset) */
export interface Organization {
  name?: string;
  receiver_invitations_disabled?: boolean | null;
  /** Organisation-level MFA switch (internal/data/organizations.go:55); null means the DISABLE_MFA flag decides. */
  mfa_disabled?: boolean | null;
  distribution_account_public_key?: string;
  [key: string]: unknown;
}

/** internal/data/distribution_wallets.go:39-49 (subset) */
export interface DistributionWallet {
  id: string;
  name: string;
  distribution_account_address?: string;
  distribution_account_status?: string;
  status: string;
  is_default: boolean;
}

/**
 * disbursement_handler.go:49-56. For a contact type that includes the
 * wallet address, `wallet_id` must be omitted: the SDP refuses it with 400
 * and selects the enabled user managed wallet itself
 * (disbursement_handler.go:66-76,142-160). For the other contact types it
 * is required.
 */
export interface CreateDisbursementRequest {
  name: string;
  wallet_id?: string;
  asset_id: string;
  registration_contact_type: string;
  verification_field?: string;
  receiver_registration_message_template?: string;
}

export interface Disbursement {
  id: string;
  name: string;
  status: string;
  registration_contact_type?: string;
  /** Payment rows of the disbursement (internal/data/disbursements.go:43). */
  total_payments?: number;
  [key: string]: unknown;
}

/** internal/serve/httpresponse/paginated_response.go:10-13 */
export interface Paginated<T> {
  data: T[];
  pagination: { next?: string; prev?: string; pages?: number; total?: number };
}

/** internal/data/receivers.go Receiver (subset) */
export interface Receiver {
  id: string;
  phone_number?: string;
  email?: string;
  external_id?: string;
  [key: string]: unknown;
}

/** internal/data/payments.go Payment (subset) */
export interface Payment {
  id: string;
  amount: string;
  status: string;
  stellar_transaction_id?: string;
  [key: string]: unknown;
}

export interface SdpTenantClientOptions {
  baseUrl: string;
  tenantName: string;
  token?: string;
  fetch?: FetchLike;
  /**
   * Value of the `Device-ID` header the SDP requires on POST /login and
   * POST /mfa when MFA is enabled (login_handler.go:59-60,
   * mfa_handler.go:35,48). Any stable opaque string; a random one is
   * generated when absent. Ignored by the SDP when MFA is disabled.
   */
  deviceId?: string;
  /**
   * Strict mode, on for any network other than testnet: `login` refuses a
   * token obtained without an emailed code (use `authenticate`), the client
   * never asks the SDP to remember the device, and a token obtained without
   * a code may be used for exactly one call, the PATCH /organization that
   * turns MFA on. Every other call on such a client is refused.
   */
  strictMfa?: boolean;
  /** Internal: set by `authenticate` in strict mode when no code was used. */
  restrictedToMfaEnable?: boolean;
}

/** Strict mode refused a call because the token was obtained without a code. */
export class MfaRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MfaRequiredError';
  }
}

/** Header name, mfa_handler.go:35 at tag 7.0.0. */
export const DEVICE_ID_HEADER = 'Device-ID';

/** The message the SDP answers /login with when an emailed code is needed (login_handler.go:133-137). */
export const MFA_CODE_SENT_MESSAGE = 'MFA code sent to email. Check your inbox and spam folders.';

export interface LoginOptions {
  /**
   * Asked for the emailed verification code when the SDP requires one
   * (MFA enabled and the device not remembered). The reference prompt
   * reads it from standard input (`promptMfaCode`). Without a prompt, a
   * login that needs a code fails with an SdpHttpError naming /mfa.
   */
  mfaCode?: (email: string) => Promise<string>;
}

export class SdpTenantClient {
  private readonly fetchImpl: FetchLike;
  private readonly base: string;
  readonly tenantName: string;
  private readonly token: string | undefined;
  private readonly deviceId: string;
  /** Strict mode (any network other than testnet). */
  readonly strictMfa: boolean;
  /** True when this client's token was obtained without a code in strict mode: one call allowed. */
  readonly restrictedToMfaEnable: boolean;

  constructor(private readonly opts: SdpTenantClientOptions) {
    this.fetchImpl = opts.fetch ?? ((input, init) => fetch(input, init));
    this.base = opts.baseUrl;
    this.tenantName = opts.tenantName;
    this.token = opts.token;
    this.deviceId = opts.deviceId ?? randomUUID();
    this.strictMfa = opts.strictMfa ?? false;
    this.restrictedToMfaEnable = opts.restrictedToMfaEnable ?? false;
  }

  /** The same client with a Bearer token attached (unrestricted; in strict mode prefer `authenticate`). */
  withToken(token: string): SdpTenantClient {
    return new SdpTenantClient({ ...this.opts, token, restrictedToMfaEnable: false });
  }

  /**
   * Every authenticated request goes through here. A client restricted to
   * the MFA-enabling call refuses anything else before it reaches the wire.
   */
  private async request(call: Call, purpose: 'mfa-enable' | 'other' = 'other'): Promise<Response> {
    if (this.restrictedToMfaEnable && purpose !== 'mfa-enable') {
      throw new MfaRequiredError(`${call.method} ${call.path.split('?')[0]} refused: this token was obtained without a verification code on a network other than testnet; the only call allowed with it is the PATCH /organization that sets mfa_disabled to false`);
    }
    return send(this.fetchImpl, this.base, call);
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const h: Record<string, string> = { [TENANT_HEADER]: this.tenantName, Accept: 'application/json' };
    if (this.token) h.Authorization = `Bearer ${this.token}`;
    return { ...h, ...extra };
  }

  private walletHeader(walletId?: string): Record<string, string> {
    return walletId ? { [WALLET_ID_HEADER]: walletId } : {};
  }

  /** GET /health on the API port (internal/serve/serve.go:930). */
  async health(): Promise<boolean> {
    try {
      const res = await this.fetchImpl(joinUrl(this.base, '/health'), { method: 'GET' });
      return res.status === 200;
    } catch {
      return false;
    }
  }

  /**
   * POST /login {email, password}; returns the token (login_handler.go:24-32).
   *
   * With MFA disabled, or the device remembered, the SDP answers 200 with
   * `{token}` (login_handler.go:130-132). Otherwise it emails a code and
   * answers 200 with a message instead of a token (login_handler.go:133-137,
   * 163-173); the token then comes from POST /mfa {mfa_code, remember_me}
   * with the same Device-ID header (mfa_handler.go:18-22, 92, 112). Both
   * requests carry Device-ID, which the SDP requires whenever MFA is on
   * (login_handler.go:59-60, mfa_handler.go:48) and ignores otherwise.
   */
  async login(email: string, password: string, opts: LoginOptions = {}): Promise<string> {
    const r = await this.loginDetailed(email, password, opts);
    if (this.strictMfa && !r.codeUsed) {
      throw new MfaRequiredError('login refused in strict mode: the SDP issued a token without a verification code (MFA is off for this organisation); use authenticate(), whose client may only turn MFA on');
    }
    return r.token;
  }

  /**
   * Log in and return an authenticated client. In strict mode a token
   * obtained without a code yields a client restricted to the single call
   * that turns MFA on (`patchOrganization({ mfa_disabled: false })`); after
   * that call, authenticate again, which then requires the code.
   */
  async authenticate(email: string, password: string, opts: LoginOptions = {}): Promise<SdpTenantClient> {
    const r = await this.loginDetailed(email, password, opts);
    return new SdpTenantClient({ ...this.opts, token: r.token, restrictedToMfaEnable: this.strictMfa && !r.codeUsed });
  }

  private async loginDetailed(email: string, password: string, opts: LoginOptions): Promise<{ token: string; codeUsed: boolean }> {
    const res = await send(this.fetchImpl, this.base, {
      method: 'POST',
      path: '/login',
      headers: this.headers({ 'Content-Type': 'application/json', [DEVICE_ID_HEADER]: this.deviceId }),
      body: JSON.stringify({ email, password }),
    });
    const body = await json<{ token?: string; message?: string }>(res);
    if (body.token) return { token: body.token, codeUsed: false };
    if (body.message !== MFA_CODE_SENT_MESSAGE) throw new SdpHttpError('POST', '/login', res.status, 'response carried no token');
    if (!opts.mfaCode) throw new SdpHttpError('POST', '/mfa', res.status, 'the SDP requires an emailed verification code and no prompt is available');
    const code = await opts.mfaCode(email);
    // remember_me is always false: the SDP is never asked to remember this device.
    const mfa = await send(this.fetchImpl, this.base, {
      method: 'POST',
      path: '/mfa',
      headers: this.headers({ 'Content-Type': 'application/json', [DEVICE_ID_HEADER]: this.deviceId }),
      body: JSON.stringify({ mfa_code: code, remember_me: false }),
    });
    const verified = await json<{ token?: string }>(mfa);
    if (!verified.token) throw new SdpHttpError('POST', '/mfa', mfa.status, 'response carried no token');
    return { token: verified.token, codeUsed: true };
  }

  /** POST /forgot-password {email} (forgot_password_handler.go:38-41); always 200. */
  async forgotPassword(email: string): Promise<void> {
    await send(this.fetchImpl, this.base, {
      method: 'POST',
      path: '/forgot-password',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ email }),
    });
  }

  /** POST /reset-password {password, reset_token} (reset_password_handler.go:25-28). */
  async resetPassword(resetToken: string, password: string): Promise<void> {
    await send(this.fetchImpl, this.base, {
      method: 'POST',
      path: '/reset-password',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ password, reset_token: resetToken }),
    });
  }

  /** GET /organization */
  async getOrganization(): Promise<Organization> {
    const res = await this.request({ method: 'GET', path: '/organization', headers: this.headers() });
    return json<Organization>(res);
  }

  /**
   * PATCH /organization. The SDP reads a multipart form whose `data` field
   * carries the JSON patch (profile_handler.go:123,162); owner role only.
   */
  async patchOrganization(fields: Record<string, unknown>): Promise<void> {
    const form = new FormData();
    form.set('data', JSON.stringify(fields));
    const keys = Object.keys(fields);
    const mfaEnable = keys.length === 1 && keys[0] === 'mfa_disabled' && fields.mfa_disabled === false;
    await this.request({ method: 'PATCH', path: '/organization', headers: this.headers(), body: form }, mfaEnable ? 'mfa-enable' : 'other');
  }

  /** GET /wallets with the boolean filters from wallets_handler.go:54-55. */
  async listWallets(filter: { enabled?: boolean; user_managed?: boolean } = {}): Promise<Wallet[]> {
    const q = new URLSearchParams();
    if (filter.enabled !== undefined) q.set('enabled', String(filter.enabled));
    if (filter.user_managed !== undefined) q.set('user_managed', String(filter.user_managed));
    const qs = q.toString();
    const res = await this.request({
      method: 'GET',
      path: `/wallets${qs ? `?${qs}` : ''}`,
      headers: this.headers(),
    });
    return json<Wallet[]>(res);
  }

  /** PATCH /wallets/{id} (validators/wallet_validator.go:48-55). */
  async patchWallet(id: string, patch: { enabled?: boolean }): Promise<Wallet> {
    const res = await this.request({
      method: 'PATCH',
      path: `/wallets/${encodeURIComponent(id)}`,
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(patch),
    });
    return json<Wallet>(res);
  }

  /** GET /assets */
  async listAssets(): Promise<Asset[]> {
    const res = await this.request({ method: 'GET', path: '/assets', headers: this.headers() });
    return json<Asset[]>(res);
  }

  /** GET /distribution-wallets (docs/multi-wallet/api-reference.md, List accounts). */
  async listDistributionWallets(): Promise<DistributionWallet[]> {
    const res = await this.request({
      method: 'GET',
      path: '/distribution-wallets',
      headers: this.headers(),
    });
    return json<DistributionWallet[]>(res);
  }

  /** POST /distribution-wallets {name, description}, 201 (same doc, Create an account). */
  async createDistributionWallet(req: { name: string; description?: string }): Promise<DistributionWallet> {
    const res = await this.request({
      method: 'POST',
      path: '/distribution-wallets',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(req),
      accept: [201],
    });
    return json<DistributionWallet>(res);
  }

  /** POST /disbursements (serve.go:500, disbursement_handler.go:49-56), 201. */
  async createDisbursement(req: CreateDisbursementRequest, walletId?: string): Promise<Disbursement> {
    const res = await this.request({
      method: 'POST',
      path: '/disbursements',
      headers: this.headers({ 'Content-Type': 'application/json', ...this.walletHeader(walletId) }),
      body: JSON.stringify(req),
      accept: [201],
    });
    return json<Disbursement>(res);
  }

  /**
   * POST /disbursements/{id}/instructions: multipart field `file`, a .csv
   * (disbursement_handler.go:490,500).
   */
  async uploadInstructions(id: string, csv: string, filename: string, walletId?: string): Promise<void> {
    if (!filename.endsWith('.csv')) throw new Error('instructions filename must end with .csv');
    const form = new FormData();
    form.set('file', new Blob([csv], { type: 'text/csv' }), filename);
    await this.request({
      method: 'POST',
      path: `/disbursements/${encodeURIComponent(id)}/instructions`,
      headers: this.headers(this.walletHeader(walletId)),
      body: form,
    });
  }

  /** PATCH /disbursements/{id}/status {status} (disbursement_handler.go:96-98). */
  async patchDisbursementStatus(id: string, status: 'STARTED' | 'PAUSED', walletId?: string): Promise<void> {
    await this.request({
      method: 'PATCH',
      path: `/disbursements/${encodeURIComponent(id)}/status`,
      headers: this.headers({ 'Content-Type': 'application/json', ...this.walletHeader(walletId) }),
      body: JSON.stringify({ status }),
    });
  }

  /** GET /disbursements/{id} */
  async getDisbursement(id: string, walletId?: string): Promise<Disbursement> {
    const res = await this.request({
      method: 'GET',
      path: `/disbursements/${encodeURIComponent(id)}`,
      headers: this.headers(this.walletHeader(walletId)),
    });
    return json<Disbursement>(res);
  }

  /** GET /disbursements/{id}/receivers, paginated. */
  async listDisbursementReceivers(id: string, walletId?: string): Promise<Paginated<Record<string, unknown>>> {
    const res = await this.request({
      method: 'GET',
      path: `/disbursements/${encodeURIComponent(id)}/receivers`,
      headers: this.headers(this.walletHeader(walletId)),
    });
    return json<Paginated<Record<string, unknown>>>(res);
  }

  /** GET /receivers?q=..., paginated (validators/query_validator.go:66). */
  async listReceivers(query?: string, walletId?: string): Promise<Paginated<Receiver>> {
    const qs = query ? `?q=${encodeURIComponent(query)}` : '';
    const res = await this.request({
      method: 'GET',
      path: `/receivers${qs}`,
      headers: this.headers(this.walletHeader(walletId)),
    });
    return json<Paginated<Receiver>>(res);
  }

  /**
   * GET /disbursements, optionally filtered by status (route serve.go:470,489;
   * handler disbursement_handler.go:310-354). The `status` query key
   * (data/query_params.go:44) takes a comma separated list, case
   * insensitive (validators/disbursement_query_validator.go:55-69). One
   * page; the tenants this bridge serves hold a handful of disbursements.
   */
  async listDisbursements(filter: { status?: string[] } = {}, walletId?: string): Promise<Paginated<Disbursement>> {
    const query = filter.status?.length ? `?status=${encodeURIComponent(filter.status.join(','))}` : '';
    const res = await this.request({
      method: 'GET',
      path: `/disbursements${query}`,
      headers: this.headers(this.walletHeader(walletId)),
    });
    return json<Paginated<Disbursement>>(res);
  }

  /**
   * GET /payments, one page. `status` takes ONE payment status
   * (payment_query_validator.go:62-70 at 7.0.0, not a list); `page` and
   * `page_limit` from query_validator.go:29-30, page_limit default 20 and at
   * most 100 (query_validator.go:23-24,93-94); `sort` is `created_at` or
   * `updated_at` (internal/data/payments.go:70, AllowedPaymentSorts; the
   * default is updated_at descending, :67) and `direction` is `asc` or
   * `desc` (query_validator.go:40-44); there is no disbursement filter
   * (internal/data/payments.go:69), so callers filter and must page.
   */
  async listPayments(walletId?: string, filter: { status?: string; page?: number; pageLimit?: number; sort?: 'created_at' | 'updated_at'; direction?: 'asc' | 'desc' } = {}): Promise<Paginated<Payment>> {
    const q = new URLSearchParams();
    if (filter.status) q.set('status', filter.status);
    if (filter.page !== undefined) q.set('page', String(filter.page));
    if (filter.pageLimit !== undefined) q.set('page_limit', String(filter.pageLimit));
    if (filter.sort) q.set('sort', filter.sort);
    if (filter.direction) q.set('direction', filter.direction);
    const query = q.toString();
    const res = await this.request({
      method: 'GET',
      path: `/payments${query ? `?${query}` : ''}`,
      headers: this.headers(this.walletHeader(walletId)),
    });
    return json<Paginated<Payment>>(res);
  }
}
