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
import { spawn, spawnSync } from 'node:child_process';
import {
  ConfigError,
  ReadinessError,
  ResetTokenScanner,
  SdpAdminClient,
  SdpTenantClient,
  dashboardUrlFor,
  formatReport,
  loadEnvFile,
  promptMfaCode,
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
 * (internal/message/dry_run_client.go:17-21 at 7.0.0). The matching rules
 * (exact recipient line, the tenant's own UI base URL on the link) live in
 * src/sdp/resetToken.ts with their unit test; this function only streams
 * the log through them, so a log of any length is read without a bounded
 * buffer. The token is read once and used once; it is never printed or
 * stored. While a reset link is live the log is as sensitive as sdp/.env.
 */
function scanLog(args, match) {
  return new Promise((resolve, reject) => {
    const scanner = new ResetTokenScanner(match);
    const child = spawn('docker', [...COMPOSE, 'logs', '--no-color', '--no-log-prefix', ...args, 'sdp-api'], { stdio: ['ignore', 'pipe', 'ignore'] });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => scanner.push(chunk));
    child.on('error', reject);
    child.on('close', () => resolve(scanner.result()));
  });
}

async function readResetToken(tenant, email, sinceMs) {
  const match = { email, ...(tenant.sdp_ui_base_url ? { uiBaseUrl: tenant.sdp_ui_base_url } : {}) };
  const since = new Date(sinceMs - 2000).toISOString();
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const token = await scanLog(['--since', since], match);
    if (token) return token;
    await new Promise((res) => setTimeout(res, 1000));
  }
  // The SDP does not re-send while an earlier token is still valid
  // (forgot_password_handler.go:124-125), so the newest message in the
  // whole log is the one that applies.
  const token = await scanLog([], match);
  if (token) return token;
  throw new Error(`no password reset message for ${email} found in the sdp-api log`);
}

const deps = {
  admin,
  tenantClient,
  readResetToken,
  // With MFA enabled on the stack the SDP emails a code at login; the
  // operator types it here. Nothing happens with MFA disabled.
  mfaCode: promptMfaCode(),
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
