/**
 * The account screen's data, read from Horizon: the USDC balance and the
 * most recent incoming USDC payment. Two reads in parallel, each under the
 * client's deadline (2.5 s in the server, the adapter's session leg
 * timeout), with one retry inside the session's time budget.
 *
 * Incoming payment rule: the newest successful operation of type payment,
 * path_payment_strict_receive or path_payment_strict_send whose `to` is
 * the account and whose asset is USDC from the pinned issuer. The SDP pays
 * classic accounts with a payment operation
 * (internal/transactionsubmission/payment_transaction_handler.go:69 at
 * 7.0.0). create_account records (XLM) and outgoing payments are skipped.
 * Scan depth: one page of 200 records, the Horizon maximum; an account
 * with more than 200 newer operations that are not incoming USDC shows
 * "No payments received yet" (documented for adopters).
 *
 * Retry (11 October 2026 finding, EVIDENCE.md "Finding while running"):
 * one account read failed with the runtime's fetch TypeError (a transport
 * failure, neither a timeout nor a Horizon status) and the same two reads
 * succeeded 14 seconds later, so the caller saw E4 for a fault that was
 * over by the next dial. The read is now attempted a second time, once,
 * after {@link VIEW_RETRY_PAUSE_MS}, when the failure is a transport
 * failure (fetch TypeError, a deadline, anything without an HTTP status)
 * or a 5xx answer. A 4xx answer is never retried: a 404 is the account
 * not being on chain, and every other 4xx is a request Horizon has
 * understood and refused. The retry happens only if a full second attempt
 * fits the budget: elapsed plus the pause plus one leg timeout must stay
 * within {@link VIEW_BUDGET_MS}.
 *
 * Time budget: the gateway expects every callback answered within 10
 * seconds (Africa's Talking USSD documentation, "the expected response
 * time from your application is at most 10 seconds"); the adapter's
 * listener answers a busy screen at 8.5 seconds (DEFAULT_WATCHDOG_MS,
 * adapter src/ussd/gateway/http.ts); the PIN verification (scrypt) and the
 * response path run in the same callback before and after this read. The
 * budget is therefore 7 seconds, and with a 2.5 second leg and a 1 second
 * pause the worst case is 2.5 + 1 + 2.5 = 6 seconds.
 */
import { isHorizonNotFound } from 'stellar-ussd-sep10-adapter';
import type { HorizonAccountRecord, PaymentRecord } from '../provision/horizon.js';
import { AccountNotOnChainError, NoUsdcTrustlineError } from './errors.js';
import type { AccountView } from './screens.js';

export const PAYMENT_SCAN_LIMIT = 200;
/** Pause before the single retry of the account read. */
export const VIEW_RETRY_PAUSE_MS = 1_000;
/** Whole-read budget, both attempts and the pause included; see the file comment. */
export const VIEW_BUDGET_MS = 7_000;
/** Per-leg deadline assumed when the caller names none (the adapter's session leg timeout). */
export const DEFAULT_LEG_TIMEOUT_MS = 2_500;
const INCOMING_TYPES = new Set(['payment', 'path_payment_strict_receive', 'path_payment_strict_send']);

export interface AccountViewHorizon {
  loadAccount(accountId: string): Promise<HorizonAccountRecord>;
  paymentsFor(accountId: string, limit?: number): Promise<PaymentRecord[]>;
}

export interface AccountViewDeps {
  horizon: AccountViewHorizon;
  asset: { code: string; issuer: string };
  /** Per-leg deadline of the Horizon client, so the retry decision knows what a second attempt costs. */
  legTimeoutMs?: number;
  /** Whole-read budget override (tests). */
  budgetMs?: number;
  /** Pause override (tests). */
  retryPauseMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Event sink: event codes and error codes only, never user data. */
  log?: (line: string) => void;
}

/** What a failed read looked like, for the log line and the retry decision. Never carries user data. */
export interface ReadFailure {
  /** The error's own code, else its class name (a fetch TypeError, a Horizon answer's Error). */
  code: string;
  /** HTTP status when the failure is a Horizon answer. */
  status?: number;
  /** The cause's code when it differs from `code` (for example the socket error under a fetch TypeError). */
  causeCode?: string;
}

function codeOf(x: unknown): string | undefined {
  const c = (x as { code?: unknown })?.code;
  return typeof c === 'string' || typeof c === 'number' ? String(c) : undefined;
}

