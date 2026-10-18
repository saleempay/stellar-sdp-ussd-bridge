#!/usr/bin/env node
/**
 * Generates every secret the SDP stack needs, funds the host distribution
 * account through Friendbot (testnet), and writes sdp/.env (mode 600) from
 * sdp/.env.example. It prints masked public addresses and the Friendbot
 * transaction hash. It never prints a secret.
 *
 * Refuses to overwrite an existing sdp/.env unless --force is given, and
 * refuses --force while the stack's Postgres volume still exists: the two
 * encryption passphrases in sdp/.env decrypt the tenant distribution keys
 * stored in that volume (helmchart/sdp/README.md:277,356 at SDP 7.0.0), so
 * new passphrases over an old volume leave every tenant unable to sign.
 * Run `npm run sdp:down -- --reset` first.
 *
 * Usage: npm run sdp:accounts [-- --force] [-- --no-fund]
 *
 * --no-fund generates and writes without calling Friendbot and prints the
 * explorer link of the host distribution account from the configured
 * network, for funding by hand. The network values come from the template
 * overlaid by the process environment, through the boot assertion: a
 * network other than testnet needs every value supplied and
 * BRIDGE_ACKNOWLEDGE_REAL_FUNDS=yes.
 */
import { Keypair } from '@stellar/stellar-sdk';
import { spawnSync } from 'node:child_process';
import { randomBytes, randomInt, generateKeyPairSync } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { NetworkConfigError, assertNetwork, explorerAccountUrl, explorerTxUrl, postgresVolumeName as volumeNameFor } from '../dist/index.js';

const ENV_PATH = 'sdp/.env';
const TEMPLATE_PATH = 'sdp/.env.example';
const FRIENDBOT_URL = process.env.FRIENDBOT_URL || 'https://friendbot.stellar.org';
const force = process.argv.includes('--force');
const noFundFlag = process.argv.includes('--no-fund');

if (existsSync(ENV_PATH) && !force) {
  console.error(`${ENV_PATH} already exists. Re-run with --force to replace it (the old accounts are abandoned).`);
  process.exit(2);
}

/**
 * The Compose volume name, as sdp/docker-compose.yml builds it:
 * ${COMPOSE_PROJECT_NAME:-sdp-bridge}_postgres-db-${NETWORK_TYPE:-testnet}.
 * Project name and network type are read from the existing sdp/.env, then
 * the environment, then the defaults (src/sdp/env.ts, postgresVolumeName).
 */
