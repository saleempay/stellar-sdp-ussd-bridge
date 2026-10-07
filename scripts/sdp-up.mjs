#!/usr/bin/env node
/**
 * One command from a clean clone with sdp/.env present: start the SDP
 * 7.0.0 stack with Docker Compose, wait for it, and provision the bridge
 * tenant and the scope test tenant for the wallet-address route. Exits
 * non-zero on the first failing step and names it.
 *
 *   npm run sdp:up                 start and provision
 *   npm run sdp:check              provision and verify only (no compose up)
 *
 * Prints step reports with ids and masked addresses. Never prints a secret.
 */
import { spawnSync } from 'node:child_process';
import {
  ConfigError,
  ReadinessError,
  SdpAdminClient,
  SdpTenantClient,
  dashboardUrlFor,
  formatReport,
  loadEnvFile,
  provisionTenant,
  readinessConfigFor,
  sdpConfigFromEnv,
} from '../dist/index.js';

const ENV_PATH = 'sdp/.env';
const COMPOSE = ['compose', '--env-file', ENV_PATH, '-f', 'sdp/docker-compose.yml'];
const checkOnly = process.argv.includes('--check-only');

function fail(message, code = 1) {
  console.error(`sdp:up failed: ${message}`);
  process.exit(code);
}

let cfg;
try {
  cfg = sdpConfigFromEnv(loadEnvFile(ENV_PATH));
} catch (e) {
  fail(e instanceof ConfigError ? e.message : String(e), 2);
}

if (!checkOnly) {
  console.log('docker compose up -d ...');
  const up = spawnSync('docker', [...COMPOSE, 'up', '-d'], { stdio: 'inherit' });
  if (up.status !== 0) fail(`docker compose up exited with ${up.status ?? 'signal'}`);
}

const admin = new SdpAdminClient({ baseUrl: cfg.adminUrl, adminAccount: cfg.adminAccount, adminApiKey: cfg.adminApiKey });
const tenantClient = (name) => new SdpTenantClient({ baseUrl: cfg.apiUrl, tenantName: name });

/**
 * Read the password reset token from the SDP API container log. With
 * EMAIL_SENDER_TYPE=DRY_RUN the SDP prints every message it would send,
 * including the reset link, to standard output
 * (internal/message/dry_run_client.go:17-21 at 7.0.0). The token is read
 * once and used once; it is never printed or stored.
 */
async function readResetToken(_tenant, email, sinceMs) {
  const since = new Date(sinceMs - 2000).toISOString();
  const find = (log) => {
    // The dry run block is "Recipient: <email>" followed by the HTML body
    // carrying reset-password?token=<token>. Take the newest block for this
    // recipient.
    const blocks = log.split('Recipient: ').slice(1).filter((b) => b.startsWith(email));
    const last = blocks.at(-1);
    const m = last && /reset-password\?token=([A-Za-z0-9._~-]+)/.exec(last);
    return m ? m[1] : undefined;
  };
  const read = (args) => `${spawnSync('docker', [...COMPOSE, 'logs', '--no-color', '--no-log-prefix', ...args, 'sdp-api'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).stdout ?? ''}`;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const token = find(read(['--since', since]));
    if (token) return token;
    await new Promise((res) => setTimeout(res, 1000));
  }
  // The SDP does not re-send while an earlier token is still valid
  // (forgot_password_handler.go:124-125), so the newest message in the
  // whole log is the one that applies.
  const token = find(read([]));
  if (token) return token;
  throw new Error(`no password reset message for ${email} found in the sdp-api log`);
}

const deps = {
  admin,
  tenantClient,
  readResetToken,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  now: () => Date.now(),
};

let exitCode = 0;
for (const tenant of cfg.tenants) {
  console.log(`\n== tenant ${tenant.name}`);
  try {
    const results = await provisionTenant(readinessConfigFor(cfg, tenant), deps);
    console.log(formatReport(results));
  } catch (e) {
    if (e instanceof ReadinessError) {
      if (e.results.length) console.log(formatReport(e.results));
      console.error(`\nFAILED at step "${e.step}": ${e.message}`);
    } else {
      console.error(`\nFAILED: ${e instanceof Error ? e.message : String(e)}`);
    }
    exitCode = 1;
    break;
  }
}

if (exitCode === 0) {
  const first = cfg.tenants[0];
  console.log(`\nSDP ${checkOnly ? 'verified' : 'up and provisioned'}. Dashboard for tenant ${first.name}: ${dashboardUrlFor(cfg.uiOrigin, first.name)} (log in as ${first.ownerEmail}; the password is in ${ENV_PATH}).`);
}
process.exit(exitCode);
