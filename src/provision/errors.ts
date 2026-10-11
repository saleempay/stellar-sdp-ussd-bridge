/**
 * Typed errors of the provisioning bridge: one class per failure, each with
 * a stable `code` and, for row failures, the input row index. Messages
 * carry masked phone numbers and masked accounts only.
 */
export class BridgeError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly rowIndex?: number,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** The input file is unusable as a whole (header, duplicates, amounts, the pin column). */
export class InputFileError extends BridgeError {
  constructor(message: string, rowIndex?: number) {
    super('input_file', message, rowIndex);
  }
}

/** The phone number is not canonical E.164 (adapter rule) or is repeated. */
export class InvalidPhoneNumberError extends BridgeError {
  constructor(rowIndex: number, detail: string) {
    super('invalid_phone', detail, rowIndex);
  }
}

/** The MSISDN to account mapping could not be read, written, or trusted. */
export class ResolverFailureError extends BridgeError {
  constructor(
    rowIndex: number,
    detail: string,
    readonly accountId?: string,
    options?: { cause?: unknown },
  ) {
    super('resolver_failure', detail, rowIndex, options);
  }
}

/** The sponsor cannot pay for what the run needs (preflight or network result). */
export class SponsorUnderfundedError extends BridgeError {
  constructor(
    detail: string,
    readonly requiredXlm?: string,
    readonly spendableXlm?: string,
    rowIndex?: number,
  ) {
    super('sponsor_underfunded', detail, rowIndex);
  }
}

/**
 * The mapped account needs a trustline and the configured signer cannot
 * sign for it. With the reference signer this is the normal state of every
 * account provisioned in an earlier run: keys are not kept between runs,
 * so such accounts are receive-only and nothing can be added to them from
 * the command line. Reported as its own code, never as trustline_failure.
 */
export class SignerUnavailableForAccountError extends BridgeError {
  constructor(
    rowIndex: number,
    readonly accountId: string,
    detail: string,
  ) {
    super('signer_unavailable', detail, rowIndex);
  }
}

/** The trustline operation was rejected by the network. */
export class TrustlineFailureError extends BridgeError {
  constructor(
    rowIndex: number,
    detail: string,
    readonly transactionResultCode?: string,
    readonly operationResultCodes?: string[],
    options?: { cause?: unknown },
  ) {
    super('trustline_failure', detail, rowIndex, options);
  }
}

/** A Horizon call did not answer within its deadline. */
export class HorizonTimeoutError extends BridgeError {
  constructor(
    readonly operation: string,
    readonly timeoutMs: number,
    rowIndex?: number,
  ) {
    super('horizon_timeout', `Horizon ${operation} did not answer within ${timeoutMs} ms`, rowIndex);
  }
}

/**
 * The creation was submitted, the network gave no verdict (timeout, 5xx,
 * no result codes), and the account could not be checked on chain either.
 * The row carries the account id so the operator can reconcile; the
 * pending record is kept for the next run to check.
 */
export class CreationUncertainError extends BridgeError {
  constructor(
    rowIndex: number,
    readonly accountId: string,
    detail: string,
  ) {
    super('creation_uncertain', detail, rowIndex);
  }
}

/** The optional PIN input for a row is malformed or on the weak list. */
export class PinInputError extends BridgeError {
  constructor(rowIndex: number, detail: string) {
    super('pin_input', detail, rowIndex);
  }
}

/** Result codes that mean the sponsor, not the recipient, lacked funds or reserve. */
export const UNDERFUNDED_RESULT_CODES = new Set([
  'tx_insufficient_balance',
  'tx_insufficient_fee',
  'op_underfunded',
  'op_low_reserve',
]);
