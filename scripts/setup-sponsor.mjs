#!/usr/bin/env node
/**
 * Create the throwaway sponsor account that pays the reserves of recipient
 * accounts, fund it through Friendbot (testnet), and write the sponsor
 * values into .env (mode 600) from .env.example. This account is separate
 * from the SDP host distribution account in sdp/.env and from every tenant
 * distribution account. The secret is never printed.
 *
 * Usage: npm run sponsor:setup [-- --force] [-- --no-fund]
 *
 * --no-fund generates and writes without calling Friendbot and prints the
 * explorer link of the account from the configured network, for funding
 * by hand. The network values come from the existing .env (or the
 * template) overlaid by the process environment, through the boot
 * assertion: a network other than testnet needs every value supplied and
 * BRIDGE_ACKNOWLEDGE_REAL_FUNDS=yes.
 */
import { Keypair } from '@stellar/stellar-sdk';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { NetworkConfigError, assertNetwork, explorerAccountUrl, explorerTxUrl } from '../dist/index.js';

const ENV_PATH = '.env';
const TEMPLATE_PATH = '.env.example';
const FRIENDBOT_URL = process.env.FRIENDBOT_URL || 'https://friendbot.stellar.org';
const force = process.argv.includes('--force');
const noFundFlag = process.argv.includes('--no-fund');
const mask = (a) => `${a.slice(0, 4)}...${a.slice(-4)}`;

if (existsSync(ENV_PATH) && !force) {
  console.error(`${ENV_PATH} already exists. Re-run with --force to replace the sponsor (the old one stays funded and is abandoned).`);
  process.exit(2);
}

const template = existsSync(ENV_PATH) && force ? readFileSync(ENV_PATH, 'utf8') : readFileSync(TEMPLATE_PATH, 'utf8');
let network;
try {
  network = assertNetwork({ ...parseEnv(template), ...process.env });
} catch (e) {
  console.error(e instanceof NetworkConfigError ? e.message : String(e));
  process.exit(2);
}

// Friendbot exists on testnet only: off testnet the faucet is never asked,
// whether or not --no-fund was passed (review of 13 October, minor).
const noFund = noFundFlag || network.networkType !== 'testnet';
const kp = Keypair.random();
let funding;
if (noFund) {
  console.log(noFundFlag
    ? `Generated sponsor keypair for network ${network.networkType}. Not funded (--no-fund).`
    : `Generated sponsor keypair for network ${network.networkType}. Not funded: Friendbot is testnet only, so funding is skipped on this network (fund by hand).`);
} else {
  console.log(`Generated sponsor keypair for network ${network.networkType}. Requesting Friendbot funding...`);
  const res = await fetch(`${FRIENDBOT_URL}?addr=${encodeURIComponent(kp.publicKey())}`);
  if (!res.ok) {
    console.error(`Friendbot funding failed: HTTP ${res.status}`);
    console.error((await res.text()).slice(0, 500));
    process.exit(1);
  }
  funding = await res.json();
}

const values = { SPONSOR_PUBLIC_KEY: kp.publicKey(), SPONSOR_SECRET_KEY: kp.secret() };
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
const record = funding
  ? { fundedAt: new Date().toISOString(), network: network.networkType, sponsorMasked: mask(kp.publicKey()), friendbotTxHash: funding.hash, ledger: funding.ledger }
  : { fundedAt: null, network: network.networkType, sponsorMasked: mask(kp.publicKey()), funded: false };
writeFileSync('test-output/sponsor-funding.json', `${JSON.stringify(record, null, 2)}\n`);
console.log('');
if (funding) {
  console.log(`Sponsor ${mask(kp.publicKey())} funded by Friendbot.`);
  console.log(`  tx ${funding.hash}`);
  console.log(`  ${explorerTxUrl(network, funding.hash)}`);
} else {
  console.log(`Sponsor ${mask(kp.publicKey())} written, not funded. Fund it by hand, then check it here:`);
  console.log(`  ${explorerAccountUrl(network, kp.publicKey())}`);
}
console.log(`Wrote ${ENV_PATH} (mode 600). Never commit it.`);
