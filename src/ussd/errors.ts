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