function postgresVolumeName() {
  const fromFile = (key) => {
    if (!existsSync(ENV_PATH)) return undefined;
    const m = new RegExp(`^${key}=(.*)$`, 'm').exec(readFileSync(ENV_PATH, 'utf8'));
    return m ? m[1].trim().replace(/^["']|["']$/g, '') : undefined;
  };
  return volumeNameFor(fromFile('COMPOSE_PROJECT_NAME') || process.env.COMPOSE_PROJECT_NAME, fromFile('NETWORK_TYPE') || process.env.NETWORK_TYPE);
}

if (force) {
  const volume = postgresVolumeName();
  // The guard allows --force only when the volume is positively absent.
  // Exit 0 means it exists. A stopped daemon or a missing binary also exits
  // non-zero, so only Docker's own "no such volume" answer counts as absent;
  // anything else refuses, because the volume may well still be on disk.
  const inspect = spawnSync('docker', ['volume', 'inspect', volume], { encoding: 'utf8' });
  if (inspect.status === 0) {
    console.error(`--force refused: the Docker volume ${volume} still exists. Its tenant distribution keys are encrypted under the passphrases in the current ${ENV_PATH}; new passphrases would leave every tenant unable to sign. Run \`npm run sdp:down -- --reset\` first, then re-run with --force.`);
    process.exit(2);
  }
  const stderr = `${inspect.stderr ?? ''}`;
  if (inspect.error || !/no such volume/i.test(stderr)) {
    console.error(`--force refused: Docker did not confirm that the volume ${volume} is absent (${inspect.error ? inspect.error.code : stderr.trim().split('\n')[0] || `exit ${inspect.status}`}). Start Docker first, then re-run; the guard allows --force only when Docker answers "no such volume".`);
    process.exit(2);
  }
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

let template;
try {
  template = readFileSync(TEMPLATE_PATH, 'utf8');
} catch {
  console.error(`template ${TEMPLATE_PATH} not found`);
  process.exit(1);
}
let network;
try {
  network = assertNetwork({ ...parseEnv(template), ...process.env });
} catch (e) {
  console.error(e instanceof NetworkConfigError ? e.message : String(e));
  process.exit(2);
}

const distribution = Keypair.random();
const sep10 = Keypair.random();
const distEnc = Keypair.random();
const channelEnc = Keypair.random();
const ec = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const ecPem = ec.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString().trim().replace(/\n/g, '\\n');

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

// The template is validated before Friendbot is asked for anything: a
// broken template must not cost a funded account.
const unfilled = Object.keys(values).filter((k) => !new RegExp(`^${k}=`, 'm').test(template));
if (unfilled.length) {
  console.error(`template ${TEMPLATE_PATH} lacks keys: ${unfilled.join(', ')}`);
  process.exit(1);
}
const filled = template
  .split('\n')
  .map((line) => {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (!m || !(m[1] in values)) return line;
    return `${m[1]}=${values[m[1]]}`;
  })
  .join('\n');

// Friendbot exists on testnet only: off testnet the faucet is never asked,
// whether or not --no-fund was passed (review of 13 October, minor).
const noFund = noFundFlag || network.networkType !== 'testnet';
let funding;
if (noFund) {
  console.log(noFundFlag
    ? `Generated keypairs for network ${network.networkType}. Host distribution account not funded (--no-fund).`
    : `Generated keypairs for network ${network.networkType}. Host distribution account not funded: Friendbot is testnet only, so funding is skipped on this network (fund by hand).`);
} else {
  console.log(`Generated keypairs for network ${network.networkType}. Requesting Friendbot funding for the host distribution account...`);
  const res = await fetch(`${FRIENDBOT_URL}?addr=${encodeURIComponent(distribution.publicKey())}`);
  if (!res.ok) {
    console.error(`Friendbot funding failed: HTTP ${res.status}`);
    console.error((await res.text()).slice(0, 500));
    process.exit(1);
  }
  funding = await res.json();
}

writeFileSync(ENV_PATH, `${filled.trimEnd()}\n`, { mode: 0o600 });
chmodSync(ENV_PATH, 0o600);

mkdirSync('test-output', { recursive: true });
const record = funding
  ? { fundedAt: new Date().toISOString(), network: network.networkType, distributionPublicKeyMasked: mask(distribution.publicKey()), friendbotTxHash: funding.hash, ledger: funding.ledger }
  : { fundedAt: null, network: network.networkType, distributionPublicKeyMasked: mask(distribution.publicKey()), funded: false };
writeFileSync('test-output/sdp-accounts-funding.json', `${JSON.stringify(record, null, 2)}\n`);

console.log('');
if (funding) {
  console.log(`Host distribution account ${mask(distribution.publicKey())} funded by Friendbot.`);
  console.log(`  tx ${funding.hash}`);
  console.log(`  ${explorerTxUrl(network, funding.hash)}`);
} else {
  console.log(`Host distribution account ${mask(distribution.publicKey())} written, not funded. Fund it by hand, then check it here:`);
  console.log(`  ${explorerAccountUrl(network, distribution.publicKey())}`);
}
console.log(`SEP-10 signing account ${mask(sep10.publicKey())} (not funded; it only signs).`);
console.log(`Wrote ${ENV_PATH} (mode 600). Never commit it, paste it, or show it on screen.`);
