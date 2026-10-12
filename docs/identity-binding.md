# Identity binding on the wallet-address route

This page states what the Stellar Disbursement Platform (SDP) checks on the
wallet-address route, what this bridge does, and what an adopter must add
before using it with real people. It makes no legal claims; it describes
behaviour of the software as read from its source at SDP tag 7.0.0.

## What the SDP does on this route

With the registration contact type `PHONE_NUMBER_AND_WALLET_ADDRESS`, the
disbursement file carries a phone number and a Stellar address per row.
At upload the SDP creates the receiver, binds the address to it and marks
the receiver wallet `REGISTERED` straight away
(`internal/data/disbursement_instructions.go:160-197`). No invitation is
sent, no one-time code is checked, no date of birth or national id is
compared: the `verification` column is refused for this contact type
(`internal/serve/httphandler/disbursement_handler.go:837-900`). The SDP
trusts the file. Whoever produces the file is the party that bound the
phone number to the address.

Two protections the SDP does keep: an address already bound to another
receiver is refused (duplicate), and a known receiver whose row names a
different address is refused (mismatch), both in the same source range.

## What this bridge does

For each phone number in the operator's input:

1. normalises the number to E.164 and refuses anything else;
2. looks the number up in its account store; when nothing is mapped, asks
   the signer for a new key, creates the account on testnet with the
   sponsor paying the reserves, and opens the USDC trustline in the same
   transaction; when an account is mapped but has no trustline, adds one
   only if the signer can sign for that account (with the reference
   signer it cannot, and the row reports `signer_unavailable`);
3. records the mapping phone number to account in the account store;
4. writes the SDP row with that address.

That is the whole binding: a phone number, an account the bridge created,
and a line in a file. The bridge does not know who holds the phone.

## Receive-only with the reference signer

Accounts provisioned by this bridge are receive-only while the reference
signer is in use. The reference `LocalKeypairSigner` generates each
recipient key in process memory and forgets it when the command exits;
nothing in this repository exports, persists or recovers those keys, and
no other signer ships here. The consequences, stated plainly:

- **Receiving works.** The SDP pays the account's USDC trustline, and the
  USSD service (Deliverable 3) reads the balance and the last payment from
  Horizon. Neither needs a signature from the account.
- **Nothing can be signed for the account afterwards.** SEP-10
  authentication, any outbound payment, a later trustline, or a merge of
  the account all need the account's key, which no later process holds.
- **The trustline repair path is unavailable.** When a mapped account has
  no USDC trustline, the command reports `signer_unavailable` for that row
  and submits nothing. It does not fail as a network error. (This path
  only works when a `Signer` that holds the account key is supplied.)
- **Sponsor reserves stay locked.** Each provisioned account holds about
  1.5 XLM of the sponsor's reserve (two base reserves and one trustline
  subentry); with no key the account cannot be merged and the
  sponsorship cannot be transferred back. The sponsor preflight budgets
  for creation only, not for reclaiming.

A deployment that needs any of the above supplies a `Signer` whose keys
live in its own protected boundary (see "What an adopter must add"), and
carries that decision into Deliverables 3 and 4: the USSD menu and the
batch in this repository are designed around receive-only accounts.

## PINs

The bridge does not set a PIN by default. The recipient sets their PIN on
their first USSD dial (Deliverable 3). The PIN gates the account screen
today; it becomes the recipient's consent to sign only once a deployment
supplies a signer that holds the account key, which the reference signer
does not (see above). The `pin` column in the input file exists only so
the automated testnet run can exercise the PIN store; the command line
refuses it unless `--allow-pin-column` is passed, and a file carrying PINs
must never be used outside testnet. When a PIN record already exists for a
number, nothing in this bridge replaces it.

What is stored: the adapter's PIN store holds a salted scrypt hash
(`scrypt$N$r$p$salt$hash`) and the lockout counters, never the PIN.

## What an adopter must add

- **Identity.** A check that the person who holds the phone number is the
  intended recipient, before the number goes into the input file. The
  bridge has no view of this and cannot add it later.
- **Consent.** A record that the recipient agreed to receive funds this
  way and to the terms of the wallet provider, kept with the identity
  record, not in this bridge.
- **The signer.** The reference signer holds recipient keys in process
  memory and forgets them when the process ends; it exists so a third
  party can run the flow on testnet, and it makes every account it
  creates receive-only (see above). A deployment supplies a `Signer`
  whose keys live in its own protected boundary before any flow that
  signs for a recipient account. Since 10 October 2026 it
  can do so without changing this repository: `BRIDGE_SIGNER_MODULE` names
  an ES module of the deployment's own that exports `createSigner` (or a
  default export) returning an object implementing the adapter's `Signer`
  interface; `npm run provision` and the USSD service check the object at
  boot and refuse anything that does not implement `createAccountKey`,
  `canSignFor` and `signTransaction`. With an injected signer,
  `SPONSOR_PUBLIC_KEY` names the sponsor, the signer must be able to sign
  for it, and no sponsor secret may be in the environment. No signer
  implementation other than the adapter's reference signer lives here.
- **The stores.** The account store links phone numbers to accounts and
  the PIN store gates signing. Both are personal data and authentication
  data; protect and back them up as such. The reference stores are JSON
  files for a single process.
- **The input file.** It carries phone numbers; handle it as personal data
  and delete it after the run.

## Note for Deliverable 3 and for production notice

A recipient provisioned by this bridge arrives at their first dial with an
account that exists and no PIN. The USSD flow must handle that state: set
the PIN, confirm it, then show the account screen, skipping the "1. Create
your account and continue" step of the adapter's first-use flow. This
deviates from the Africa's Talking walkthrough v1 at that one screen and
needs written notice before any production use.
