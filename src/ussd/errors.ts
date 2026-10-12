/** Errors of the account view, mapped to screens by the machine. */
export class AccountNotOnChainError extends Error {
  constructor(readonly accountId: string) {
    super('the mapped account does not exist on this network');
    this.name = 'AccountNotOnChainError';
  }
}

export class NoUsdcTrustlineError extends Error {
  constructor(readonly accountId: string) {
    super('the account has no USDC trustline');
    this.name = 'NoUsdcTrustlineError';
  }
}

/**
 * Creation on dial refused by a cap: the sponsor's spendable XLM is below
 * the configured minimum, or the configured number of creations in the
 * last hour has been reached. The machine answers E3 (no account for this
 * number), never E4: the service is up, this number is not served today.
 */
export class CreationCappedError extends Error {
  readonly code = 'CREATION_CAPPED';
  constructor(readonly reason: 'sponsor_balance' | 'rate', detail: string) {
    super(detail);
    this.name = 'CreationCappedError';
  }
}

/**
 * Creation on dial refused because an earlier creation for this number is
 * still pending: its transaction can still be included until its time
 * bound passes, and the account is not on chain yet. The machine answers
 * E4 (service unavailable, try again later); a later dial adopts the
 * account once it appears, or creates afresh once the bound has passed.
 */
export class CreationPendingError extends Error {
  readonly code = 'CREATION_PENDING';
  constructor(readonly accountId: string, readonly expiresAt: string) {
    super(`a creation for this number is pending until ${expiresAt}`);
    this.name = 'CreationPendingError';
  }
}

