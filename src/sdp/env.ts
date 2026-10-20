/**
 * Loading `sdp/.env` into typed configuration. Values are validated for
 * presence only; nothing is echoed. Error messages name the missing keys,
 * never any value.
 */
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import type { ReadinessConfig, TenantSpec } from './readiness.js';
import { NetworkConfigError, TESTNET_NETWORK_TYPE, assertNetwork, type NetworkFacts } from './network.js';
import { TESTNET_RPC_URL } from './facts.js';

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
  /** The network the stack runs on, after the boot assertion. */
  network: NetworkFacts;
  /** Strict MFA handling for the tenant client: on for any network other than testnet. */
  strictMfa: boolean;
  /**
   * The owner password may be set through the password reset link read from
   * the sdp-api log (EMAIL_SENDER_TYPE=DRY_RUN prints it there). Testnet only:
   * on any other network the reset link and the MFA code would both come
   * from the same log, so the readiness step refuses that path.
   */
  resetThroughLog: boolean;
  /** Soroban RPC the SDP is pointed at (RPC_URL), after the network check. */
  rpcUrl: string;
}

/**
 * RPC_URL is an SDP network value too (sdp/docker-compose.yml passes it to
 * both SDP services with the testnet RPC as the compose default). Testnet:
 * when set it must equal the testnet RPC. Any other network: it must be set
 * and must not be the testnet RPC, so a forgotten value cannot fall back to
 * the testnet default (fix round of 18 October 2026).
 */
export function assertRpcForNetwork(env: EnvMap, network: NetworkFacts): string {
  const rpc = (env.RPC_URL ?? '').trim();
  if (network.networkType === TESTNET_NETWORK_TYPE) {
    if (rpc !== '' && rpc !== TESTNET_RPC_URL) throw new NetworkConfigError(['RPC_URL does not equal the testnet value']);
    return TESTNET_RPC_URL;
  }
  if (rpc === '') throw new NetworkConfigError([`RPC_URL is not set (required for network type "${network.networkType}"; the compose default is the testnet RPC)`]);
  if (rpc === TESTNET_RPC_URL) throw new NetworkConfigError([`RPC_URL equals the testnet value, which cannot belong to network type "${network.networkType}"`]);
  return rpc;
}

/**
 * The Compose volume that holds the SDP database, as sdp/docker-compose.yml
 * names it: <project>_postgres-db-<network type>. The network type is part
 * of the name so that switching sdp/.env to another network can never bring
 * the stack up on the testnet database (fix round of 18 October 2026).
 */
export function postgresVolumeName(project: string | undefined, networkType: string | undefined): string {
  const p = (project ?? '').trim() || 'sdp-bridge';
  const n = (networkType ?? '').trim().toLowerCase() || TESTNET_NETWORK_TYPE;
  return `${p}_postgres-db-${n}`;
}

/** The variable the compose file reads the volume name from; written to sdp/.env by sdp:accounts, checked by every script. */
export const POSTGRES_VOLUME_ENV = 'SDP_POSTGRES_VOLUME';

/**
 * The one place the volume name is decided (fix round 3, 19 October 2026).
 * Compose cannot lower-case, so it no longer interpolates NETWORK_TYPE into
 * the name: it reads SDP_POSTGRES_VOLUME, which sdp:accounts writes from
 * postgresVolumeName and which this function recomputes and checks before
 * any compose or docker command, so the name the stack uses, the name the
 * --force guard inspects and the name in the file are always the same
 * string, whatever the spelling of NETWORK_TYPE.
 */
export function resolvePostgresVolume(env: EnvMap): string {
  const computed = postgresVolumeName(env.COMPOSE_PROJECT_NAME, env.NETWORK_TYPE);
  const written = (env[POSTGRES_VOLUME_ENV] ?? '').trim();
  if (written && written !== computed) {
    throw new NetworkConfigError([`${POSTGRES_VOLUME_ENV} in sdp/.env does not equal the name computed from COMPOSE_PROJECT_NAME and NETWORK_TYPE; re-run sdp:accounts or correct the file`]);
  }
  return computed;
}

/**
 * The variables that tell the docker CLI which engine to talk to and where
 * its configuration lives. They are not SDP configuration, so the shell
 * keeps them (review of 19 October, verification of fix round 3): without
 * them a machine that selects its engine through DOCKER_HOST or
 * DOCKER_CONTEXT would have the scripts talk to the default daemon, and the
 * --force guard would inspect the wrong engine's volumes.
 */
export const DOCKER_CLIENT_ENV = Object.freeze(['DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_CONFIG', 'DOCKER_CERT_PATH', 'DOCKER_TLS_VERIFY', 'HOME', 'XDG_RUNTIME_DIR']);

