/**
 * Sponsored account creation on dial, with the guards the adapter's
 * reference flow (resolveOrCreateAccount) leaves to the caller:
 *
 * - one creation in flight per number: a second session for the same
 *   number (the natural retry after the listener's busy screen) awaits the
 *   first creation and shares its result instead of creating again, so
 *   the account store's last-write-wins put cannot orphan an account;
 * - a non-definitive submission failure (deadline, Horizon 5xx, no result
 *   codes) is checked on chain before it is reported: an account that
 *   landed is mapped and returned; one that is absent fails as before;
 *   when the chain cannot be read the pending record is kept and the
 *   failure is reported, so the next dial checks the record first and
 *   never creates a second account for the number.
 *
 * The pending record is the same store Deliverable 2 writes
 * (pending-creations.json in DATA_DIR), so the command line and the USSD
 * service reconcile each other's ambiguous creations.
 *
 * Caps: every creation locks about 1.5 XLM of sponsor reserve that the
 * reference signer can never reclaim, and on the sandbox anyone who knows
 * the service code can dial. So creation answers E3 (CreationCappedError)
 * when the sponsor's spendable XLM is below a configured minimum, or when
 * the configured number of creations in the last hour has been reached.
 * Adopting an account that already landed is not a creation and is never
 * capped.
 */
import {
  createSponsoredAccount,
  isHorizonNotFound,
  normalizeMsisdn,
  type AccountStore,
  type HorizonLike,
  type Signer,
} from 'stellar-ussd-sep10-adapter';
import { spendableXlm, type HorizonAccountRecord } from '../provision/horizon.js';
import type { PendingCreationStore } from '../provision/pending.js';
import { isNonDefinitiveSubmission } from '../provision/provision.js';
import { CreationCappedError } from './errors.js';

export interface CreationCaps {
  /** Creation is refused while the sponsor can spend less XLM than this. */
  minSponsorXlm: number;
  /** Creation is refused once this many accounts were created in the last hour. */
  maxPerHour: number;
}

export const DEFAULT_CREATION_CAPS: CreationCaps = { minSponsorXlm: 10, maxPerHour: 5 };
const HOUR_MS = 60 * 60 * 1000;

export interface CreateOnDialDeps {
  store: AccountStore;
  signer: Signer;
  horizon: HorizonLike;
  networkPassphrase: string;
  sponsorPublicKey: string;
  asset: { code: string; issuer: string };
  /** Pending creations; strongly recommended, see pending.ts. */
  pendingStore?: PendingCreationStore;
  /** Sponsor balance floor and hourly count; DEFAULT_CREATION_CAPS when omitted. */
  caps?: CreationCaps;
  /** Event sink: event names only, never a number. */
  log?: (line: string) => void;
  now?: () => number;
}

export interface CreatedOnDial {
  accountId: string;
  /** Present when this call submitted the creation and it was confirmed. */
  creationTxHash?: string;
  /** True when the account was created (or adopted) by this call. */
  created: boolean;
}

/**
 * Serialise concurrent calls per key: while a call for a key is running,
 * further calls for the same key get the same promise.
 */
export function withInFlightGuard<T>(fn: (key: string) => Promise<T>): (key: string) => Promise<T> {
  const inFlight = new Map<string, Promise<T>>();
  return (key) => {
    const running = inFlight.get(key);
    if (running) return running;
    const p = fn(key).finally(() => {
      if (inFlight.get(key) === p) inFlight.delete(key);
    });
    inFlight.set(key, p);
    return p;
  };
}

type Probe = 'exists' | 'absent' | 'unknown';

async function probe(horizon: HorizonLike, accountId: string): Promise<Probe> {
  try {
    await horizon.loadAccount(accountId);
    return 'exists';
  } catch (err) {
    return isHorizonNotFound(err) ? 'absent' : 'unknown';
  }
}

/** The creation function, guarded per number. Pass it to the machine as `createAccount`. */
export function createOnDial(deps: CreateOnDialDeps): (msisdn: string) => Promise<CreatedOnDial> {
  const log = deps.log ?? (() => undefined);
  const now = deps.now ?? (() => Date.now());
  const caps = deps.caps ?? DEFAULT_CREATION_CAPS;
  /** Completion times of creations by this process, newest last. */
  const creations: number[] = [];

  const assertUnderCaps = async (): Promise<void> => {
    const since = now() - HOUR_MS;
    while (creations.length && creations[0]! < since) creations.shift();
    if (creations.length >= caps.maxPerHour) {
      throw new CreationCappedError('rate', `${creations.length} accounts were created in the last hour; the cap is ${caps.maxPerHour}`);
    }
    const sponsor = await deps.horizon.loadAccount(deps.sponsorPublicKey);
    const spendable = typeof (sponsor as HorizonAccountRecord).subentryCount === 'number'
      ? spendableXlm(sponsor as HorizonAccountRecord)
      : Number(sponsor.balances.find((b) => b.asset_type === 'native')?.balance ?? 0);
    if (spendable < caps.minSponsorXlm) {
      throw new CreationCappedError('sponsor_balance', `the sponsor can spend ${spendable.toFixed(7)} XLM; creation needs at least ${caps.minSponsorXlm} XLM`);
    }
  };

  const create = async (raw: string): Promise<CreatedOnDial> => {
    const msisdn = normalizeMsisdn(raw);
    const existing = await deps.store.get(msisdn);
    if (existing) return { accountId: existing, created: false };

    // A pending record from an earlier attempt (this service or the
    // command line) names an account that may exist.
    const pending = await deps.pendingStore?.get(msisdn);
    if (pending) {
      const p = await probe(deps.horizon, pending.accountId);
      if (p === 'exists') {
        await deps.store.put(msisdn, pending.accountId);
        await deps.pendingStore?.delete(msisdn);
        log('creation event=adoptedPendingAccount');
        return { accountId: pending.accountId, created: true };
      }
      if (p === 'unknown') {
        log('creation event=pendingUnreadable');
        throw new Error('a pending creation for this number could not be checked on chain');
      }
      await deps.pendingStore?.delete(msisdn);
    }

    await assertUnderCaps();
    const newAccountId = await deps.signer.createAccountKey();
    await deps.pendingStore?.put(msisdn, { accountId: newAccountId, at: new Date(now()).toISOString() });
    try {
      const result = await createSponsoredAccount({
        horizon: deps.horizon,
        networkPassphrase: deps.networkPassphrase,
        sponsorPublicKey: deps.sponsorPublicKey,
        newAccountId,
        signer: deps.signer,
        asset: deps.asset,
      });
      await deps.store.put(msisdn, newAccountId);
      await deps.pendingStore?.delete(msisdn);
      creations.push(now());
      return { accountId: newAccountId, creationTxHash: result.hash, created: true };
    } catch (err) {
      if (isNonDefinitiveSubmission(err)) {
        const p = await probe(deps.horizon, newAccountId);
        if (p === 'exists') {
          await deps.store.put(msisdn, newAccountId);
          await deps.pendingStore?.delete(msisdn);
          creations.push(now());
          log('creation event=landedAfterAmbiguousSubmission');
          return { accountId: newAccountId, created: true };
        }
        if (p === 'unknown') {
          // keep the pending record: the next dial checks it first
          log('creation event=ambiguousUnreadable');
          throw err;
        }
      }
      await deps.pendingStore?.delete(msisdn);
      throw err;
    }
  };

  return withInFlightGuard(create);
}
