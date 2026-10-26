/**
 * Wiring of the bridge's USSD service: the adapter's HTTP listener with
 * the bridge's step machine injected (adapter PR #15, merged as 4c235f8:
 * exactly one of `machine` or `handle`), the
 * adapter's gateway adapter, session store and PIN store, the bridge's
 * account view over Horizon, and sponsored creation on dial through the
 * bridge's createOnDial (one creation in flight per number, an on-chain
 * check before an ambiguous failure is reported) with the Deliverable 2
 * sponsor.
 */
import {
  AfricasTalkingGateway,
  InMemoryPinStore,
  InMemorySessionStore,
  JsonFileAccountStore,
  JsonFilePinStore,
  LocalKeypairSigner,
  SESSION_LEG_TIMEOUT_MS,
  createUssdRequestListener,
  parseCidrList,
  type AccountStore,
  type GatewayStep,
  type PinStore,
  type Signer,
} from 'stellar-ussd-sep10-adapter';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { FetchHorizon } from '../provision/horizon.js';
import { InMemoryPendingStore, JsonFilePendingStore, type PendingCreationStore } from '../provision/pending.js';
import { USDC_CODE } from '../sdp/facts.js';
import { ConfigError } from '../sdp/env.js';
import { NETWORK_ENV, NetworkConfigError, TESTNET_FACTS, TESTNET_NETWORK_TYPE, assertNetwork, type NetworkFacts } from '../sdp/network.js';
import { loadAccountView } from './accountView.js';
import { closingLineFromEnv } from './closingLine.js';
import { DEFAULT_CREATION_CAPS, createOnDial, type CreationCaps } from './createOnDial.js';
import { handleBridgeStep, type BridgeMachineDeps } from './machine.js';
import { SCREENS, maxClosingLineLength } from './screens.js';
import { assertSigner } from '../signer/injected.js';

export interface UssdServerConfig {
  callbackPath: string;
  allowedCidrs?: string;
  defaultCountryCode: string;
  createOnDial: boolean;
  /** Directory holding accounts.json and pins.json. Undefined: in-memory stores. */
  dataDir?: string;
  /** The network, after the boot assertion (ussdConfigFromEnv runs it). Testnet when absent. */
  network?: NetworkFacts;
  /** Asset code; the issuer is the network's. */
  assetCode?: string;
  /** Closing line of screens 7 and 8; the contracted text when absent. */
  closingLine?: string;
  /**
   * Sponsor secret for creation on dial with the adapter's reference signer
   * (the default); required when createOnDial is true and no signer is given.
   */
  sponsorSecretKey?: string;
  /** Creation on dial caps; DEFAULT_CREATION_CAPS when omitted. */
  creationCaps?: CreationCaps;
  /**
   * A signer supplied from outside this repository (loadInjectedSigner),
   * checked against the adapter's Signer interface at boot. With it,
   * `sponsorPublicKey` names the sponsor and no secret is read.
   */
  signer?: Signer;
  sponsorPublicKey?: string;
  legTimeoutMs?: number;
  sessionTtlMs?: number;
  /**
   * Readiness of the service, read on every callback after the adapter's
   * path and allow-list checks. While it answers false the machine does not
   * run and the callback gets E4, the service-down END screen (its existing
   * text). Absent: always ready.
   */
  ready?: () => boolean;
  log?: (line: string) => void;
}

export interface UssdServer {
  listener: (req: IncomingMessage, res: ServerResponse) => void;
  machine: BridgeMachineDeps;
}

