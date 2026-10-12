/**
 * The provisioning pipeline: for each phone number, make sure a Stellar
 * account with a USDC trustline exists and is bound to the number, then
 * produce the SDP disbursement rows. Everything on chain goes through the
 * adapter (sponsored creation, sponsored trustline, the signer seam); the
 * MSISDN mapping and the PIN hashes live in the adapter's stores.
 *
 * Idempotency, by key:
 * - account: the MSISDN in the account store, checked against Horizon
 * - trustline: `accountHasTrustline` on the loaded account
 * - PIN: a record in the PIN store is never replaced
 * - output: a pure function of the rows and the stores
 *
 * Ambiguous submissions: a creation whose submission times out, or that
 * Horizon answers with a 5xx or without result codes, may have landed. A
 * pending record (number, account) is written before the submission; on
 * such a failure the account is read from Horizon before the row fails.
 * Exists: adopted as created. Absent: the row fails as before. Unreadable:
 * the row is `uncertain`, carries the account id, and the pending record
 * stays so the next run checks it first instead of creating again.
 *
 * Rows run one after another (the sponsor's sequence number serialises
 * them anyway). A failing row is reported and the next row runs.
 */
import {
  AccountNotFoundError,
  InvalidMsisdnError,
  RegistrationFailedError,
  TransactionFailedError,
  TrustlineMissingError,
  accountHasTrustline,
  addSponsoredTrustline,
  createSponsoredAccount,
  establishPin,
  hasPin,
  isHorizonNotFound,
  isWeakPin,
  isWellFormedPin,
  normalizeMsisdn,
  type AccountStore,
  type HorizonLike,
  type PinStore,
  type Signer,
} from 'stellar-ussd-sep10-adapter';
import {
  BridgeError,
  CHANGE_TRUST_RESULT_CODES,
  CreationUncertainError,
  HorizonTimeoutError,
  InvalidPhoneNumberError,
  PinInputError,
  ResolverFailureError,
  SignerUnavailableForAccountError,
  SponsorUnderfundedError,
  TrustlineFailureError,
  UNDERFUNDED_RESULT_CODES,
} from './errors.js';
import { HorizonResponseError, spendableXlm, type HorizonAccountRecord } from './horizon.js';
import { CREATION_TIMEOUT_SECONDS, landingDeadline, pendingMayStillLand, type PendingCreationStore } from './pending.js';
import { maskPhone, type InputRow, type ProvisionReport, type RowOutcome, type SdpRow } from './types.js';
import { maskAccount } from '../sdp/facts.js';

export interface ProvisionDeps {
  horizon: HorizonLike;
  signer: Signer;
  accountStore: AccountStore;
  /** Needed only when rows carry a PIN. */
  pinStore?: PinStore;
  /** Pending creations, checked before creating and written before submitting. Strongly recommended; see pending.ts. */
  pendingStore?: PendingCreationStore;
  sponsorPublicKey: string;
  asset: { code: string; issuer: string };
  networkPassphrase: string;
  /** Prefix for the SDP paymentID column, typically the input file stem. */
  paymentIdPrefix: string;
  /**
   * Time bound set on each creation transaction, seconds
   * (CREATION_TIMEOUT_SECONDS when omitted). After an ambiguous
   * submission the row stays `uncertain`, and no new creation for the
   * number starts, until this bound plus a grace has passed; see
   * pending.ts.
   */
  creationTimeoutSeconds?: number;
  /** Clock, for tests. */
  now?: () => number;
  /**
   * XLM the sponsor must be able to spend per new account with its
   * trustline. 1.5 XLM at the current base reserve (1.0 for the account,
   * 0.5 for the trustline subentry), as measured in the adapter's evidence.
   */
  xlmPerNewAccount?: number;
  /** XLM per sponsored trustline on an existing account. */
  xlmPerTrustline?: number;
  /** Fee allowance per transaction, XLM. */
  xlmFeeMargin?: number;
}

export const DEFAULT_XLM_PER_NEW_ACCOUNT = 1.5;
export const DEFAULT_XLM_PER_TRUSTLINE = 0.5;
export const DEFAULT_XLM_FEE_MARGIN = 0.01;

/**
 * A Horizon deadline, either as thrown by the bridge's client or as wrapped
 * by the adapter: `createSponsoredAccount` and `addSponsoredTrustline` pass
 * every submission failure through `decodeSubmissionError`, which turns a
 * non-Horizon error into a `TransactionFailedError` carrying the original
 * message and no result codes. The message of HorizonTimeoutError is
 * distinctive, so it is recovered from there.
 */
