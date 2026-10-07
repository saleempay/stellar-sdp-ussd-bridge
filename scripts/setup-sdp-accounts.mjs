#!/usr/bin/env node
/**
 * TESTNET ONLY. Generates every secret the SDP stack needs, funds the host
 * distribution account through Friendbot, and writes sdp/.env (mode 600)
 * from sdp/.env.example. It prints masked public addresses and the
 * Friendbot transaction hash. It never prints a secret.
 *
 * Refuses to overwrite an existing sdp/.env unless --force is given.
 *
 * Usage: npm run sdp:accounts [-- --force]
 */
import { Keypair } from '@stellar/stellar-sdk';
import { randomBytes, randomInt, generateKeyPairSync } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const ENV_PATH = 'sdp/.env';
const TEMPLATE_PATH = 'sdp/.env.example';
const FRIENDBOT_URL = process.env.FRIENDBOT_URL || 'https://friendbot.stellar.org';
const force = process.argv.includes('--force');

if (existsSync(ENV_PATH) && !force) {
  console.error(`${ENV_PATH} already exists. Re-run with --force to replace it (the old accounts are abandoned).`);
  process.exit(2);
}

const mask = (a) => `${a.slice(0, 4)}...${a.slice(-4)}`;
// SDP password policy (stellar-auth/pkg/utils/password_validation.go at
// 7.0.0): 12 to 36 characters with a lower case letter, an upper case
// letter, a digit and a special character. The special set below avoids
// characters that dotenv parsers or Compose interpolation treat specially
// (quotes, #, $, backslash, space).
const LOWER = 'abcdefghijkmnopqrstuvwxyz';
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const DIGIT = '23456789';
const SPECIAL = '!%*+-=?@^_~';
const pick = (set) => set[randomInt(set.length)];
function password(len = 24) {
  const all = LOWER + UPPER + DIGIT + SPECIAL;
  const chars = [pick(LOWER), pick(UPPER), pick(DIGIT), pick(SPECIAL)];
  while (chars.length < len) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i -= 1) { const j = randomInt(i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
  return chars.join('');
}

const distribution = Keypair.random();
const sep10 = Keypair.random();
const distEnc = Keypair.random();
const channelEnc = Keypair.random();
const ec = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const ecPem = ec.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString().trim().replace(/\n/g, '\\n');

console.log('Generated keypairs. Requesting Friendbot funding for the host distribution account...');
const res = await fetch(`${FRIENDBOT_URL}?addr=${encodeURIComponent(distribution.publicKey())}`);
if (!res.ok) {
  console.error(`Friendbot funding failed: HTTP ${res.status}`);
  console.error((await res.text()).slice(0, 500));
  process.exit(1);
}
const funding = await res.json();

const values = {
  DISTRIBUTION_PUBLIC_KEY: distribution.publicKey(),
  DISTRIBUTION_SEED: distribution.secret(),
  SEP10_SIGNING_PUBLIC_KEY: sep10.publicKey(),
  SEP10_SIGNING_PRIVATE_KEY: sep10.secret(),
  DISTRIBUTION_ACCOUNT_ENCRYPTION_PASSPHRASE: distEnc.secret(),
  CHANNEL_ACCOUNT_ENCRYPTION_PASSPHRASE: channelEnc.secret(),
  ADMIN_API_KEY: randomBytes(32).toString('hex'),
  SEP24_JWT_SECRET: randomBytes(32).toString('hex'),
  EC256_PRIVATE_KEY: `"${ecPem}"`,
  BRIDGE_OWNER_PASSWORD: password(),
  SCOPETEST_OWNER_PASSWORD: password(),
};

const template = readFileSync(TEMPLATE_PATH, 'utf8');
const filled = template
  .split('\n')
  .map((line) => {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (!m || !(m[1] in values)) return line;
    return `${m[1]}=${values[m[1]]}`;
  })
  .join('\n');
const unfilled = Object.keys(values).filter((k) => !new RegExp(`^${k}=`, 'm').test(template));
if (unfilled.length) {
  console.error(`template ${TEMPLATE_PATH} lacks keys: ${unfilled.join(', ')}`);
  process.exit(1);
}
writeFileSync(ENV_PATH, `${filled.trimEnd()}\n`, { mode: 0o600 });
chmodSync(ENV_PATH, 0o600);

mkdirSync('test-output', { recursive: true });
writeFileSync(
  'test-output/sdp-accounts-funding.json',
  `${JSON.stringify({ fundedAt: new Date().toISOString(), distributionPublicKeyMasked: mask(distribution.publicKey()), friendbotTxHash: funding.hash, ledger: funding.ledger }, null, 2)}\n`,
);

console.log('');
console.log(`Host distribution account ${mask(distribution.publicKey())} funded by Friendbot.`);
console.log(`  tx ${funding.hash}`);
console.log(`  https://stellar.expert/explorer/testnet/tx/${funding.hash}`);
console.log(`SEP-10 signing account ${mask(sep10.publicKey())} (not funded; it only signs).`);
console.log(`Wrote ${ENV_PATH} (mode 600). Never commit it, paste it, or show it on screen.`);
