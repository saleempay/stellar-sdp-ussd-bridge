#!/usr/bin/env node
/**
 * TESTNET ONLY. Create the throwaway sponsor account that pays the reserves
 * of recipient accounts, fund it through Friendbot, and write the sponsor
 * values into .env (mode 600) from .env.example. This account is separate
 * from the SDP host distribution account in sdp/.env and from every tenant
 * distribution account. The secret is never printed.
 *
 * Usage: npm run sponsor:setup [-- --force]
 */
import { Keypair } from '@stellar/stellar-sdk';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const ENV_PATH = '.env';
const TEMPLATE_PATH = '.env.example';
const FRIENDBOT_URL = process.env.FRIENDBOT_URL || 'https://friendbot.stellar.org';
const force = process.argv.includes('--force');
const mask = (a) => `${a.slice(0, 4)}...${a.slice(-4)}`;

if (existsSync(ENV_PATH) && !force) {
  console.error(`${ENV_PATH} already exists. Re-run with --force to replace the sponsor (the old one stays funded and is abandoned).`);
  process.exit(2);
}

const kp = Keypair.random();
console.log('Generated sponsor keypair. Requesting Friendbot funding...');
const res = await fetch(`${FRIENDBOT_URL}?addr=${encodeURIComponent(kp.publicKey())}`);
if (!res.ok) {
  console.error(`Friendbot funding failed: HTTP ${res.status}`);
  console.error((await res.text()).slice(0, 500));
  process.exit(1);
}
const funding = await res.json();

const values = { SPONSOR_PUBLIC_KEY: kp.publicKey(), SPONSOR_SECRET_KEY: kp.secret() };
const template = existsSync(ENV_PATH) && force ? readFileSync(ENV_PATH, 'utf8') : readFileSync(TEMPLATE_PATH, 'utf8');
const filled = template
  .split('\n')
  .map((line) => {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    return m && m[1] in values ? `${m[1]}=${values[m[1]]}` : line;
  })
  .join('\n');
for (const k of Object.keys(values)) {
  if (!new RegExp(`^${k}=`, 'm').test(template)) {
    console.error(`template lacks ${k}`);
    process.exit(1);
  }
}
writeFileSync(ENV_PATH, `${filled.trimEnd()}\n`, { mode: 0o600 });
chmodSync(ENV_PATH, 0o600);
mkdirSync('test-output', { recursive: true });
writeFileSync('test-output/sponsor-funding.json', `${JSON.stringify({ fundedAt: new Date().toISOString(), sponsorMasked: mask(kp.publicKey()), friendbotTxHash: funding.hash, ledger: funding.ledger }, null, 2)}\n`);
console.log('');
console.log(`Sponsor ${mask(kp.publicKey())} funded by Friendbot.`);
console.log(`  tx ${funding.hash}`);
console.log(`  https://stellar.expert/explorer/testnet/tx/${funding.hash}`);
console.log(`Wrote ${ENV_PATH} (mode 600). Never commit it.`);
