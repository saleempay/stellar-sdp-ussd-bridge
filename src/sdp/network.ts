/**
 * Network facts read from the environment, and the boot assertion every
 * process runs before it touches Horizon or the SDP.
 *
 * This repository configures testnet and nothing else: the testnet
 * constants in facts.ts are the defaults and the only network literals.
 * A network other than testnet runs only when every value is supplied
 * from outside this repository and the operator acknowledges that real
 * funds move (ruling of 10 October 2026, recorded in CLAUDE.md, "Network
 * and secrets").
 */
import {
  TESTNET_EXPLORER_BASE_URL,
  TESTNET_HORIZON_URL,
  TESTNET_NETWORK_PASSPHRASE,
  TESTNET_USDC_ISSUER,
} from './facts.js';

export interface NetworkFacts {
  /** `testnet`, or whatever the environment names; compared case-insensitively. */
  networkType: string;
  networkPassphrase: string;
  horizonUrl: string;
  /** Issuer of the asset the bridge pays (USDC). */
  assetIssuer: string;
  /** Explorer base, used to print links: `<base>/tx/<hash>`, `<base>/account/<id>`. */
  explorerBaseUrl: string;
}

export const TESTNET_NETWORK_TYPE = 'testnet';

/** The testnet values, the defaults when NETWORK_TYPE is unset or testnet. */
export const TESTNET_FACTS: Readonly<NetworkFacts> = Object.freeze({
  networkType: TESTNET_NETWORK_TYPE,
  networkPassphrase: TESTNET_NETWORK_PASSPHRASE,
  horizonUrl: TESTNET_HORIZON_URL,
  assetIssuer: TESTNET_USDC_ISSUER,
  explorerBaseUrl: TESTNET_EXPLORER_BASE_URL,
});

/** Environment variable names, one per fact. */
export const NETWORK_ENV: Readonly<Record<keyof NetworkFacts, string>> = Object.freeze({
  networkType: 'NETWORK_TYPE',
  networkPassphrase: 'NETWORK_PASSPHRASE',
  horizonUrl: 'HORIZON_URL',
  assetIssuer: 'ASSET_ISSUER',
  explorerBaseUrl: 'EXPLORER_BASE_URL',
});

/** Must read exactly `yes` for any network other than testnet. */
export const REAL_FUNDS_ACK_ENV = 'BRIDGE_ACKNOWLEDGE_REAL_FUNDS';

const FACT_KEYS = Object.keys(NETWORK_ENV) as Array<keyof NetworkFacts>;
const VALUE_KEYS = FACT_KEYS.filter((k) => k !== 'networkType');

export type EnvLike = Record<string, string | undefined>;

const clean = (v: string | undefined): string => (v ?? '').trim();

/** The network type the environment names, lower-cased; testnet when unset. */
export function networkTypeOf(env: EnvLike): string {
  return clean(env[NETWORK_ENV.networkType]).toLowerCase() || TESTNET_NETWORK_TYPE;
}

/**
 * Read the facts without judging them. On testnet an unset value takes
 * the testnet constant; on any other network an unset value stays empty,
 * so {@link assertNetwork} can name it.
 */
export function networkFacts(env: EnvLike): NetworkFacts {
  const networkType = networkTypeOf(env);
  const testnet = networkType === TESTNET_NETWORK_TYPE;
  const facts: NetworkFacts = { ...TESTNET_FACTS, networkType };
  for (const k of VALUE_KEYS) {
    const v = clean(env[NETWORK_ENV[k]]);
    facts[k] = v || (testnet ? TESTNET_FACTS[k] : '');
  }
  return facts;
}

/** The boot assertion refused the configuration. `reasons` names each value. */
export class NetworkConfigError extends Error {
  constructor(readonly reasons: string[]) {
    super(`network configuration refused: ${reasons.join('; ')}`);
    this.name = 'NetworkConfigError';
  }
}

/**
 * The boot assertion.
 *
 * - testnet (NETWORK_TYPE unset or `testnet`): every value that is set
 *   must equal the testnet constant.
 * - any other network: every value must be supplied, none may equal a
 *   testnet constant, and BRIDGE_ACKNOWLEDGE_REAL_FUNDS must be `yes`.
 *
 * Throws {@link NetworkConfigError} naming every missing or mismatched
 * value by its variable name. Values themselves are never quoted in the
 * message, so a misplaced secret cannot leak through it.
 */
