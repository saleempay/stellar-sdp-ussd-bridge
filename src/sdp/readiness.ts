/**
 * Readiness and provisioning of one SDP tenant for the wallet-address
 * route, as a list of small steps. Each step is idempotent: running the
 * whole list twice changes nothing the second time, and the report says so
 * ("already" rather than "done").
 *
 * Tenant resolution: the SDP reads the SDP-Tenant-Name header first, then
 * the hostname prefix (middleware.go:404-416). Setting a default tenant is
 * refused unless SINGLE_TENANT_MODE is on, and in that mode the header is
 * ignored (middleware.go:296-304, tenants_handler.go:319-322), so this
 * repository runs multi-tenant and names the tenant on every request.
 *
 * The steps call the SDP through the typed client and take everything
 * with a side effect outside HTTP (sleeping, creating the login user through
 * the SDP command line inside the container) as injected dependencies, so
 * the offline tests can run the list against a fake SDP.
 *
 * No step ever prints, returns or logs a secret. Step details carry tenant
 * ids, wallet ids and masked account addresses only.
 */
import { SdpAdminClient, SdpHttpError, SdpTenantClient, type Tenant } from './client.js';
import {
  DISTRIBUTION_ACCOUNT_DB_VAULT,
  TESTNET_USDC_ISSUER,
  USDC_CODE,
  USER_MANAGED_WALLET_NAME,
  maskAccount,
} from './facts.js';

export interface TenantSpec {
  /** Tenant name; also the value of the SDP-Tenant-Name header. */
  name: string;
  organizationName: string;
  /** The owner user the SDP creates with the tenant; the bridge logs in as this user. */
  ownerEmail: string;
  /** The password the bridge sets for the owner through the reset-password flow. */
  ownerPassword: string;
}

export interface ReadinessConfig {
  apiUrl: string;
  adminUrl: string;
  /**
   * Dashboard URL for a tenant. The SDP dashboard sends the first label of
   * its own hostname as the tenant name (frontend 7.0.0,
   * src/helpers/getSdpTenantName.ts), so the bridge tenant lives at
   * http://bridge.localhost:3000. Browsers resolve *.localhost to the
   * loopback address without a hosts file entry.
   */
  uiUrlFor: (tenantName: string) => string;
  adminAccount: string;
  adminApiKey: string;
  tenant: TenantSpec;
  /** The USDC issuer the tenant must carry. Defaults to the pinned testnet issuer. */
  usdcIssuer?: string;
  /** How long to wait for the two health endpoints. */
  healthTimeoutMs?: number;
  pollIntervalMs?: number;
}

