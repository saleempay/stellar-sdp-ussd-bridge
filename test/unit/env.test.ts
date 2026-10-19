import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { ConfigError, POSTGRES_VOLUME_ENV, composeEnvironment, dashboardUrlFor, postgresVolumeName, readinessConfigFor, resolvePostgresVolume, sdpConfigFromEnv } from '../../src/sdp/env.js';
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

  it('another network refuses an unset sender, naming the variable and the reason', () => {
    const err = refusal({ ...full, ...OTHER });
    expect(err.reasons.join(' ')).toContain('EMAIL_SENDER_TYPE is not set');
    expect(err.reasons.join(' ')).toContain('log');
  });

  it('another network refuses DRY_RUN in any case', () => {
    for (const v of ['DRY_RUN', 'dry_run', ' Dry_Run ']) {
      const err = refusal({ ...full, ...OTHER, EMAIL_SENDER_TYPE: v });
      expect(err.reasons.join(' ')).toContain('EMAIL_SENDER_TYPE is DRY_RUN');
    }
  });

  it('another network with a real sender passes, in strict MFA mode and with the log reset path off', () => {
    const cfg = sdpConfigFromEnv({ ...full, ...OTHER, EMAIL_SENDER_TYPE: 'AWS_EMAIL', RPC_URL: 'https://rpc.example.test' });
    expect(cfg.strictMfa).toBe(true);
    expect(cfg.resetThroughLog).toBe(false);
    expect(readinessConfigFor(cfg, cfg.tenants[0]!).resetThroughLog).toBe(false);
  });
});

describe('sdpConfigFromEnv: RPC_URL is a network value too (fix round of 18 October)', () => {
  const other = { ...full, ...OTHER, EMAIL_SENDER_TYPE: 'AWS_EMAIL' };

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

  it('keeps PATH, every file value and the computed volume name, and drops everything the shell exported', () => {
    const env = composeEnvironment(file, shell);
    expect(env.PATH).toBe('/usr/bin');
    expect(env.EMAIL_SENDER_TYPE).toBe('DRY_RUN');
    expect(env.NETWORK_TYPE).toBe('testnet');
    expect(env.ADMIN_API_KEY).toBe('k');
    expect(env[POSTGRES_VOLUME_ENV]).toBe('proj_postgres-db-testnet');
    for (const k of ['HOME', 'NETWORK_PASSPHRASE', 'HORIZON_URL', 'DOCKER_HOST']) expect(k in env).toBe(false);
    expect(Object.keys(env).sort()).toEqual(['ADMIN_API_KEY', 'COMPOSE_PROJECT_NAME', 'EMAIL_SENDER_TYPE', 'NETWORK_TYPE', 'PATH', POSTGRES_VOLUME_ENV].sort());
  });

  it('refuses a written volume name that disagrees with the computed one, before any command runs', () => {
    expect(() => composeEnvironment({ ...file, [POSTGRES_VOLUME_ENV]: 'proj_postgres-db-TestNet' }, shell)).toThrow(/SDP_POSTGRES_VOLUME in sdp\/.env does not equal/);
  });
});
