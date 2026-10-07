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
