/**
 * A small Horizon client over `fetch`, implementing the adapter's
 * `HorizonLike` contract (vendor/stellar-ussd-sep10-adapter
 * src/accounts/horizon.ts) with a per-call deadline.
 *
 * Why not the SDK's `Horizon.Server`: the bridge and the adapter each carry
 * their own copy of `@stellar/stellar-sdk`, and this client lets no SDK
 * class cross that seam. It only needs `tx.toXDR()` from a transaction.
 *
 * Error shapes are chosen so the adapter's helpers recognise them:
 * a missing account throws an object with `status: 404`
 * (`isHorizonNotFound`), and a rejected submission throws an object with
 * `response.data.extras.result_codes` (`decodeSubmissionError`).
 * Horizon endpoints and fields: GET /accounts/{id} (`sequence`,
 * `balances`, `subentry_count`, `num_sponsoring`, `num_sponsored`) and
 * POST /transactions (`hash`, `ledger`; errors carry
 * `extras.result_codes`), per the Horizon API reference on
 * developers.stellar.org.
 */
import type { HorizonAccount, HorizonLike, SubmitResult } from 'stellar-ussd-sep10-adapter';
import { HorizonTimeoutError } from './errors.js';

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** One record of the payments endpoint (subset of fields). */
export interface PaymentRecord {
  type: string;
  created_at: string;
  transaction_hash: string;
  transaction_successful?: boolean;
  from?: string;
  to?: string;
  amount?: string;
  asset_type?: string;
  asset_code?: string;
  asset_issuer?: string;
  paging_token?: string;
}

/** One record of GET /transactions/{hash} (subset of fields). */
export interface TransactionRecord {
  hash: string;
  ledger: number;
  created_at: string;
  successful: boolean;
  source_account: string;
  operation_count: number;
  memo?: string;
  memo_type?: string;
}

export interface HorizonAccountRecord extends HorizonAccount {
  subentryCount: number;
  numSponsoring: number;
  numSponsored: number;
}

/** A non-2xx Horizon answer, shaped for the adapter's error helpers. */
export class HorizonResponseError extends Error {
  readonly status: number;
  readonly response: { status: number; data: unknown };
  constructor(operation: string, status: number, data: unknown) {
    super(`Horizon ${operation} returned HTTP ${status}`);
    this.name = 'HorizonResponseError';
    this.status = status;
    this.response = { status, data };
  }
}

export interface FetchHorizonOptions {
  fetch?: FetchLike;
  /** Deadline per call. Default 15 s. */
  timeoutMs?: number;
}

export const DEFAULT_HORIZON_TIMEOUT_MS = 15_000;

interface AccountJson {
  id: string;
  sequence: string;
  subentry_count: number;
  num_sponsoring: number;
  num_sponsored: number;
  balances: HorizonAccount['balances'];
}

export class FetchHorizon implements HorizonLike {
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  readonly baseUrl: string;

  constructor(baseUrl: string, opts: FetchHorizonOptions = {}) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.fetchImpl = opts.fetch ?? ((input, init) => fetch(input, init));
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_HORIZON_TIMEOUT_MS;
  }

  private async call(operation: string, path: string, init: RequestInit = {}): Promise<Response> {
    try {
      return await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        headers: { Accept: 'application/json', ...(init.headers as Record<string, string> | undefined) },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      const name = (err as { name?: string })?.name;
      if (name === 'TimeoutError' || name === 'AbortError') throw new HorizonTimeoutError(operation, this.timeoutMs);
      throw err;
    }
  }

  async loadAccount(accountId: string): Promise<HorizonAccountRecord> {
    const res = await this.call('loadAccount', `/accounts/${encodeURIComponent(accountId)}`);
    if (!res.ok) throw new HorizonResponseError('loadAccount', res.status, await res.json().catch(() => undefined));
    return toAccountRecord((await res.json()) as AccountJson);
  }

  async submitTransaction(tx: { toXDR(): string }): Promise<SubmitResult> {
    const body = new URLSearchParams({ tx: tx.toXDR() }).toString();
    const res = await this.call('submitTransaction', '/transactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const data = (await res.json().catch(() => undefined)) as { hash?: string; ledger?: number } | undefined;
    if (!res.ok || !data?.hash) throw new HorizonResponseError('submitTransaction', res.status, data);
    return { hash: data.hash, ...(data.ledger !== undefined ? { ledger: data.ledger } : {}) };
  }

  /**
   * Successful payment operations touching an account, newest first.
   * GET /accounts/{id}/payments?order=desc&limit=N (Horizon API; record
   * fields verified on testnet Horizon, 7 October 2026).
   */
  async paymentsFor(accountId: string, limit = 200): Promise<PaymentRecord[]> {
    const res = await this.call('payments', `/accounts/${encodeURIComponent(accountId)}/payments?order=desc&limit=${limit}`);
    if (!res.ok) throw new HorizonResponseError('payments', res.status, await res.json().catch(() => undefined));
    const page = (await res.json()) as { _embedded: { records: PaymentRecord[] } };
    return page._embedded.records;
  }

  /** GET /transactions/{hash}: the transaction record (Horizon API). */
  async transaction(hash: string): Promise<TransactionRecord> {
    const res = await this.call('transaction', `/transactions/${encodeURIComponent(hash)}`);
    if (!res.ok) throw new HorizonResponseError('transaction', res.status, await res.json().catch(() => undefined));
    return (await res.json()) as TransactionRecord;
  }

  /** GET /transactions/{hash}/operations: the operations of one transaction. */
  async operationsOf(hash: string): Promise<PaymentRecord[]> {
    const res = await this.call('operations', `/transactions/${encodeURIComponent(hash)}/operations?limit=200`);
    if (!res.ok) throw new HorizonResponseError('operations', res.status, await res.json().catch(() => undefined));
    const page = (await res.json()) as { _embedded: { records: PaymentRecord[] } };
    return page._embedded.records;
  }

  /** Number of transactions an account has made (for evidence only). */
  async countTransactions(accountId: string): Promise<number> {
    let cursor = '';
    let total = 0;
    for (;;) {
      const res = await this.call('transactions', `/accounts/${encodeURIComponent(accountId)}/transactions?limit=200&order=asc${cursor ? `&cursor=${cursor}` : ''}`);
      if (!res.ok) throw new HorizonResponseError('transactions', res.status, await res.json().catch(() => undefined));
      const page = (await res.json()) as { _embedded: { records: Array<{ paging_token: string }> } };
      const records = page._embedded.records;
      total += records.length;
      if (records.length < 200) return total;
      cursor = records[records.length - 1]!.paging_token;
    }
  }
}

export function toAccountRecord(json: AccountJson): HorizonAccountRecord {
  let sequence = BigInt(json.sequence);
  return {
    accountId: () => json.id,
    sequenceNumber: () => sequence.toString(),
    incrementSequenceNumber: () => {
      sequence += 1n;
    },
    balances: json.balances,
    subentryCount: json.subentry_count,
    numSponsoring: json.num_sponsoring,
    numSponsored: json.num_sponsored,
  };
}

/** XLM the account may spend: native balance less its minimum balance (base reserve 0.5 XLM). */
export function spendableXlm(account: HorizonAccountRecord): number {
  const native = account.balances.find((b) => b.asset_type === 'native');
  const balance = native ? Number(native.balance) : 0;
  const minimum = (2 + account.subentryCount + account.numSponsoring - account.numSponsored) * 0.5;
  return balance - minimum;
}
