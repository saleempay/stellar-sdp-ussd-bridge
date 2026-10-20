import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { ConfigError, DOCKER_CLIENT_ENV, POSTGRES_VOLUME_ENV, composeEnvironment, dashboardUrlFor, dockerClientEnvironment, postgresVolumeName, readinessConfigFor, resolvePostgresVolume, sdpConfigFromEnv, tenantAccountTypeFrom } from '../../src/sdp/env.js';
import { TESTNET_RPC_URL } from '../../src/sdp/facts.js';
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

  it('another network refuses an unset sender, naming the variable and the reason, alongside the other two settings', () => {
    const err = refusal({ ...full, ...OTHER });
    expect(err.reasons.join(' ')).toContain('EMAIL_SENDER_TYPE is not set');
    expect(err.reasons.join(' ')).toContain('log');
    expect(err.reasons).toHaveLength(3);
  });

  it('another network refuses DRY_RUN in any case', () => {
    for (const v of ['DRY_RUN', 'dry_run', ' Dry_Run ']) {
      const err = refusal({ ...full, ...OTHER, EMAIL_SENDER_TYPE: v });
      expect(err.reasons.join(' ')).toContain('EMAIL_SENDER_TYPE is DRY_RUN');
    }
  });

  it('another network with a real sender passes, in strict MFA mode and with the log reset path off', () => {
    const cfg = sdpConfigFromEnv({ ...full, ...OTHER, EMAIL_SENDER_TYPE: 'AWS_EMAIL', RPC_URL: 'https://rpc.example.test', ENVIRONMENT: 'production', CORS_ALLOWED_ORIGINS: 'https://sdp.example.test' });
    expect(cfg.strictMfa).toBe(true);
    expect(cfg.resetThroughLog).toBe(false);
    expect(readinessConfigFor(cfg, cfg.tenants[0]!).resetThroughLog).toBe(false);
  });
});

describe('sdpConfigFromEnv: RPC_URL is a network value too (fix round of 18 October)', () => {
  const other = { ...full, ...OTHER, EMAIL_SENDER_TYPE: 'AWS_EMAIL', ENVIRONMENT: 'production', CORS_ALLOWED_ORIGINS: 'https://sdp.example.test' };

  it('testnet: unset takes the testnet RPC, the testnet value passes, anything else is refused', () => {
    expect(sdpConfigFromEnv(full).rpcUrl).toBe(TESTNET_RPC_URL);
    expect(sdpConfigFromEnv({ ...full, RPC_URL: TESTNET_RPC_URL }).rpcUrl).toBe(TESTNET_RPC_URL);
    expect(refusal({ ...full, RPC_URL: 'https://rpc.example.test' }).reasons).toEqual(['RPC_URL does not equal the testnet value']);
  });

  it('another network: unset is refused (the compose default would be the testnet RPC), the testnet RPC is refused, another value passes', () => {
    expect(refusal(other).reasons.join(' ')).toContain('RPC_URL is not set');
    expect(refusal({ ...other, RPC_URL: TESTNET_RPC_URL }).reasons.join(' ')).toContain('RPC_URL equals the testnet value');
    expect(sdpConfigFromEnv({ ...other, RPC_URL: 'https://rpc.example.test' }).rpcUrl).toBe('https://rpc.example.test');
  });
});

