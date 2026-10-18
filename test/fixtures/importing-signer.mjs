// A fake signer module that records the moment it is imported, by writing a
// marker file in the working directory. The order test uses it to show that
// scripts/provision.mjs never imports the deployment's signer module before
// the network has been accepted.
import { writeFileSync } from 'node:fs';
writeFileSync('signer-module-imported.txt', new Date().toISOString());
export function createSigner() {
  const sponsor = process.env.FAKE_SIGNER_SPONSOR ?? '';
  return {
    async createAccountKey() { return 'G'.padEnd(56, 'F'); },
    async canSignFor(accountId) { return accountId === sponsor; },
    async signTransaction(xdr) { return xdr; },
  };
}