function asTimeout(err: unknown): HorizonTimeoutError | undefined {
  if (err instanceof HorizonTimeoutError) return err;
  if (err instanceof TransactionFailedError && !err.transactionResultCode) {
    const m = /Horizon (\w+) did not answer within (\d+) ms/.exec(err.message);
    if (m) return new HorizonTimeoutError(m[1]!, Number(m[2]));
  }
  return undefined;
}

function isTimeout(err: unknown): err is HorizonTimeoutError {
  return asTimeout(err) !== undefined;
}

function resultCodes(err: unknown): string[] {
  if (err instanceof TransactionFailedError) {
    return [err.transactionResultCode ?? '', ...(err.operationResultCodes ?? [])].filter(Boolean);
  }
  return [];
}

function underfunded(err: unknown): boolean {
  return resultCodes(err).some((c) => UNDERFUNDED_RESULT_CODES.has(c));
}

/**
 * The network rejected the change_trust operation: a code only that
 * operation produces is present, wherever the adapter placed the operation.
 * (op_no_trust is the adapter's TrustlineMissingError and is handled by
 * type.)
 */
function changeTrustRejected(err: unknown): boolean {
  return resultCodes(err).some((c) => CHANGE_TRUST_RESULT_CODES.has(c));
}

/**
 * The network gave no verdict: a deadline, a Horizon 5xx, or a submission
 * failure that carries no result codes. The transaction may have landed.
 * (The adapter wraps a non-Horizon submission error into a
 * TransactionFailedError without codes, so that case is read from the
 * absence of codes.)
 */
export function isNonDefinitiveSubmission(err: unknown): boolean {
  if (isTimeout(err)) return true;
  if (err instanceof HorizonResponseError) return err.status >= 500;
  if (err instanceof TransactionFailedError) {
    return !err.transactionResultCode && !(err.operationResultCodes ?? []).length;
  }
  return false;
}

type Probe = 'exists' | 'absent' | 'unknown';

/** Whether an account exists on chain; `unknown` when Horizon could not be read. */
async function probeAccount(deps: ProvisionDeps, accountId: string): Promise<Probe> {
  try {
    await deps.horizon.loadAccount(accountId);
    return 'exists';
  } catch (err) {
    return isHorizonNotFound(err) ? 'absent' : 'unknown';
  }
}

function describe(err: unknown): string {
  const m = err instanceof Error ? err.message : String(err);
  return m.length > 120 ? `${m.slice(0, 120)}...` : m;
}

function uncertain(base: RowOutcome, accountId: string, detail: string): RowOutcome {
  const e = new CreationUncertainError(base.rowIndex, accountId, detail);
  return { ...base, status: 'uncertain', accountId, accountMasked: maskAccount(accountId), errorCode: e.code, message: e.message };
}

/**
 * Refuse the whole run before any transaction when the sponsor cannot pay
 * for the worst case: every unmapped row a new account, every mapped row a
 * trustline.
 */
export async function preflightSponsor(rows: InputRow[], deps: ProvisionDeps): Promise<{ requiredXlm: number; spendable: number }> {
  let account: HorizonAccountRecord;
  try {
    account = (await deps.horizon.loadAccount(deps.sponsorPublicKey)) as HorizonAccountRecord;
  } catch (err) {
    if (isTimeout(err)) throw err;
    if (isHorizonNotFound(err)) throw new SponsorUnderfundedError(`sponsor ${maskAccount(deps.sponsorPublicKey)} does not exist on this network`);
    throw new SponsorUnderfundedError(`sponsor ${maskAccount(deps.sponsorPublicKey)} could not be read: ${(err as Error).message}`);
  }
  const perAccount = deps.xlmPerNewAccount ?? DEFAULT_XLM_PER_NEW_ACCOUNT;
  const perTrustline = deps.xlmPerTrustline ?? DEFAULT_XLM_PER_TRUSTLINE;
  const fee = deps.xlmFeeMargin ?? DEFAULT_XLM_FEE_MARGIN;
  let required = 0;
  for (const row of rows) {
    let mapped = false;
    try {
      mapped = (await deps.accountStore.get(normalizeMsisdn(row.phone))) !== undefined;
    } catch {
      // an unreadable mapping or a bad phone is reported per row later
    }
    required += (mapped ? perTrustline : perAccount) + fee;
  }
  const spendable = typeof account.subentryCount === 'number' ? spendableXlm(account) : Number(account.balances.find((b) => b.asset_type === 'native')?.balance ?? 0);
  if (spendable < required) {
    throw new SponsorUnderfundedError(
      `sponsor ${maskAccount(deps.sponsorPublicKey)} can spend ${spendable.toFixed(7)} XLM but the run may need ${required.toFixed(7)} XLM`,
      required.toFixed(7),
      spendable.toFixed(7),
    );
  }
  return { requiredXlm: required, spendable };
}