describe('the Postgres volume name is computed in one place, lower-cased (fix rounds of 18 and 19 October)', () => {
  it('both spellings of the network type give the same name, with the defaults and with values set', () => {
    expect(postgresVolumeName(undefined, undefined)).toBe('sdp-bridge_postgres-db-testnet');
    expect(postgresVolumeName('', '')).toBe('sdp-bridge_postgres-db-testnet');
    expect(postgresVolumeName('proj', 'OtherNet')).toBe('proj_postgres-db-othernet');
    expect(postgresVolumeName('proj', 'othernet')).toBe(postgresVolumeName('proj', ' OtherNet '));
    expect(postgresVolumeName('proj', 'Public')).toBe(postgresVolumeName('proj', 'public'));
  });

  it('resolvePostgresVolume returns the computed name, accepts a written copy that matches, and refuses one that differs in any way, case included', () => {
    expect(resolvePostgresVolume({ COMPOSE_PROJECT_NAME: 'proj', NETWORK_TYPE: 'TestNet' })).toBe('proj_postgres-db-testnet');
    expect(resolvePostgresVolume({ NETWORK_TYPE: 'testnet', [POSTGRES_VOLUME_ENV]: 'sdp-bridge_postgres-db-testnet' })).toBe('sdp-bridge_postgres-db-testnet');
    for (const written of ['sdp-bridge_postgres-db-TestNet', 'other_postgres-db-testnet', 'sdp-bridge_postgres-db-public']) {
      const err = (() => { try { resolvePostgresVolume({ NETWORK_TYPE: 'TestNet', [POSTGRES_VOLUME_ENV]: written }); } catch (e) { return e as Error; } return undefined; })();
      expect(err?.message).toContain(`${POSTGRES_VOLUME_ENV} in sdp/.env does not equal the name computed`);
    }
  });

  it('the compose file reads the name from that variable and never builds it from NETWORK_TYPE', () => {
    const compose = readFileSync('sdp/docker-compose.yml', 'utf8');
    const nameLine = compose.split('\n').find((l) => /^\s+name:\s*\$\{/.test(l)) ?? '';
    expect(nameLine).toContain(`\${${POSTGRES_VOLUME_ENV}:?`);
    expect(nameLine).not.toContain('NETWORK_TYPE');
    expect(nameLine).not.toContain('postgres-db-');
    expect(readFileSync('sdp/.env.example', 'utf8')).toContain(`${POSTGRES_VOLUME_ENV}=`);
  });
});

describe('composeEnvironment: compose runs with PATH, the asserted file and the volume name, nothing from the shell (fix round 3, 19 October)', () => {
  const file = { COMPOSE_PROJECT_NAME: 'proj', NETWORK_TYPE: 'testnet', EMAIL_SENDER_TYPE: 'DRY_RUN', ADMIN_API_KEY: 'k' };
  const shell = { PATH: '/usr/bin', HOME: '/Users/x', EMAIL_SENDER_TYPE: 'AWS_EMAIL', NETWORK_PASSPHRASE: 'Other Network ; Example Only', HORIZON_URL: 'https://horizon.example.test', NETWORK_TYPE: 'othernet', DOCKER_HOST: 'unix:///x' };

  it('keeps PATH, the Docker client variables, every file value and the computed volume name, and drops every SDP value the shell exported', () => {
    const env = composeEnvironment(file, shell);
    expect(env.PATH).toBe('/usr/bin');
    expect(env.HOME).toBe('/Users/x');
    expect(env.DOCKER_HOST).toBe('unix:///x');
    expect(env.EMAIL_SENDER_TYPE).toBe('DRY_RUN');
    expect(env.NETWORK_TYPE).toBe('testnet');
    expect(env.ADMIN_API_KEY).toBe('k');
    expect(env[POSTGRES_VOLUME_ENV]).toBe('proj_postgres-db-testnet');
    for (const k of ['NETWORK_PASSPHRASE', 'HORIZON_URL']) expect(k in env).toBe(false);
    expect(Object.keys(env).sort()).toEqual(['ADMIN_API_KEY', 'COMPOSE_PROJECT_NAME', 'DOCKER_HOST', 'EMAIL_SENDER_TYPE', 'HOME', 'NETWORK_TYPE', 'PATH', POSTGRES_VOLUME_ENV].sort());
  });

  it('keeps each of the Docker client variables only when the shell sets it, so the selected engine stays the engine the scripts talk to (review of 19 October)', () => {
    const all: Record<string, string> = { PATH: '/usr/bin' };
    for (const k of DOCKER_CLIENT_ENV) all[k] = `value-of-${k}`;
    const kept = dockerClientEnvironment({ ...all, NETWORK_TYPE: 'othernet', EMAIL_SENDER_TYPE: 'DRY_RUN', RANDOM_SHELL_VAR: 'x' });
    expect(Object.keys(kept).sort()).toEqual(['PATH', ...DOCKER_CLIENT_ENV].sort());
    for (const k of DOCKER_CLIENT_ENV) expect(kept[k]).toBe(`value-of-${k}`);
    expect(dockerClientEnvironment({ PATH: '/usr/bin', DOCKER_HOST: '' })).toEqual({ PATH: '/usr/bin' });
    expect(DOCKER_CLIENT_ENV).toEqual(['DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_CONFIG', 'DOCKER_CERT_PATH', 'DOCKER_TLS_VERIFY', 'HOME', 'XDG_RUNTIME_DIR']);
    // the file still wins over the shell for any SDP key, and the shell's SDP keys never pass through
    const env = composeEnvironment({ NETWORK_TYPE: 'testnet' }, { ...all, NETWORK_TYPE: 'othernet' });
    expect(env.NETWORK_TYPE).toBe('testnet');
    expect(env.DOCKER_CONTEXT).toBe('value-of-DOCKER_CONTEXT');
  });

  it('refuses a written volume name that disagrees with the computed one, before any command runs', () => {
    expect(() => composeEnvironment({ ...file, [POSTGRES_VOLUME_ENV]: 'proj_postgres-db-TestNet' }, shell)).toThrow(/SDP_POSTGRES_VOLUME in sdp\/.env does not equal/);
  });
});

describe('sdpConfigFromEnv: ENVIRONMENT and CORS_ALLOWED_ORIGINS off testnet (fix round 3, 19 October)', () => {
  const base = { ...full, ...OTHER, EMAIL_SENDER_TYPE: 'AWS_EMAIL', RPC_URL: 'https://rpc.example.test' };

  it('testnet keeps the compose defaults: localhost and * pass, unset passes', () => {
    expect(() => sdpConfigFromEnv({ ...full, ENVIRONMENT: 'localhost', CORS_ALLOWED_ORIGINS: '*' })).not.toThrow();
    expect(() => sdpConfigFromEnv(full)).not.toThrow();
  });

  it('another network refuses ENVIRONMENT unset or localhost, in any case', () => {
    const good = { CORS_ALLOWED_ORIGINS: 'https://sdp.example.test' };
    expect(refusal({ ...base, ...good }).reasons).toEqual([expect.stringContaining('ENVIRONMENT is not set')]);
    for (const v of ['localhost', 'LocalHost', ' localhost ']) expect(refusal({ ...base, ...good, ENVIRONMENT: v }).reasons).toEqual([expect.stringContaining('ENVIRONMENT is localhost, which is refused')]);
    expect(() => sdpConfigFromEnv({ ...base, ...good, ENVIRONMENT: 'production' })).not.toThrow();
  });

  it('another network refuses CORS_ALLOWED_ORIGINS unset or any list that contains *', () => {
    const good = { ENVIRONMENT: 'production' };
    expect(refusal({ ...base, ...good }).reasons).toEqual([expect.stringContaining('CORS_ALLOWED_ORIGINS is not set')]);
    for (const v of ['*', ' * ', 'https://a.example.test, *']) expect(refusal({ ...base, ...good, CORS_ALLOWED_ORIGINS: v }).reasons).toEqual([expect.stringContaining('CORS_ALLOWED_ORIGINS allows every origin (*)')]);
    expect(() => sdpConfigFromEnv({ ...base, ...good, CORS_ALLOWED_ORIGINS: 'https://a.example.test,https://b.example.test' })).not.toThrow();
  });

  it('every refused setting is named at once', () => {
    const err = refusal({ ...base, EMAIL_SENDER_TYPE: 'DRY_RUN', ENVIRONMENT: 'localhost', CORS_ALLOWED_ORIGINS: '*' });
    expect(err.reasons).toHaveLength(3);
    expect(err.reasons.map((r) => r.split(' ')[0])).toEqual(['EMAIL_SENDER_TYPE', 'ENVIRONMENT', 'CORS_ALLOWED_ORIGINS']);
  });
});

describe('SDP_TENANT_ACCOUNT_TYPE', () => {
  it('unset or blank is the DB vault; short and full names, any case, map to the SDP names', () => {
    expect(tenantAccountTypeFrom({})).toBe('DISTRIBUTION_ACCOUNT.STELLAR.DB_VAULT');
    expect(tenantAccountTypeFrom({ SDP_TENANT_ACCOUNT_TYPE: '  ' })).toBe('DISTRIBUTION_ACCOUNT.STELLAR.DB_VAULT');
    expect(tenantAccountTypeFrom({ SDP_TENANT_ACCOUNT_TYPE: 'db_vault' })).toBe('DISTRIBUTION_ACCOUNT.STELLAR.DB_VAULT');
    expect(tenantAccountTypeFrom({ SDP_TENANT_ACCOUNT_TYPE: 'ENV' })).toBe('DISTRIBUTION_ACCOUNT.STELLAR.ENV');
    expect(tenantAccountTypeFrom({ SDP_TENANT_ACCOUNT_TYPE: ' env ' })).toBe('DISTRIBUTION_ACCOUNT.STELLAR.ENV');
    expect(tenantAccountTypeFrom({ SDP_TENANT_ACCOUNT_TYPE: 'DISTRIBUTION_ACCOUNT.STELLAR.ENV' })).toBe('DISTRIBUTION_ACCOUNT.STELLAR.ENV');
  });

  it('any other value is refused naming the variable and the accepted names', () => {
    expect(() => tenantAccountTypeFrom({ SDP_TENANT_ACCOUNT_TYPE: 'CIRCLE' })).toThrow(ConfigError);
    expect(() => tenantAccountTypeFrom({ SDP_TENANT_ACCOUNT_TYPE: 'CIRCLE' })).toThrow(/SDP_TENANT_ACCOUNT_TYPE must be DB_VAULT or ENV/);
  });

  it('is read into the config and threaded into the readiness config of every tenant', () => {
    const cfg = sdpConfigFromEnv({ ...full, SDP_TENANT_ACCOUNT_TYPE: 'ENV' });
    expect(cfg.tenantAccountType).toBe('DISTRIBUTION_ACCOUNT.STELLAR.ENV');
    for (const t of cfg.tenants) expect(readinessConfigFor(cfg, t).tenantAccountType).toBe('DISTRIBUTION_ACCOUNT.STELLAR.ENV');
    expect(sdpConfigFromEnv(full).tenantAccountType).toBe('DISTRIBUTION_ACCOUNT.STELLAR.DB_VAULT');
  });
});