/** PATH plus the Docker client's own variables, when set in the shell; nothing else. */
export function dockerClientEnvironment(base: Record<string, string | undefined> = process.env): Record<string, string> {
  const out: Record<string, string> = { PATH: base.PATH ?? '' };
  for (const k of DOCKER_CLIENT_ENV) if (base[k] !== undefined && base[k] !== '') out[k] = base[k] as string;
  return out;
}

/**
 * The environment every compose and docker command runs with: PATH and the
 * Docker client's own variables from the shell, then the asserted sdp/.env,
 * then the computed volume name; no SDP value is inherited from the shell
 * (fix round 3, 19 October 2026). Compose gives shell variables precedence
 * over --env-file, so an exported EMAIL_SENDER_TYPE, NETWORK_PASSPHRASE,
 * HORIZON_URL, RPC_URL or NETWORK_TYPE would otherwise reach the containers
 * while the assertion had approved the file. Building the SDP part of the
 * child environment from the file alone makes the checked values and the
 * running values the same by construction, and keeping the client's own
 * variables keeps the engine the operator selected.
 */
export function composeEnvironment(fileEnv: EnvMap, base: Record<string, string | undefined> = process.env): Record<string, string> {
  const out = dockerClientEnvironment(base);
  for (const [k, v] of Object.entries(fileEnv)) if (v !== undefined) out[k] = v;
  out[POSTGRES_VOLUME_ENV] = resolvePostgresVolume(fileEnv);
  return out;
}

/** The dry run sender writes every message to the container log (internal/message/dry_run_client.go:17-21 at 7.0.0). */
export const DRY_RUN_SENDER = 'DRY_RUN';

/**
 * Off testnet three stack settings may not keep their testnet defaults, and
 * each must be set so a forgotten value cannot fall back to the compose
 * default: EMAIL_SENDER_TYPE may not be DRY_RUN (the MFA code the strict
 * client requires would land in the same log the password reset path
 * reads); ENVIRONMENT may not be localhost; CORS_ALLOWED_ORIGINS may not be
 * * (fix round 3, 19 October 2026). Every refusal is collected, so the
 * message names each variable at once; values are not echoed beyond the
 * refused literal.
 */
export function assertStackSettingsForNetwork(env: EnvMap, network: NetworkFacts): void {
  if (network.networkType === TESTNET_NETWORK_TYPE) return;
  const t = network.networkType;
  const reasons: string[] = [];
  const sender = (env.EMAIL_SENDER_TYPE ?? '').trim();
  if (sender === '') reasons.push(`EMAIL_SENDER_TYPE is not set (required for network type "${t}"; DRY_RUN, the compose default, writes MFA codes and reset links to the container log)`);
  else if (sender.toUpperCase() === DRY_RUN_SENDER) reasons.push(`EMAIL_SENDER_TYPE is ${DRY_RUN_SENDER}, which is refused for network type "${t}": the dry run sender writes MFA codes and password reset links to the sdp-api log`);
  const environment = (env.ENVIRONMENT ?? '').trim();
  if (environment === '') reasons.push(`ENVIRONMENT is not set (required for network type "${t}"; localhost, the compose default, is a development setting)`);
  else if (environment.toLowerCase() === 'localhost') reasons.push(`ENVIRONMENT is localhost, which is refused for network type "${t}"`);
  const cors = (env.CORS_ALLOWED_ORIGINS ?? '').trim();
  if (cors === '') reasons.push(`CORS_ALLOWED_ORIGINS is not set (required for network type "${t}"; *, the compose default, allows every origin)`);
  else if (cors.split(',').map((o) => o.trim()).includes('*')) reasons.push(`CORS_ALLOWED_ORIGINS allows every origin (*), which is refused for network type "${t}"`);
  if (reasons.length) throw new NetworkConfigError(reasons);
}

/** Kept for callers of the earlier name; the sender check is now part of assertStackSettingsForNetwork. */
export const assertSenderForNetwork = assertStackSettingsForNetwork;

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
  const network = assertNetwork(env);
  assertStackSettingsForNetwork(env, network);
  const rpcUrl = assertRpcForNetwork(env, network);
  const testnet = network.networkType === TESTNET_NETWORK_TYPE;
  return {
    network,
    rpcUrl,
    strictMfa: !testnet,
    resetThroughLog: testnet,
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
    usdcIssuer: cfg.network.assetIssuer,
    networkType: cfg.network.networkType,
    resetThroughLog: cfg.resetThroughLog,
  };
}
