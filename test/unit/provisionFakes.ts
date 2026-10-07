/** Offline fakes for the provisioning pipeline. */
import { Keypair } from '@stellar/stellar-sdk';
import { InMemoryAccountStore, InMemoryPinStore, type HorizonLike, type Signer } from 'stellar-ussd-sep10-adapter';
import type { HorizonAccountRecord } from '../../src/provision/horizon.js';
import { toAccountRecord } from '../../src/provision/horizon.js';
import { HorizonTimeoutError } from '../../src/provision/errors.js';

export const USDC = { code: 'USDC', issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5' };
/** Real StrKey addresses: the SDK validates every address it builds an operation with. */
export const SPONSOR = Keypair.random().publicKey();
export const EXISTING = Keypair.random().publicKey();
export const GONE = Keypair.random().publicKey();
export const NETWORK = 'Test SDF Network ; September 2015';

/** A Horizon rejection shaped like the SDK's (result codes under response.data.extras). */
export function rejection(transaction: string, operations: string[]): unknown {
  const e = new Error(`Horizon submitTransaction returned HTTP 400`) as Error & { response: unknown; status: number };
  e.status = 400;
  e.response = { status: 400, data: { extras: { result_codes: { transaction, operations } } } };
  return e;
}

export class FakeHorizon implements HorizonLike {
  accounts = new Map<string, { xlm: string; trustlines: Array<{ code: string; issuer: string }>; subentries: number; sponsoring: number; sponsored: number }>();
  submissions: string[] = [];
  /** Queue of rejections: each submission pops one; `undefined` means success. */
  nextErrors: unknown[] = [];
  /** When set, every call throws it. */
  failAll: unknown;
  private seq = 1;

  addAccount(id: string, opts: Partial<{ xlm: string; trustlines: Array<{ code: string; issuer: string }>; subentries: number; sponsoring: number; sponsored: number }> = {}) {
    this.accounts.set(id, { xlm: opts.xlm ?? '100.0000000', trustlines: opts.trustlines ?? [], subentries: opts.subentries ?? 0, sponsoring: opts.sponsoring ?? 0, sponsored: opts.sponsored ?? 0 });
  }

  async loadAccount(accountId: string): Promise<HorizonAccountRecord> {
    if (this.failAll) throw this.failAll;
    const a = this.accounts.get(accountId);
    if (!a) {
      const e = new Error('not found') as Error & { status: number };
      e.status = 404;
      throw e;
    }
    return toAccountRecord({
      id: accountId,
      sequence: String(this.seq++),
      subentry_count: a.subentries,
      num_sponsoring: a.sponsoring,
      num_sponsored: a.sponsored,
      balances: [
        ...a.trustlines.map((t) => ({ asset_type: 'credit_alphanum4', asset_code: t.code, asset_issuer: t.issuer, balance: '0.0000000' })),
        { asset_type: 'native', balance: a.xlm },
      ],
    });
  }

  async submitTransaction(tx: { toXDR(): string }): Promise<{ hash: string; ledger?: number }> {
    if (this.failAll) throw this.failAll;
    const xdr = tx.toXDR();
    const err = this.nextErrors.shift();
    if (err) throw err;
    this.submissions.push(xdr);
    // apply the effect: find created accounts and trustlines by decoding
    // would need the SDK; the tests instead apply effects through `apply`
    return { hash: `hash-${this.submissions.length.toString().padStart(4, '0')}`, ledger: 1000 + this.submissions.length };
  }
}

/** A signer that hands out predictable keys and signs nothing for real. */
export class FakeSigner implements Signer {
  keys = new Set<string>([SPONSOR]);
  private n = 0;
  async createAccountKey(): Promise<string> {
    this.n += 1;
    const id = Keypair.random().publicKey();
    this.keys.add(id);
    return id;
  }
  async canSignFor(accountId: string): Promise<boolean> {
    return this.keys.has(accountId);
  }
  async signTransaction(xdr: string): Promise<string> {
    return xdr;
  }
}

export function timeout(op = 'submitTransaction'): HorizonTimeoutError {
  return new HorizonTimeoutError(op, 15_000);
}

export function stores() {
  return { accountStore: new InMemoryAccountStore(), pinStore: new InMemoryPinStore() };
}
