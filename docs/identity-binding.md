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
   transaction; when an account is mapped but has no trustline, adds one;
3. records the mapping phone number to account in the account store;
4. writes the SDP row with that address.

That is the whole binding: a phone number, an account the bridge created,
and a line in a file. The bridge does not know who holds the phone.

## PINs

The bridge does not set a PIN by default. The recipient sets their PIN on
their first USSD dial (Deliverable 3), and the PIN is their consent to
sign from then on. The `pin` column in the input file exists only so the
automated testnet run can exercise the PIN store; the command line refuses
it unless `--allow-pin-column` is passed, and a file carrying PINs must
never be used outside testnet. When a PIN record already exists for a
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
  party can run the flow on testnet. A deployment supplies a `Signer`
  whose keys live in its own protected boundary.
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