export interface ReadinessDeps {
  admin: SdpAdminClient;
  tenantClient: (tenantName: string) => SdpTenantClient;
  /**
   * Return the password reset token the SDP issued for this user after
   * `sinceMs`. With EMAIL_SENDER_TYPE=DRY_RUN the SDP prints the reset
   * message, link included, to its standard output
   * (internal/message/dry_run_client.go:17-21), so the reference
   * implementation reads the container log. Throws when none is found.
   */
  readResetToken: (tenant: Tenant, email: string, sinceMs: number) => Promise<string>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

export interface StepResult {
  step: string;
  outcome: 'ok' | 'done' | 'already';
  detail: string;
}

/** One step failed. `results` holds the steps that passed before it. */
export class ReadinessError extends Error {
  constructor(
    readonly step: string,
    readonly results: StepResult[],
    message: string,
    options?: { cause?: unknown },
  ) {
    super(`readiness step "${step}" failed: ${message}`, options);
    this.name = 'ReadinessError';
  }
}

export const DEFAULT_HEALTH_TIMEOUT_MS = 180_000;
export const DEFAULT_POLL_INTERVAL_MS = 3_000;

async function waitFor(
  label: string,
  probe: () => Promise<boolean>,
  deps: ReadinessDeps,
  timeoutMs: number,
  intervalMs: number,
): Promise<number> {
  const started = deps.now();
  for (;;) {
    if (await probe()) return deps.now() - started;
    if (deps.now() - started >= timeoutMs) {
      throw new Error(`${label} did not answer 200 within ${timeoutMs} ms`);
    }
    await deps.sleep(intervalMs);
  }
}

/**
 * Bring one tenant to the state the wallet-address route needs and report
 * every step. Throws {@link ReadinessError} at the first failing step.
 */
export async function provisionTenant(cfg: ReadinessConfig, deps: ReadinessDeps): Promise<StepResult[]> {
  const results: StepResult[] = [];
  const timeout = cfg.healthTimeoutMs ?? DEFAULT_HEALTH_TIMEOUT_MS;
  const interval = cfg.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const usdcIssuer = cfg.usdcIssuer ?? TESTNET_USDC_ISSUER;
  const spec = cfg.tenant;

  const run = async <T>(step: string, fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (cause) {
      if (cause instanceof ReadinessError) throw cause;
      const message = cause instanceof Error ? cause.message : String(cause);
      throw new ReadinessError(step, results, message, { cause });
    }
  };

  // 1 and 2: the two servers answer /health.
  const unauthenticated = deps.tenantClient(spec.name);
  await run('api health', async () => {
    const ms = await waitFor('API /health', () => unauthenticated.health(), deps, timeout, interval);
    results.push({ step: 'api health', outcome: 'ok', detail: `answered 200 after ${ms} ms` });
  });
  await run('admin health', async () => {
    const ms = await waitFor('admin /health', () => deps.admin.health(), deps, timeout, interval);
    results.push({ step: 'admin health', outcome: 'ok', detail: `answered 200 after ${ms} ms` });
  });

  // 3: the tenant exists, with its own distribution account in the DB vault.
  const tenant = await run('tenant exists', async () => {
    const existing = await deps.admin.getTenant(spec.name);
    if (existing) {
      results.push({
        step: 'tenant exists',
        outcome: 'already',
        detail: `tenant ${existing.name} id ${existing.id}, status ${existing.status}, distribution account ${maskAccount(existing.distribution_account_address)} (${existing.distribution_account_type})`,
      });
      return existing;
    }
    const created = await deps.admin.createTenant({
      name: spec.name,
      owner_email: spec.ownerEmail,
      owner_first_name: 'Tenant',
      owner_last_name: 'Owner',
      organization_name: spec.organizationName,
      distribution_account_type: DISTRIBUTION_ACCOUNT_DB_VAULT,
      base_url: cfg.apiUrl,
      sdp_ui_base_url: cfg.uiUrlFor(spec.name),
    });
    results.push({
      step: 'tenant exists',
      outcome: 'done',
      detail: `created tenant ${created.name} id ${created.id}, status ${created.status}, distribution account ${maskAccount(created.distribution_account_address)} (${created.distribution_account_type})`,
    });
    return created;
  });

  // 4 and 5: the owner can log in with the password the bridge holds. The
  // SDP creates the owner user with the tenant and emails an invitation; it
  // has no API to set a password directly, and its CLI prompt needs a
  // terminal. The supported, API-only path is the forgot-password flow:
  // POST /forgot-password (forgot_password_handler.go:38-41), read the
  // token from the dry run message, POST /reset-password
  // (reset_password_handler.go:25-28). Skipped when the login already works.
  const client = await run('owner login', async () => {
    try {
      const token = await unauthenticated.login(spec.ownerEmail, spec.ownerPassword);
      results.push({ step: 'owner login', outcome: 'already', detail: `${spec.ownerEmail} logs in with the held password` });
      return unauthenticated.withToken(token);
    } catch (cause) {
      if (!(cause instanceof SdpHttpError) || cause.status !== 401) throw cause;
    }
    const since = deps.now();
    await unauthenticated.forgotPassword(spec.ownerEmail);
    const resetToken = await deps.readResetToken(tenant, spec.ownerEmail, since);
    await unauthenticated.resetPassword(resetToken, spec.ownerPassword);
    const token = await unauthenticated.login(spec.ownerEmail, spec.ownerPassword);
    results.push({ step: 'owner login', outcome: 'done', detail: `password set for ${spec.ownerEmail} through the reset flow; login verified` });
    return unauthenticated.withToken(token);
  });

  // 6: receiver invitations are off for this organisation.
  await run('invitations disabled', async () => {
    const org = await client.getOrganization();
    if (org.receiver_invitations_disabled === true) {
      results.push({ step: 'invitations disabled', outcome: 'already', detail: 'receiver_invitations_disabled is true' });
      return;
    }
    await client.patchOrganization({ receiver_invitations_disabled: true });
    const after = await client.getOrganization();
    if (after.receiver_invitations_disabled !== true) {
      throw new Error('receiver_invitations_disabled did not read back as true after the patch');
    }
    results.push({ step: 'invitations disabled', outcome: 'done', detail: 'receiver_invitations_disabled set to true' });
  });

  // 7: the user managed wallet (the record wallet-address disbursements
  // reference) exists and is enabled.
  await run('user managed wallet', async () => {
    const wallets = await client.listWallets({ user_managed: true });
    const wallet = wallets.find((w) => w.name === USER_MANAGED_WALLET_NAME) ?? wallets[0];
    if (!wallet) throw new Error('no user managed wallet is seeded for this tenant');
    if (wallet.enabled) {
      results.push({ step: 'user managed wallet', outcome: 'already', detail: `"${wallet.name}" id ${wallet.id} is enabled` });
      return;
    }
    const updated = await client.patchWallet(wallet.id, { enabled: true });
    if (!updated.enabled) throw new Error(`wallet ${wallet.id} did not read back as enabled`);
    results.push({ step: 'user managed wallet', outcome: 'done', detail: `"${wallet.name}" id ${wallet.id} enabled` });
  });

  // 8: USDC with the pinned testnet issuer is a tenant asset.
  await run('usdc asset', async () => {
    const assets = await client.listAssets();
    const usdc = assets.find((a) => a.code === USDC_CODE && a.issuer === usdcIssuer);
    if (!usdc) {
      const seen = assets.map((a) => `${a.code}:${maskAccount(a.issuer)}`).join(', ') || '(none)';
      throw new Error(`USDC with issuer ${maskAccount(usdcIssuer)} not found; tenant assets: ${seen}`);
    }
    results.push({ step: 'usdc asset', outcome: 'ok', detail: `USDC id ${usdc.id}, issuer ${maskAccount(usdc.issuer)}` });
  });

  return results;
}

/** Render a step report as fixed-width text for the terminal and EVIDENCE.md. */
export function formatReport(results: StepResult[]): string {
  const width = Math.max(...results.map((r) => r.step.length), 4);
  return results.map((r) => `${r.step.padEnd(width)}  ${r.outcome.padEnd(7)}  ${r.detail}`).join('\n');
}
