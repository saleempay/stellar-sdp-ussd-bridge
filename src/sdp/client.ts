/**
 * A small typed client for the SDP 7.0.0 HTTP APIs the bridge uses: the
 * admin (multi-tenant) API on the admin port and the per-tenant API on the
 * main port. Every route, field and header named here was read from the
 * SDP source at tag 7.0.0; the file and line are given next to each.
 *
 * The client takes `fetch` as a dependency so the offline tests can drive
 * it with a fake and assert the exact request shape.
 */
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
}

export class SdpTenantClient {
  private readonly fetchImpl: FetchLike;
  private readonly base: string;
  readonly tenantName: string;
  private readonly token: string | undefined;

  constructor(private readonly opts: SdpTenantClientOptions) {
    this.fetchImpl = opts.fetch ?? ((input, init) => fetch(input, init));
    this.base = opts.baseUrl;
    this.tenantName = opts.tenantName;
    this.token = opts.token;
  }

  /** The same client with a Bearer token attached. */
  withToken(token: string): SdpTenantClient {
    return new SdpTenantClient({ ...this.opts, token });
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

  /** POST /login {email, password}; returns the token (login_handler.go:24-32). */
  async login(email: string, password: string): Promise<string> {
    const res = await send(this.fetchImpl, this.base, {
      method: 'POST',
      path: '/login',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ email, password }),
    });
    const body = await json<{ token: string }>(res);
    if (!body.token) throw new SdpHttpError('POST', '/login', res.status, 'response carried no token');
    return body.token;
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
    const res = await send(this.fetchImpl, this.base, { method: 'GET', path: '/organization', headers: this.headers() });
    return json<Organization>(res);
  }

  /**
   * PATCH /organization. The SDP reads a multipart form whose `data` field
   * carries the JSON patch (profile_handler.go:123,162); owner role only.
   */
  async patchOrganization(fields: Record<string, unknown>): Promise<void> {
    const form = new FormData();
    form.set('data', JSON.stringify(fields));
    await send(this.fetchImpl, this.base, { method: 'PATCH', path: '/organization', headers: this.headers(), body: form });
  }

  /** GET /wallets with the boolean filters from wallets_handler.go:54-55. */
  async listWallets(filter: { enabled?: boolean; user_managed?: boolean } = {}): Promise<Wallet[]> {
    const q = new URLSearchParams();
    if (filter.enabled !== undefined) q.set('enabled', String(filter.enabled));
    if (filter.user_managed !== undefined) q.set('user_managed', String(filter.user_managed));
    const qs = q.toString();
    const res = await send(this.fetchImpl, this.base, {
      method: 'GET',
      path: `/wallets${qs ? `?${qs}` : ''}`,
      headers: this.headers(),
    });
    return json<Wallet[]>(res);
  }

  /** PATCH /wallets/{id} (validators/wallet_validator.go:48-55). */
  async patchWallet(id: string, patch: { enabled?: boolean }): Promise<Wallet> {
    const res = await send(this.fetchImpl, this.base, {
      method: 'PATCH',
      path: `/wallets/${encodeURIComponent(id)}`,
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(patch),
    });
    return json<Wallet>(res);
  }

  /** GET /assets */
  async listAssets(): Promise<Asset[]> {
    const res = await send(this.fetchImpl, this.base, { method: 'GET', path: '/assets', headers: this.headers() });
    return json<Asset[]>(res);
  }

  /** GET /distribution-wallets (docs/multi-wallet/api-reference.md, List accounts). */
  async listDistributionWallets(): Promise<DistributionWallet[]> {
    const res = await send(this.fetchImpl, this.base, {
      method: 'GET',
      path: '/distribution-wallets',
      headers: this.headers(),
    });
    return json<DistributionWallet[]>(res);
  }

  /** POST /distribution-wallets {name, description}, 201 (same doc, Create an account). */
  async createDistributionWallet(req: { name: string; description?: string }): Promise<DistributionWallet> {
    const res = await send(this.fetchImpl, this.base, {
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
    const res = await send(this.fetchImpl, this.base, {
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
    await send(this.fetchImpl, this.base, {
      method: 'POST',
      path: `/disbursements/${encodeURIComponent(id)}/instructions`,
      headers: this.headers(this.walletHeader(walletId)),
      body: form,
    });
  }

  /** PATCH /disbursements/{id}/status {status} (disbursement_handler.go:96-98). */
  async patchDisbursementStatus(id: string, status: 'STARTED' | 'PAUSED', walletId?: string): Promise<void> {
    await send(this.fetchImpl, this.base, {
      method: 'PATCH',
      path: `/disbursements/${encodeURIComponent(id)}/status`,
      headers: this.headers({ 'Content-Type': 'application/json', ...this.walletHeader(walletId) }),
      body: JSON.stringify({ status }),
    });
  }

  /** GET /disbursements/{id} */
  async getDisbursement(id: string, walletId?: string): Promise<Disbursement> {
    const res = await send(this.fetchImpl, this.base, {
      method: 'GET',
      path: `/disbursements/${encodeURIComponent(id)}`,
      headers: this.headers(this.walletHeader(walletId)),
    });
    return json<Disbursement>(res);
  }

  /** GET /disbursements/{id}/receivers, paginated. */
  async listDisbursementReceivers(id: string, walletId?: string): Promise<Paginated<Record<string, unknown>>> {
    const res = await send(this.fetchImpl, this.base, {
      method: 'GET',
      path: `/disbursements/${encodeURIComponent(id)}/receivers`,
      headers: this.headers(this.walletHeader(walletId)),
    });
    return json<Paginated<Record<string, unknown>>>(res);
  }

  /** GET /receivers?q=..., paginated (validators/query_validator.go:66). */
  async listReceivers(query?: string, walletId?: string): Promise<Paginated<Receiver>> {
    const qs = query ? `?q=${encodeURIComponent(query)}` : '';
    const res = await send(this.fetchImpl, this.base, {
      method: 'GET',
      path: `/receivers${qs}`,
      headers: this.headers(this.walletHeader(walletId)),
    });
    return json<Paginated<Receiver>>(res);
  }

  /** GET /payments, paginated. */
  async listPayments(walletId?: string): Promise<Paginated<Payment>> {
    const res = await send(this.fetchImpl, this.base, {
      method: 'GET',
      path: '/payments',
      headers: this.headers(this.walletHeader(walletId)),
    });
    return json<Paginated<Payment>>(res);
  }
}