async function bindPin(row: InputRow, msisdn: string, deps: ProvisionDeps): Promise<{ pin: RowOutcome['pin']; error?: PinInputError }> {
  if (row.pin === undefined) return { pin: 'none' };
  if (!deps.pinStore) return { pin: 'refused', error: new PinInputError(row.rowIndex, 'a PIN was supplied but no PIN store is configured') };
  const policy = { store: deps.pinStore };
  if (await hasPin(policy, msisdn)) return { pin: 'kept' };
  if (!isWellFormedPin(row.pin)) return { pin: 'refused', error: new PinInputError(row.rowIndex, 'PIN must be exactly four digits') };
  if (isWeakPin(row.pin)) return { pin: 'refused', error: new PinInputError(row.rowIndex, 'PIN is on the weak list') };
  await establishPin(policy, msisdn, row.pin);
  return { pin: 'set' };
}

async function provisionRow(row: InputRow, deps: ProvisionDeps): Promise<RowOutcome> {
  const base: RowOutcome = { rowIndex: row.rowIndex, phoneMasked: maskPhone(row.phone), status: 'failed', pin: 'none' };
  let msisdn: string;
  try {
    msisdn = normalizeMsisdn(row.phone);
  } catch (err) {
    const e = err instanceof InvalidMsisdnError ? new InvalidPhoneNumberError(row.rowIndex, 'phone must be E.164: a plus sign and 8 to 15 digits') : err;
    return fail(base, e);
  }
  base.phoneMasked = maskPhone(msisdn);

  let accountId: string | undefined;
  try {
    accountId = await deps.accountStore.get(msisdn);
  } catch (err) {
    return fail(base, new ResolverFailureError(row.rowIndex, `account store read failed: ${(err as Error).message}`, undefined, { cause: err }));
  }

  if (accountId) {
    base.accountId = accountId;
    base.accountMasked = maskAccount(accountId);
    let account;
    try {
      account = await deps.horizon.loadAccount(accountId);
    } catch (err) {
      const t = asTimeout(err);
      if (t) return fail(base, new HorizonTimeoutError(t.operation, t.timeoutMs, row.rowIndex));
      if (isHorizonNotFound(err)) {
        return fail(base, new ResolverFailureError(row.rowIndex, `the mapped account ${maskAccount(accountId)} is not on chain (testnet reset?); the mapping was left in place for reconciliation`, accountId));
      }
      return fail(base, new ResolverFailureError(row.rowIndex, `Horizon could not read ${maskAccount(accountId)}: ${(err as Error).message}`, accountId, { cause: err }));
    }
    if (accountHasTrustline(account, deps.asset)) {
      base.status = 'unchanged';
    } else {
      // The trustline needs the account's own signature. The reference
      // signer forgets keys when the process ends, so for an account
      // provisioned in an earlier run this path is unavailable and says so;
      // it is not a network failure.
      if (!(await deps.signer.canSignFor(accountId))) {
        return fail(base, new SignerUnavailableForAccountError(row.rowIndex, accountId, `the mapped account ${maskAccount(accountId)} has no ${deps.asset.code} trustline and the configured signer cannot sign for it; with the reference signer, accounts provisioned by this bridge are receive-only and their keys are not kept between runs, so a trustline cannot be added later; supply a Signer that holds the key`));
      }
      try {
        const result = await addSponsoredTrustline({
          horizon: deps.horizon,
          networkPassphrase: deps.networkPassphrase,
          sponsorPublicKey: deps.sponsorPublicKey,
          accountId,
          signer: deps.signer,
          asset: deps.asset,
        });
        if (result === undefined) {
          // the adapter found the trustline already present (it re-reads the account)
          base.status = 'unchanged';
        } else {
          base.status = 'trustline_added';
          base.txHash = result.hash;
          if (result.ledger !== undefined) base.ledger = result.ledger;
        }
      } catch (err) {
        return fail(base, trustlineError(row.rowIndex, err));
      }
    }
  } else {
    let newAccountId: string | undefined;
    let adopted = false;
    let note: string | undefined;

    // A pending record from an earlier run names an account that may exist.
    // Standard Stellar handling of an unanswered submission: the transaction
    // may still be included until its time bound passes, and the same
    // transaction cannot be applied twice, so nothing new is submitted for
    // the number until the account appears or the bound has passed
    // (developers.stellar.org, Horizon "Timeout" and "Error Handling"
    // pages, read 12 October 2026: a timeout means Horizon does not know
    // whether core discarded the transaction; with time bounds it either
    // makes it onto the ledger exactly once or times out).
    const nowMs = deps.now?.() ?? Date.now();
    const pending = await deps.pendingStore?.get(msisdn);
    if (pending) {
      const probe = await probeAccount(deps, pending.accountId);
      if (probe === 'exists') {
        newAccountId = pending.accountId;
        adopted = true;
        note = `adopted from the pending record of ${pending.at}: the creation had landed; the transaction hash is not known`;
      } else if (probe === 'unknown') {
        return uncertain(base, pending.accountId, `the pending record of ${pending.at} names this account and Horizon could not be read to confirm it; reconcile or re-run when Horizon answers`);
      } else if (pendingMayStillLand(pending, nowMs)) {
        return uncertain(base, pending.accountId, `the creation recorded at ${pending.at} is not on chain yet but its transaction can still land until ${pending.expiresAt ?? 'its time bound passes'}; no new creation starts for this number before then; re-run after it`);
      } else {
        // the time bound has passed and the account is absent: it did not land
        await deps.pendingStore?.delete(msisdn);
      }
    }

    if (!adopted) {
      try {
        newAccountId = await deps.signer.createAccountKey();
        await deps.pendingStore?.put(msisdn, { accountId: newAccountId, at: new Date(nowMs).toISOString() });
        const result = await createSponsoredAccount({
          horizon: deps.horizon,
          networkPassphrase: deps.networkPassphrase,
          sponsorPublicKey: deps.sponsorPublicKey,
          newAccountId,
          signer: deps.signer,
          asset: deps.asset,
          timeoutSeconds: deps.creationTimeoutSeconds ?? CREATION_TIMEOUT_SECONDS,
        });
        base.txHash = result.hash;
        if (result.ledger !== undefined) base.ledger = result.ledger;
      } catch (err) {
        if (newAccountId !== undefined && isNonDefinitiveSubmission(err)) {
          // The transaction was built no later than this moment, so its
          // time bound ends no later than now plus the bound; the pending
          // record holds until then plus the grace.
          const expiresAt = landingDeadline(deps.now?.() ?? Date.now(), deps.creationTimeoutSeconds ?? CREATION_TIMEOUT_SECONDS);
          const probe = await probeAccount(deps, newAccountId);
          if (probe === 'exists') {
            adopted = true;
            note = `confirmed on chain after an ambiguous submission (${describe(err)}); the transaction hash is not known`;
          } else {
            await deps.pendingStore?.put(msisdn, { accountId: newAccountId, at: new Date(nowMs).toISOString(), expiresAt });
            if (probe === 'unknown') {
              return uncertain(base, newAccountId, `ambiguous submission (${describe(err)}) and Horizon could not be read to confirm the account; reconcile or re-run when Horizon answers`);
            }
            // absent now is "not yet": the transaction can still land until expiresAt
            return uncertain(base, newAccountId, `ambiguous submission (${describe(err)}); the account is not on chain yet but the transaction can still land until ${expiresAt}; no new creation starts for this number before then; re-run after it`);
          }
        }
        if (!adopted) {
          if (newAccountId !== undefined) await deps.pendingStore?.delete(msisdn);
          const t = asTimeout(err);
          if (t) return fail(base, new HorizonTimeoutError(t.operation, t.timeoutMs, row.rowIndex));
          if (err instanceof AccountNotFoundError) return fail(base, new SponsorUnderfundedError(`sponsor ${maskAccount(deps.sponsorPublicKey)} does not exist on this network`, undefined, undefined, row.rowIndex));
          if (underfunded(err)) return fail(base, new SponsorUnderfundedError(`network rejected the creation: ${resultCodes(err).join(', ')}`, undefined, undefined, row.rowIndex));
          if (err instanceof TrustlineMissingError || changeTrustRejected(err)) {
            return fail(base, trustlineError(row.rowIndex, err));
          }
          return fail(base, new ResolverFailureError(row.rowIndex, `account creation failed: ${(err as Error).message}`, undefined, { cause: err }));
        }
      }
    }

    base.accountId = newAccountId;
    base.accountMasked = maskAccount(newAccountId);
    try {
      await deps.accountStore.put(msisdn, newAccountId!);
    } catch (err) {
      // the pending record stays: the next run adopts the account from it
      const e = new RegistrationFailedError(newAccountId!, msisdn, err);
      return fail(base, new ResolverFailureError(row.rowIndex, `account ${maskAccount(newAccountId)} was created on chain but the mapping could not be written; reconcile before re-running`, newAccountId, { cause: e }));
    }
    await deps.pendingStore?.delete(msisdn);
    base.status = 'created';
    if (note) base.message = note;
  }

  const pinResult = await bindPin(row, msisdn, deps);
  base.pin = pinResult.pin;
  if (pinResult.error) {
    base.errorCode = pinResult.error.code;
    base.message = pinResult.error.message;
  }
  return base;
}

