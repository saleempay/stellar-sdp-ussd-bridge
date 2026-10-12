/**
 * The account screen's data, read from Horizon: the USDC balance and the
 * most recent incoming USDC payment. Two reads in parallel, each under the
 * client's deadline (2.5 s in the server, the adapter's session leg
 * timeout).
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
 */
import { isHorizonNotFound } from 'stellar-ussd-sep10-adapter';
import type { HorizonAccountRecord, PaymentRecord } from '../provision/horizon.js';
import { AccountNotOnChainError, NoUsdcTrustlineError } from './errors.js';
import type { AccountView } from './screens.js';

export const PAYMENT_SCAN_LIMIT = 200;
const INCOMING_TYPES = new Set(['payment', 'path_payment_strict_receive', 'path_payment_strict_send']);

export interface AccountViewHorizon {
  loadAccount(accountId: string): Promise<HorizonAccountRecord>;
  paymentsFor(accountId: string, limit?: number): Promise<PaymentRecord[]>;
}

export interface AccountViewDeps {
  horizon: AccountViewHorizon;
  asset: { code: string; issuer: string };
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

export async function loadAccountView(deps: AccountViewDeps, accountId: string): Promise<AccountView> {
  let account: HorizonAccountRecord;
  let payments: PaymentRecord[];
  try {
    [account, payments] = await Promise.all([deps.horizon.loadAccount(accountId), deps.horizon.paymentsFor(accountId, PAYMENT_SCAN_LIMIT)]);
  } catch (err) {
    if (isHorizonNotFound(err)) throw new AccountNotOnChainError(accountId);
    throw err;
  }
  const usdc = account.balances.find((b) => b.asset_type === 'credit_alphanum4' && b.asset_code === deps.asset.code && b.asset_issuer === deps.asset.issuer);
  if (!usdc) throw new NoUsdcTrustlineError(accountId);
  const lastReceived = selectLastReceived(payments, accountId, deps.asset);
  return lastReceived ? { balance: usdc.balance, lastReceived } : { balance: usdc.balance };
}
