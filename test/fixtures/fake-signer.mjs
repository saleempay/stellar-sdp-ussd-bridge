// A fake signer module for the loader tests. It signs nothing for real and
// knows exactly one sponsor account, given through FAKE_SIGNER_SPONSOR.
export function createSigner() {
  const sponsor = process.env.FAKE_SIGNER_SPONSOR ?? '';
  return {
    async createAccountKey() { return 'G'.padEnd(56, 'F'); },
    async canSignFor(accountId) { return accountId === sponsor; },
    async signTransaction(xdr) { return xdr; },
  };
}
export const notASigner = { createAccountKey() {} };