export function assertNetwork(env: EnvLike): NetworkFacts {
  const facts = networkFacts(env);
  const reasons: string[] = [];
  if (facts.networkType === TESTNET_NETWORK_TYPE) {
    for (const k of VALUE_KEYS) {
      if (facts[k] !== TESTNET_FACTS[k]) reasons.push(`${NETWORK_ENV[k]} does not equal the testnet value`);
    }
  } else {
    for (const k of VALUE_KEYS) {
      if (facts[k] === '') reasons.push(`${NETWORK_ENV[k]} is not set (required for network type "${facts.networkType}")`);
      else if (facts[k] === TESTNET_FACTS[k]) reasons.push(`${NETWORK_ENV[k]} equals the testnet value, which cannot belong to network type "${facts.networkType}"`);
    }
    if (clean(env[REAL_FUNDS_ACK_ENV]) !== 'yes') {
      reasons.push(`${REAL_FUNDS_ACK_ENV} must be "yes" to run on a network other than testnet`);
    }
  }
  if (reasons.length) throw new NetworkConfigError(reasons);
  return facts;
}

const base = (facts: NetworkFacts): string => facts.explorerBaseUrl.replace(/\/+$/, '');

/** Explorer link for a transaction hash. */
export function explorerTxUrl(facts: NetworkFacts, hash: string): string {
  return `${base(facts)}/tx/${hash}`;
}

/** Explorer link for an account. */
export function explorerAccountUrl(facts: NetworkFacts, accountId: string): string {
  return `${base(facts)}/account/${accountId}`;
}

/** The subset of fetch the Horizon check needs; injectable for tests. */
export type HorizonFetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface HorizonCheckOptions {
  fetch?: HorizonFetch;
  timeoutMs?: number;
}

export const DEFAULT_HORIZON_CHECK_TIMEOUT_MS = 10_000;

/**
 * The live half of the boot assertion (fix round of 18 October 2026). The
 * string checks above cannot tell a testnet mirror, a trailing slash or a
 * different-case host from another network; Horizon can. Its root document
 * carries `network_passphrase`, so one GET makes HORIZON_URL and
 * NETWORK_PASSPHRASE coherent by construction, on every network, testnet
 * included. Any failure to read it is a refusal (fail closed). Returns the
 * passphrase Horizon reported. Values are not echoed in the message.
 */
export async function verifyHorizonNetwork(facts: NetworkFacts, opts: HorizonCheckOptions = {}): Promise<string> {
  const fetchImpl: HorizonFetch = opts.fetch ?? ((input, init) => fetch(input, init));
  const url = `${facts.horizonUrl.replace(/\/+$/, '')}/`;
  const name = `${NETWORK_ENV.horizonUrl} root`;
  let res: Response;
  try {
    res = await fetchImpl(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_HORIZON_CHECK_TIMEOUT_MS) });
  } catch (e) {
    const kind = e instanceof Error ? e.name : 'error';
    throw new NetworkConfigError([`${name} did not answer (${kind}); its network_passphrase could not be compared with ${NETWORK_ENV.networkPassphrase}`]);
  }
  if (!res.ok) throw new NetworkConfigError([`${name} answered HTTP ${res.status}; its network_passphrase could not be compared with ${NETWORK_ENV.networkPassphrase}`]);
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new NetworkConfigError([`${name} did not answer with a JSON document; its network_passphrase could not be compared with ${NETWORK_ENV.networkPassphrase}`]);
  }
  const reported = (body as { network_passphrase?: unknown } | null)?.network_passphrase;
  if (typeof reported !== 'string' || reported === '') {
    throw new NetworkConfigError([`${name} carries no network_passphrase field; ${NETWORK_ENV.horizonUrl} does not look like a Horizon server`]);
  }
  if (reported !== facts.networkPassphrase) {
    throw new NetworkConfigError([`${NETWORK_ENV.horizonUrl} serves a different network than ${NETWORK_ENV.networkPassphrase} names: the Horizon root's network_passphrase does not match; the two must belong to the same network`]);
  }
  return reported;
}
