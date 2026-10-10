/**
 * Wiring of the bridge's USSD service: the adapter's HTTP listener with
 * the bridge's step machine injected (adapter PR #15, merged as 4c235f8:
 * exactly one of `machine` or `handle`), the
 * adapter's gateway adapter, session store and PIN store, the bridge's
 * account view over Horizon, and sponsored creation on dial through the
 * adapter's resolveOrCreateAccount with the Deliverable 2 sponsor.
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
  resolveOrCreateAccount,
  type AccountStore,
  type GatewayStep,
  type PinStore,
} from 'stellar-ussd-sep10-adapter';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { FetchHorizon } from '../provision/horizon.js';
import { TESTNET_HORIZON_URL, TESTNET_NETWORK_PASSPHRASE, TESTNET_USDC_ISSUER, USDC_CODE } from '../sdp/facts.js';
import { loadAccountView } from './accountView.js';
import { handleBridgeStep, type BridgeMachineDeps } from './machine.js';

export interface UssdServerConfig {
  callbackPath: string;
  allowedCidrs?: string;
  defaultCountryCode: string;
  createOnDial: boolean;
  /** Directory holding accounts.json and pins.json. Undefined: in-memory stores. */
  dataDir?: string;
  horizonUrl?: string;
  networkPassphrase?: string;
  asset?: { code: string; issuer: string };
  /** Sponsor secret for creation on dial; required when createOnDial is true. */
  sponsorSecretKey?: string;
  legTimeoutMs?: number;
  sessionTtlMs?: number;
  log?: (line: string) => void;
}

export interface UssdServer {
  listener: (req: IncomingMessage, res: ServerResponse) => void;
  machine: BridgeMachineDeps;
}

export function ussdConfigFromEnv(env: Record<string, string | undefined>): UssdServerConfig {
  const createOnDial = (env.USSD_CREATE_ON_DIAL ?? 'true').toLowerCase() !== 'false';
  return {
    callbackPath: env.USSD_CALLBACK_PATH ?? '',
    allowedCidrs: env.USSD_ALLOWED_CIDRS,
    defaultCountryCode: env.USSD_DEFAULT_COUNTRY_CODE ?? '254',
    createOnDial,
    dataDir: env.DATA_DIR ?? 'data',
    horizonUrl: env.HORIZON_URL,
    networkPassphrase: env.NETWORK_PASSPHRASE,
    asset: { code: env.ASSET_CODE || USDC_CODE, issuer: env.ASSET_ISSUER || TESTNET_USDC_ISSUER },
    sponsorSecretKey: env.SPONSOR_SECRET_KEY,
    sessionTtlMs: env.USSD_SESSION_TTL_MS ? Number(env.USSD_SESSION_TTL_MS) : undefined,
  };
}

export function createUssdServer(cfg: UssdServerConfig): UssdServer {
  const log = cfg.log ?? (() => undefined);
  const asset = cfg.asset ?? { code: USDC_CODE, issuer: TESTNET_USDC_ISSUER };
  const networkPassphrase = cfg.networkPassphrase ?? TESTNET_NETWORK_PASSPHRASE;
  if (networkPassphrase !== TESTNET_NETWORK_PASSPHRASE) throw new Error('this service runs on testnet only');
  const horizon = new FetchHorizon(cfg.horizonUrl ?? TESTNET_HORIZON_URL, { timeoutMs: cfg.legTimeoutMs ?? SESSION_LEG_TIMEOUT_MS });
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
    if (!cfg.sponsorSecretKey) throw new Error('USSD_CREATE_ON_DIAL is on but SPONSOR_SECRET_KEY is not set');
    const signer = new LocalKeypairSigner();
    const sponsorPublicKey = signer.importSecret(cfg.sponsorSecretKey);
    // creation uses a longer deadline than a read: one Horizon submission
    const creationHorizon = new FetchHorizon(cfg.horizonUrl ?? TESTNET_HORIZON_URL, { timeoutMs: 8_000 });
    createAccount = async (msisdn) => {
      const r = await resolveOrCreateAccount({ store: accounts, signer, horizon: creationHorizon, networkPassphrase, sponsorPublicKey, asset }, msisdn);
      return r.creationTxHash ? { accountId: r.accountId, creationTxHash: r.creationTxHash } : { accountId: r.accountId };
    };
  }

  const machine: BridgeMachineDeps = {
    sessions,
    pins,
    accounts,
    loadView: (accountId) => loadAccountView({ horizon, asset }, accountId),
    msisdn: { defaultCountryCode: cfg.defaultCountryCode },
    log,
  };
  if (createAccount) machine.createAccount = createAccount;

  const listener = createUssdRequestListener({
    gateway: new AfricasTalkingGateway(),
    sessions,
    callbackPath: cfg.callbackPath,
    allowedCidrs: cfg.allowedCidrs ? parseCidrList(cfg.allowedCidrs) : undefined,
    handle: (step: GatewayStep) => handleBridgeStep(machine, step),
    log,
  });
  return { listener, machine };
}
