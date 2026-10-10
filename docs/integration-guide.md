# Integration guide

For a wallet provider or NGO that wants to pay basic-phone recipients
through the Stellar Disbursement Platform (SDP) with this bridge. No
contact with Saleem is needed. Every command here was run from a clean
clone on testnet; the runs are recorded in `EVIDENCE.md`.

Testnet only. Nothing in this repository moves real money.

## What the bridge is

The SDP can pay a recipient straight to a wallet address, with
invitations switched off, when the disbursement names the recipient's
phone number and address. Someone has to create that recipient's Stellar
account, open the USDC trustline, bind the account to the phone number,
and let the recipient see what arrived on a basic phone. The bridge does
those four things:

1. **Tenant** (`docs/sdp-setup.md`): an SDP 7.0.0 tenant on testnet,
   configured for the wallet-address route.
2. **Provisioning** (`npm run provision`): phone numbers in, Stellar
   accounts with USDC trustlines out, bound to the numbers, as the SDP
   disbursement file.
3. **USSD service** (`npm run ussd:capture` for a sandbox session): the
   recipient dials, sets a PIN on first use, and sees their balance and
   last payment.
4. **Batch**: the operator starts the disbursement in the SDP dashboard.

It depends on the
[stellar-ussd-sep10-adapter](https://github.com/saleempay/stellar-ussd-sep10-adapter)
(a git submodule pinned to one commit) for sponsored account creation,
the PIN policy, the session store and the gateway transport.

## 1. Run the tenant

See `docs/sdp-setup.md`: Docker runtime, `npm run sdp:accounts`,
`npm run sdp:up`, the dashboard at `http://bridge.localhost:3000`.

## 2. Provision recipients

```bash
npm run sponsor:setup
npm run provision -- --input recipients.csv --output sdp-disbursement.csv
npm run sdp:upload -- --file sdp-disbursement.csv --name "October batch"
```

`recipients.csv` has the header `phone,id,amount`: the phone number in
E.164 form, your own reference, the USDC amount. The command creates one
sponsored account with a USDC trustline per new number (one transaction
each), records the number to account mapping in `data/accounts.json`, and
writes the SDP file with the columns
`phone,walletAddress,walletAddressMemo,id,amount,paymentID`. It is
idempotent: run it again and it creates nothing, sends nothing and writes
the same bytes (it prints the file's SHA-256). Rows that fail are reported
one by one with a code (`invalid_phone`, `resolver_failure`,
`sponsor_underfunded`, `trustline_failure`, `horizon_timeout`,
`pin_input`); the other rows still succeed. The sponsor is a throwaway
testnet account in `.env`; the run is refused up front when it cannot pay
for every row.

No PIN is set by provisioning. Recipients set their PIN on their first
dial. The optional `pin` column exists only for the automated testnet run;
the command refuses it unless you pass `--allow-pin-column`, and a file
with PINs must never be used outside testnet. See
`docs/identity-binding.md` for what the bridge binds and what you must add
(identity, consent, a real signer, protected stores).

## 3. Run the USSD service

The menu is `docs/ussd-menu-walkthrough-v1.md` with the additions in
`docs/walkthrough-deviations.md`. The service is a small HTTP server that
answers the gateway's callbacks; the reference gateway is Africa's Talking.

```bash
# .env: USSD_CALLBACK_PATH (long random segment), USSD_PORT, DATA_DIR
npm run ussd:capture -- --tunnel-url https://<your tunnel host>
```

Expose the port through a tunnel of your own (the script starts none),
set the gateway callback to the tunnel base URL followed by
`USSD_CALLBACK_PATH`, and dial the service code from the gateway's
simulator. The banner shows the path masked; never paste the full value
anywhere.

### The three states a number can be in

| State | What the recipient sees on "1. My account" |
|---|---|
| no account, no PIN | Create a 4 digit PIN, Enter the PIN again, PIN saved, then 1 creates the account (sponsored, with the USDC trustline), Account ready, Enter your PIN, the account screen |
| account, no PIN (provisioned by `npm run provision`) | Create a 4 digit PIN, Enter the PIN again, then the account screen directly |
| account and PIN | Enter your PIN, the account screen |

### `USSD_CREATE_ON_DIAL`

`true` (the demonstration build): a number with no account gets one
created on dial, paid by the sponsor in `.env`. `false` (the
operator-provisioned posture): only numbers you provisioned are served; a
number with no account sees "No account found for this number. Dial again
to set up." (E3). Set `false` when recipients must have passed your
identity and consent steps before they can hold funds.

### The account screen

```
Signed in as GD4I..J24Z
Balance 12.50 USDC
Last received 10.00 USDC, 24 Oct
Test only, no funds move
```

Read from Horizon on every dial, two calls in parallel, each under 2.5
seconds: the account's balances (USDC with the pinned issuer; no such
trustline shows "Your account cannot hold USDC yet.") and the newest 200
payment operations, from which the newest incoming USDC payment is taken
(payment and path payment types, `to` equal to the account; account
creation and outgoing payments are skipped). No match shows "No payments
received yet". An account whose last 200 operations hold no incoming USDC
payment also shows that line; raise the scan depth in `accountView.ts` if
your accounts are busier than that. Amounts are cut to two decimals, never
rounded up; the date is the UTC date of the payment. Any Horizon failure
within the budget shows "Service unavailable. Please try again later."

### PINs

The PIN policy is the adapter's: four digits, a weak list at setup, three
attempts then a 15 minute lockout, scrypt hashes in `data/pins.json`, the
PIN never stored, logged or shown. "PIN saved" is shown only by the step
that stored the hash; "PIN accepted" only after a verification. A stored
PIN is never replaced by the service.

### Timing

The gateway expects every callback answered within 10 seconds; the
listener answers a busy screen at 8.5 seconds if work is still in flight,
and the real answer is served from its cache to the gateway's retry. The
sandbox ends a session after roughly 30 to 60 seconds without input
(measured in the adapter's evidence, not quoted from documentation). PIN
screens are local; the account screen is two reads under 2.5 seconds;
creation on dial is one Horizon submission (about 5 seconds measured).

### Callback security

The callback path is a capability credential: long, random, in `.env`
only, shown masked. `USSD_ALLOWED_CIDRS` adds an IP allowlist when your
gateway publishes its egress ranges (Africa's Talking does not sign
callbacks). Session records keep PIN positions masked (`####`).

## 4. Fund the distribution account and start the batch

The tenant's distribution account must hold the batch total in USDC. On
testnet, get USDC from Circle's faucet: open `https://faucet.circle.com`,
choose Stellar Testnet, paste the distribution account address (shown on
the dashboard's Distribution Accounts page). The faucet is named for this
purpose by developers.stellar.org (the MPP charge guide and the x402
quickstart). Then:

```bash
npm run sdp:batch -- --disbursement <id> --check-only   # balance against the total
npm run sdp:batch -- --disbursement <id>                # start, follow, confirm on Horizon
```

The script starts the disbursement (`PATCH /disbursements/{id}/status`),
polls the payments every 5 seconds until each is SUCCESS or FAILED (the
SDP's payment job runs every 10 seconds), waits for the disbursement to
read COMPLETED, then reads every payment's transaction and its operation
from Horizon and prints the table: recipient (masked), amount, status,
transaction hash, ledger. Each recipient then sees the payment on their
next dial. The run is recorded under `test-output/d4-batch/`.

## What is out of scope

Mainnet; production signing or custody; cash-out; SIM Toolkit; assets
other than USDC; SDP registration over USSD; changes to the SDP.