export function describeReadFailure(err: unknown): ReadFailure {
  const status = (err as { status?: unknown })?.status;
  const own = codeOf(err);
  const cause = (err as { cause?: unknown })?.cause;
  const causeCode = codeOf(cause) ?? ((cause as { name?: string })?.name && (cause as { name?: string }).name !== 'Error' ? (cause as { name?: string }).name : undefined);
  const code = own ?? (err as { name?: string })?.name ?? 'unknown';
  const out: ReadFailure = { code };
  if (typeof status === 'number') out.status = status;
  if (causeCode !== undefined && causeCode !== code) out.causeCode = causeCode;
  return out;
}

/** The log fragment for a read failure: `code=... [status=...] [cause=...]`. */
export function formatReadFailure(f: ReadFailure): string {
  return `code=${f.code}${f.status !== undefined ? ` status=${f.status}` : ''}${f.causeCode !== undefined ? ` cause=${f.causeCode}` : ''}`;
}

/**
 * Transport failures and 5xx answers are retried; anything with a 4xx
 * status is not. A failure without an HTTP status is a transport failure:
 * the runtime's fetch TypeError, the client's deadline, a DNS or socket
 * error.
 */
export function isRetryableReadFailure(err: unknown): boolean {
  if (isHorizonNotFound(err)) return false;
  const status = (err as { status?: unknown })?.status;
  if (typeof status === 'number') return status >= 500;
  return true;
}

/** The final failure of the account read: the last error, with the attempt count and its description. */
export class AccountReadError extends Error {
  readonly attempts: number;
  readonly failure: ReadFailure;
  constructor(cause: unknown, attempts: number) {
    const failure = describeReadFailure(cause);
    super(`account read failed after ${attempts} attempt${attempts === 1 ? '' : 's'}: ${(cause as Error)?.message ?? String(cause)}`, { cause });
    this.name = 'AccountReadError';
    this.attempts = attempts;
    this.failure = failure;
  }
}

export function selectLastReceived(records: PaymentRecord[], accountId: string, asset: { code: string; issuer: string }): AccountView['lastReceived'] {
  const hit = records.find(
    (r) =>
      INCOMING_TYPES.has(r.type) &&
      r.to === accountId &&
      r.transaction_successful !== false &&
      r.asset_type === 'credit_alphanum4' &&
      r.asset_code === asset.code &&
      r.asset_issuer === asset.issuer &&
      typeof r.amount === 'string',
  );
  return hit ? { amount: hit.amount!, createdAt: hit.created_at } : undefined;
}

async function readOnce(deps: AccountViewDeps, accountId: string): Promise<[HorizonAccountRecord, PaymentRecord[]]> {
  return Promise.all([deps.horizon.loadAccount(accountId), deps.horizon.paymentsFor(accountId, PAYMENT_SCAN_LIMIT)]);
}

export async function loadAccountView(deps: AccountViewDeps, accountId: string): Promise<AccountView> {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const log = deps.log ?? (() => undefined);
  const leg = deps.legTimeoutMs ?? DEFAULT_LEG_TIMEOUT_MS;
  const budget = deps.budgetMs ?? VIEW_BUDGET_MS;
  const pause = deps.retryPauseMs ?? VIEW_RETRY_PAUSE_MS;
  const start = now();
  let account: HorizonAccountRecord;
  let payments: PaymentRecord[];
  let attempts = 0;
  for (;;) {
    attempts += 1;
    try {
      [account, payments] = await readOnce(deps, accountId);
      break;
    } catch (err) {
      if (isHorizonNotFound(err)) throw new AccountNotOnChainError(accountId);
      const fits = now() - start + pause + leg <= budget;
      if (attempts === 1 && isRetryableReadFailure(err) && fits) {
        log(`event=viewRetry ${formatReadFailure(describeReadFailure(err))} pauseMs=${pause}`);
        await sleep(pause);
        continue;
      }
      throw new AccountReadError(err, attempts);
    }
  }
  const usdc = account.balances.find((b) => b.asset_type === 'credit_alphanum4' && b.asset_code === deps.asset.code && b.asset_issuer === deps.asset.issuer);
  if (!usdc) throw new NoUsdcTrustlineError(accountId);
  const lastReceived = selectLastReceived(payments, accountId, deps.asset);
  return lastReceived ? { balance: usdc.balance, lastReceived } : { balance: usdc.balance };
}