function trustlineError(rowIndex: number, err: unknown): BridgeError {
  const t = asTimeout(err);
  if (t) return new HorizonTimeoutError(t.operation, t.timeoutMs, rowIndex);
  if (underfunded(err)) return new SponsorUnderfundedError(`network rejected the trustline: ${resultCodes(err).join(', ')}`, undefined, undefined, rowIndex);
  if (err instanceof TransactionFailedError) {
    return new TrustlineFailureError(rowIndex, err.message, err.transactionResultCode, err.operationResultCodes, { cause: err });
  }
  return new TrustlineFailureError(rowIndex, `trustline could not be added: ${(err as Error).message}`, undefined, undefined, { cause: err });
}

function fail(base: RowOutcome, err: unknown): RowOutcome {
  const e = err instanceof BridgeError ? err : new ResolverFailureError(base.rowIndex, (err as Error)?.message ?? String(err));
  return { ...base, status: 'failed', errorCode: e.code, message: e.message };
}

export async function provisionRecipients(rows: InputRow[], deps: ProvisionDeps): Promise<ProvisionReport> {
  await preflightSponsor(rows, deps);
  const outcomes: RowOutcome[] = [];
  const sdpRows: SdpRow[] = [];
  for (const row of rows) {
    const outcome = await provisionRow(row, deps);
    outcomes.push(outcome);
    if (outcome.status !== 'failed' && outcome.status !== 'uncertain' && outcome.accountId) {
      sdpRows.push({
        phone: normalizeMsisdn(row.phone),
        walletAddress: outcome.accountId,
        walletAddressMemo: '',
        id: row.id,
        amount: row.amount,
        paymentID: `${deps.paymentIdPrefix}-${row.id}`,
      });
    }
  }
  const counts = {
    created: outcomes.filter((o) => o.status === 'created').length,
    trustlineAdded: outcomes.filter((o) => o.status === 'trustline_added').length,
    unchanged: outcomes.filter((o) => o.status === 'unchanged').length,
    failed: outcomes.filter((o) => o.status === 'failed').length,
    uncertain: outcomes.filter((o) => o.status === 'uncertain').length,
    pinRefused: outcomes.filter((o) => o.pin === 'refused').length,
  };
  return { outcomes, counts, sdpRows };
}

/** Fixed-width report for the terminal and EVIDENCE.md. Full hashes, masked phones and accounts. */
export function formatProvisionReport(report: ProvisionReport): string {
  const lines = report.outcomes.map((o) =>
    [
      String(o.rowIndex).padStart(3),
      o.phoneMasked.padEnd(14),
      o.status.padEnd(15),
      (o.accountMasked ?? '').padEnd(12),
      `pin:${o.pin}`.padEnd(12),
      o.txHash ? `tx ${o.txHash}${o.ledger ? ` ledger ${o.ledger}` : ''}` : '',
      o.errorCode ? `${o.errorCode}: ${o.message}` : (o.message ?? ''),
    ].join('  ').trimEnd(),
  );
  const c = report.counts;
  lines.push(`created ${c.created}, trustline added ${c.trustlineAdded}, unchanged ${c.unchanged}, failed ${c.failed}, uncertain ${c.uncertain}, pin refused ${c.pinRefused}`);
  return lines.join('\n');
}
