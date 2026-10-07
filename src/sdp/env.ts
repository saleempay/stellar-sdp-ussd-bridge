/**
 * Loading `sdp/.env` into typed configuration. Values are validated for
 * presence only; nothing is echoed. Error messages name the missing keys,
 * never any value.
 */
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import type { ReadinessConfig, TenantSpec } from './readiness.js';

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export type EnvMap = Record<string, string>;

export function loadEnvFile(path: string): EnvMap {
  let content: string;
  try {
    content = readFileSync(path, 'utf8');
  } catch {
    throw new ConfigError(`${path} not found. Run \`npm run sdp:accounts\` first.`);
  }
  return parseEnv(content) as EnvMap;
}

function required(env: EnvMap, keys: string[]): void {
  const missing = keys.filter((k) => !env[k] || env[k]!.trim() === '');
  if (missing.length) throw new ConfigError(`missing or empty in sdp/.env: ${missing.join(', ')}`);
}

export interface SdpEnvConfig {
  apiUrl: string;
  adminUrl: string;
  /** Dashboard origin without a tenant label, e.g. http://localhost:3000. */
  uiOrigin: string;
  adminAccount: string;
  adminApiKey: string;
  tenants: TenantSpec[];
}

/**
 * The bridge tenant and the scope test tenant, from the names in
 * sdp/.env.example. The second tenant exists only for the receiver scoping
 * evidence.
 */
export function sdpConfigFromEnv(env: EnvMap): SdpEnvConfig {
  required(env, [
    'ADMIN_ACCOUNT',
    'ADMIN_API_KEY',
    'BRIDGE_TENANT_NAME',
    'BRIDGE_OWNER_EMAIL',
    'BRIDGE_OWNER_PASSWORD',
    'SCOPETEST_TENANT_NAME',
    'SCOPETEST_OWNER_EMAIL',
    'SCOPETEST_OWNER_PASSWORD',
  ]);
  const port = env.PORT ?? '8000';
  const adminPort = env.ADMIN_PORT ?? '8003';
  return {
    apiUrl: env.SDP_API_URL ?? `http://localhost:${port}`,
    adminUrl: env.SDP_ADMIN_URL ?? `http://localhost:${adminPort}`,
    uiOrigin: env.SDP_UI_BASE_URL ?? 'http://localhost:3000',
    adminAccount: env.ADMIN_ACCOUNT!,
    adminApiKey: env.ADMIN_API_KEY!,
    tenants: [
      {
        name: env.BRIDGE_TENANT_NAME!,
        organizationName: env.BRIDGE_ORGANIZATION_NAME ?? 'Bridge testnet tenant',
        ownerEmail: env.BRIDGE_OWNER_EMAIL!,
        ownerPassword: env.BRIDGE_OWNER_PASSWORD!,
      },
      {
        name: env.SCOPETEST_TENANT_NAME!,
        organizationName: env.SCOPETEST_ORGANIZATION_NAME ?? 'Scope test tenant',
        ownerEmail: env.SCOPETEST_OWNER_EMAIL!,
        ownerPassword: env.SCOPETEST_OWNER_PASSWORD!,
      },
    ],
  };
}

/** http://<tenant>.localhost:3000 for a localhost origin; the origin itself otherwise. */
export function dashboardUrlFor(uiOrigin: string, tenantName: string): string {
  const u = new URL(uiOrigin);
  if (u.hostname === 'localhost') u.hostname = `${tenantName}.localhost`;
  return u.toString().replace(/\/$/, '');
}

export function readinessConfigFor(cfg: SdpEnvConfig, tenant: TenantSpec): ReadinessConfig {
  return {
    apiUrl: cfg.apiUrl,
    adminUrl: cfg.adminUrl,
    uiUrlFor: (name) => dashboardUrlFor(cfg.uiOrigin, name),
    adminAccount: cfg.adminAccount,
    adminApiKey: cfg.adminApiKey,
    tenant,
  };
}