/** A positive number from the environment, or the default; anything else is refused. */
function positiveNumber(name: string, raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${name} must be a non-negative number`);
  return n;
}

/**
 * Configuration from the environment. Runs the boot assertion
 * (NetworkConfigError when the network values are missing or mixed) and
 * validates the closing line (ClosingLineError); both are refusals the
 * process should report and exit on. Creation on dial fails closed: off
 * unless USSD_CREATE_ON_DIAL is exactly true, and capped (D5); on any
 * network other than testnet it is refused at boot (NetworkConfigError),
 * because creation on dial is a demonstration posture: it creates an
 * account for whoever dials, with the sponsor's reserves, and the
 * reference signer keeps no key for it. Elsewhere recipients are
 * provisioned by the operator (`npm run provision`) and an unknown number
 * sees E3.
 */
export function ussdConfigFromEnv(env: Record<string, string | undefined>): UssdServerConfig {
  // fail closed: creation on dial is off unless the environment says true
  const createOnDial = (env.USSD_CREATE_ON_DIAL ?? '').trim().toLowerCase() === 'true';
  const creationCaps: CreationCaps = {
    minSponsorXlm: positiveNumber('USSD_CREATE_MIN_SPONSOR_XLM', env.USSD_CREATE_MIN_SPONSOR_XLM, DEFAULT_CREATION_CAPS.minSponsorXlm),
    maxPerHour: positiveNumber('USSD_CREATE_MAX_PER_HOUR', env.USSD_CREATE_MAX_PER_HOUR, DEFAULT_CREATION_CAPS.maxPerHour),
  };
  const network = assertNetwork(env);
  if (createOnDial && network.networkType !== TESTNET_NETWORK_TYPE) {
    throw new NetworkConfigError([
      `USSD_CREATE_ON_DIAL=true is refused for network type "${network.networkType}" (${NETWORK_ENV.networkType}): creation on dial is a testnet demonstration posture; on any other network recipients are provisioned by the operator, so leave USSD_CREATE_ON_DIAL unset or false`,
    ]);
  }
  const closingLine = closingLineFromEnv(env, maxClosingLineLength());
  return {
    callbackPath: env.USSD_CALLBACK_PATH ?? '',
    allowedCidrs: env.USSD_ALLOWED_CIDRS,
    defaultCountryCode: env.USSD_DEFAULT_COUNTRY_CODE ?? '254',
    createOnDial,
    dataDir: env.DATA_DIR ?? 'data',
    network,
    assetCode: env.ASSET_CODE || USDC_CODE,
    closingLine,
    sponsorSecretKey: env.SPONSOR_SECRET_KEY,
    creationCaps,
    sponsorPublicKey: env.SPONSOR_PUBLIC_KEY,
    sessionTtlMs: env.USSD_SESSION_TTL_MS ? Number(env.USSD_SESSION_TTL_MS) : undefined,
  };
}

/**
 * The adapter's callback path rules, so a service can refuse at boot with
 * the other configuration (the bridge's ConfigError, exit 2, no stack
 * trace) instead of inside createUssdServer after the Horizon check and
 * the signer load. The adapter keeps its own check; the messages name no
 * path value.
 */
export const MIN_CALLBACK_PATH_LENGTH = 12;
export function assertCallbackPath(callbackPath: string | undefined): void {
  if (typeof callbackPath !== 'string' || !callbackPath.startsWith('/')) {
    throw new ConfigError('USSD_CALLBACK_PATH is required and must start with "/": a long random segment (for example /ussd/<32 random chars>), never printed; there is no default');
  }
  if (callbackPath.length < MIN_CALLBACK_PATH_LENGTH) {
    throw new ConfigError(`USSD_CALLBACK_PATH is too short to be unguessable (at least ${MIN_CALLBACK_PATH_LENGTH} characters); use a long random segment`);
  }
}

export function createUssdServer(cfg: UssdServerConfig): UssdServer {
  const log = cfg.log ?? (() => undefined);
  const network = cfg.network ?? TESTNET_FACTS;
  const asset = { code: cfg.assetCode ?? USDC_CODE, issuer: network.assetIssuer };
  const networkPassphrase = network.networkPassphrase;
  const legTimeoutMs = cfg.legTimeoutMs ?? SESSION_LEG_TIMEOUT_MS;
  const horizon = new FetchHorizon(network.horizonUrl, { timeoutMs: legTimeoutMs });
  const sessions = cfg.sessionTtlMs ? new InMemorySessionStore(cfg.sessionTtlMs) : new InMemorySessionStore();
  const pins: PinStore = cfg.dataDir ? new JsonFilePinStore(join(cfg.dataDir, 'pins.json')) : new InMemoryPinStore();
  const accounts: AccountStore = cfg.dataDir ? new JsonFileAccountStore(join(cfg.dataDir, 'accounts.json')) : new (class implements AccountStore {
    m = new Map<string, string>();
    async get(k: string) { return this.m.get(k); }
    async put(k: string, v: string) { this.m.set(k, v); }
    async delete(k: string) { this.m.delete(k); }
  })();

  let createAccount: BridgeMachineDeps['createAccount'];
  if (cfg.createOnDial) {
    let signer: Signer;
    let sponsorPublicKey: string;
    if (cfg.signer) {
      signer = assertSigner(cfg.signer, 'UssdServerConfig.signer');
      if (!cfg.sponsorPublicKey) throw new Error('USSD_CREATE_ON_DIAL is on with an injected signer but SPONSOR_PUBLIC_KEY is not set');
      sponsorPublicKey = cfg.sponsorPublicKey;
    } else {
      if (!cfg.sponsorSecretKey) throw new Error('USSD_CREATE_ON_DIAL is on but SPONSOR_SECRET_KEY is not set');
      const local = new LocalKeypairSigner();
      sponsorPublicKey = local.importSecret(cfg.sponsorSecretKey);
      if (cfg.sponsorPublicKey && cfg.sponsorPublicKey !== sponsorPublicKey) throw new Error('SPONSOR_PUBLIC_KEY does not match SPONSOR_SECRET_KEY');
      signer = local;
    }
    // creation uses a longer deadline than a read: one Horizon submission
    const creationHorizon = new FetchHorizon(network.horizonUrl, { timeoutMs: 8_000 });
    // the same pending store the command line writes (pending.ts)
    const pendingStore: PendingCreationStore = cfg.dataDir ? new JsonFilePendingStore(join(cfg.dataDir, 'pending-creations.json')) : new InMemoryPendingStore();
    const create = createOnDial({ store: accounts, signer, horizon: creationHorizon, networkPassphrase, sponsorPublicKey, asset, pendingStore, caps: cfg.creationCaps ?? DEFAULT_CREATION_CAPS, log });
    createAccount = async (msisdn) => {
      const r = await create(msisdn);
      return r.creationTxHash ? { accountId: r.accountId, creationTxHash: r.creationTxHash } : { accountId: r.accountId };
    };
  }

  const machine: BridgeMachineDeps = {
    sessions,
    pins,
    accounts,
    // one retry of a transport failure or a 5xx inside the 7 s budget (accountView.ts)
    loadView: (accountId) => loadAccountView({ horizon, asset, legTimeoutMs, log }, accountId),
    msisdn: { defaultCountryCode: cfg.defaultCountryCode },
    log,
  };
  if (cfg.closingLine !== undefined) machine.closingLine = cfg.closingLine;
  if (createAccount) machine.createAccount = createAccount;

  const listener = createUssdRequestListener({
    gateway: new AfricasTalkingGateway(),
    sessions,
    callbackPath: cfg.callbackPath,
    allowedCidrs: cfg.allowedCidrs ? parseCidrList(cfg.allowedCidrs) : undefined,
    handle: (step: GatewayStep) => (cfg.ready && !cfg.ready() ? Promise.resolve(SCREENS.endServiceDown()) : handleBridgeStep(machine, step)),
    log,
  });
  return { listener, machine };
}
