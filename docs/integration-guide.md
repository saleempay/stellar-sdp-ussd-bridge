# Integration guide

For a wallet provider or NGO that wants to pay basic-phone recipients
through the Stellar Disbursement Platform (SDP) with this bridge. No
contact with Saleem is needed. Every command here was run from a clean
clone on testnet; the runs are recorded in `EVIDENCE.md`.

Testnet is the only network this repository configures. Nothing in this
repository moves real money. The network values come from the environment
and every process asserts them at boot (`docs/sdp-setup.md`, section 9).

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

### The isolation boundary is the tenant, never the distribution account

Design constraint for everything built on this bridge. Within one SDP
tenant, distribution accounts scope what a caller can list, but they do
not isolate receivers from direct payments. At 7.0.0 the receiver list
is filtered by the scope rule (`internal/data/receivers.go:108-114`: the
account the receiver was created under, or any account that has paid
them), while a direct payment resolves the receiver by id with no scope
filter (`internal/services/direct_payment_resolvers.go:365-371`) and
checks the paying account's balance afterwards. In the retest recorded in
`EVIDENCE.md` (Deliverable 1, "Retest: receiver scoping and batch status
on 7.0.0") a payment from a second account of the same tenant to a
receiver created under the first was refused by the balance check, not by
scoping; had the second account held USDC, the payment would most likely
have gone through and that account would then have gained list
visibility of the receiver (phone number and wallet) under the scope
rule's "has paid them" clause. Across tenants the receiver was not found
(404).

Therefore: map different clients, programmes or operators onto separate
tenants, never onto distribution accounts of one tenant. A distribution
account separates balances and listings for one operator; it does not
keep one operator's recipients away from another operator's payments.

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
`sponsor_underfunded`, `trustline_failure`, `signer_unavailable`,
`horizon_timeout`, `pin_input`); the other rows still succeed. The sponsor is a throwaway
testnet account in `.env`; the run is refused up front when it cannot pay
for every row.

When any row failed or is uncertain, the SDP file is not written, because
a file missing rows looks complete to the SDP. Fix and re-run (the
successful rows are `unchanged` and cost nothing), or pass
`--allow-partial` to write the rows that succeeded together with a
sidecar, `<output>.partial.json`, naming the omitted input rows and their
codes. `sdp:upload` reads that sidecar and refuses the file unless you
pass `--accept-partial`.

A creation whose submission gets no verdict from the network (a timeout,
a Horizon 5xx, or no result codes) may still have landed. The command
writes `data/pending-creations.json` (number, account) before each
submission and, on such a failure, reads the account from Horizon before
the row fails: found, the row is `created` and mapped; absent, the row
fails as above; unreadable, the row is `uncertain` (`creation_uncertain`)
with the account id, is left out of the SDP file, and its pending record
is checked first by the next run, so the same number is never provisioned
twice. Exit code 1 covers uncertain rows as it does failed ones.

No PIN is set by provisioning. Recipients set their PIN on their first
dial. The optional `pin` column exists only for the automated testnet run;
the command refuses it unless you pass `--allow-pin-column`, and a file
with PINs must never be used outside testnet. See
`docs/identity-binding.md` for what the bridge binds and what you must add
(identity, consent, a real signer, protected stores).

**Receive-only.** With the reference signer, the accounts this command
creates are receive-only: their keys are forgotten when the command
exits, so no later process in this repository can sign for them. They
receive the SDP's payments and show them over USSD (sections 3 and 4).
A mapped account that lacks a trustline is reported as
`signer_unavailable` rather than repaired, and the sponsor's reserve in
each account (about 1.5 XLM) cannot be reclaimed. SEP-10 and any outbound
payment need a `Signer` you supply (`docs/identity-binding.md`,
"Receive-only with the reference signer").

## 3. Run the USSD service

The menu is `docs/ussd-menu-walkthrough-v1.md` with the additions in
`docs/walkthrough-deviations.md`. The service is a small HTTP server that
answers the gateway's callbacks; the reference gateway is Africa's Talking.

```bash
# .env: USSD_CALLBACK_PATH (long random segment), USSD_PORT, DATA_DIR,
#       USSD_TUNNEL_MODE (quick, named or external)
npm run ussd:capture -- --wait-minutes 240 --clipboard
```

The script starts the service, puts a public tunnel in front of it, and
records every request. It prints the tunnel hostname in full on every
start (and again, with a warning, if the tunnel process ever restarts),
writes every tunnel start to the capture record, and prints `READY TO
DIAL` only when the hostname resolves on two public resolvers (1.1.1.1 and
8.8.8.8) and a well-formed gateway POST through the public URL returns
screen 1. Set the gateway callback to `https://<hostname>` followed by
`USSD_CALLBACK_PATH`, no trailing slash; `--clipboard` copies that full
URL to the clipboard so the path is never typed or shown. After saving,
reopen the channel and confirm the saved host matches the printed
hostname, then dial the service code from the gateway's simulator. The
banner shows the path masked; never paste the full value anywhere.

A saved callback may not reach the gateway at once. On 11 October 2026 a
callback saved in the sandbox dashboard at 07:17 and again at 07:22 UTC
was still dialled on the previously saved hostname at 07:20 and 07:23
(Session Details named that hostname in the error message) and on the new
hostname at 07:28:52. After saving, make a test dial and read the Error
Message in USSD, Sessions, Details: it names the host the gateway used.

### Tunnel modes and a fixed hostname

| `USSD_TUNNEL_MODE` | What runs | Hostname |
|---|---|---|
| `quick` (default) | `cloudflared tunnel --url http://localhost:<port>`; no Cloudflare account needed | changes on every start ("The hostname changes each time you create a Quick Tunnel", Cloudflare TryCloudflare page, read 11 October 2026); no uptime guarantee |
| `named` | `cloudflared tunnel run --token <USSD_TUNNEL_TOKEN>`, or `cloudflared tunnel run --url http://localhost:<port> <USSD_TUNNEL_NAME>` | fixed: `USSD_TUNNEL_HOSTNAME` |
| `external` | nothing; pass `--tunnel-url https://<host>` for a tunnel you run yourself | whatever that tunnel gives you |

A quick tunnel is enough for a sandbox session, with one rule: the
callback saved in the gateway dashboard must carry the hostname of the
tunnel that is running now. On 7 and 10 October 2026 every failed dial was
the dashboard holding the hostname of an earlier start (see `EVIDENCE.md`,
11 October correction). To stop the hostname changing, use one of these:

**Option A: Cloudflare named tunnel (needs a domain whose DNS is on
Cloudflare).** Steps from the Cloudflare guide "Create a locally-managed
tunnel" (developers.cloudflare.com, read 11 October 2026):

```bash
cloudflared tunnel login                       # browser sign-in, writes cert.pem
cloudflared tunnel create saleem-ussd-sandbox  # writes <UUID>.json credentials
cloudflared tunnel route dns saleem-ussd-sandbox ussd-sandbox.<your domain>
```

Then in `.env`: `USSD_TUNNEL_MODE=named`,
`USSD_TUNNEL_HOSTNAME=ussd-sandbox.<your domain>`,
`USSD_TUNNEL_NAME=saleem-ussd-sandbox`. The script runs
`cloudflared tunnel run --url http://localhost:<port> saleem-ussd-sandbox`
(`--url` on `run` verified with `cloudflared tunnel run --help`, version
2026.8.2). Alternatively create the tunnel in the Zero Trust dashboard,
add a public hostname routed to `http://localhost:<port>`, and put its
token in `USSD_TUNNEL_TOKEN` instead of the name. The callback URL is then
saved in the gateway dashboard once.

**Option B: another provider with a stable hostname, in external mode.**
For example ngrok: `ngrok config add-authtoken $YOUR_TOKEN`, then
`ngrok http <port>`. Per the ngrok quickstart (read 11 October 2026),
"All accounts come with a free dev domain that is automatically chosen
when you start an endpoint", and a chosen name needs a paid plan
(`--url`). Start it yourself and run
`npm run ussd:capture -- --tunnel-url https://<that hostname>`. The
readiness check and the record behave the same.

Whichever option, the path stays a secret and is rotated per session;
only the hostname becomes fixed.

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
identity and consent steps before they can hold funds. `true` is accepted
on testnet only: on any other network type the service refuses to start
(exit code 2, naming the variable and the network), because creation on
dial opens an account for whoever dials, with the sponsor's reserves, and
the reference signer keeps no key for it; off testnet, recipients are
provisioned by the operator with `npm run provision`.

A creation whose submission gets no definitive answer (the 8 second dial
deadline passes, Horizon answers a 5xx or no result codes) is not treated
as failed: the transaction can still be included until its time bound
passes. The bridge sets a 30 second bound on every creation (the adapter's
default is 120) and keeps a pending record for the number until the bound
plus a 10 second grace has passed. Meanwhile a re-dial answers "Service
unavailable. Please try again later." (E4) and creates nothing; once the
account appears it is adopted; once the bound has passed with the account
still absent, the next dial creates afresh. `npm run provision` follows
the same rule and reports such a row as `uncertain` until the bound has
passed. The hourly cap (`USSD_CREATE_MAX_PER_HOUR`) reserves its slot
before the submission, so dials from different numbers that arrive
together cannot all pass it; the count lives in the service process and
starts at zero when the process restarts. This is the standard Stellar handling of an unanswered submission:
with a time bound the transaction either makes it into a ledger exactly
once or times out (developers.stellar.org, Horizon API reference, "Error
Handling" and the "Timeout" status code, read 12 October 2026).

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
rounded up; the date is the UTC date of the payment. A read that fails
with a transport error (the runtime's fetch error, a socket or DNS error,
the 2.5 second deadline) or a 5xx answer is tried once more after a 1
second pause, if a full second attempt still fits the 7 second budget of
the read; a 4xx answer is never retried (a 404 is "No account found", any
other 4xx is a refusal Horizon has understood). The budget sits under the
listener's 8.5 second busy screen and the gateway's 10 second limit, with
the PIN verification and the response path in the same callback. Two
failures, or any failure that cannot be retried, show "Service
unavailable. Please try again later."; the service log line
`event=viewFailed` then carries the attempt count, the error code, the
HTTP status when there is one and the cause's code (for example
`code=TypeError cause=ECONNRESET`), never any user data. Reason: on 11
October 2026 one account read failed with a transport error and the same
read succeeded 14 seconds later, so the caller saw E4 for a fault that was
over by the next dial (`EVIDENCE.md`, "Finding while running").

### The closing line (`USSD_CLOSING_LINE`)

Screens 7 and 8 end with a closing line. Unset or blank, it is the
contracted text, "Test only, no funds move". Any other value is a menu
change that needs written notice to Africa's Talking before production
(walkthrough section 7). At boot the service refuses a value that would
push either screen past the 160 character budget at the account screen's
longest values, or that carries a character outside printable ASCII (no
line breaks, accents, symbols or emoji; telcos cannot render them). The
refusal names the variable and exits with code 2.

### PINs

The PIN policy is the adapter's: four digits, a weak list at setup, three
attempts then a 15 minute lockout, scrypt hashes in `data/pins.json`, the
PIN never stored, logged or shown. "PIN saved" is shown only by the step
that stored the hash; "PIN accepted" only after a verification. A stored
PIN is never replaced by the service. The PIN gates the account screen;
the service signs nothing, and with the reference signer nothing can be
signed for a provisioned account (section 2, "Receive-only").

### Timing

The gateway expects every callback answered within 10 seconds; the
listener answers a busy screen at 8.5 seconds if work is still in flight,
and the real answer is served from its cache to the gateway's retry. The
sandbox ends a session after roughly 30 to 60 seconds without input
(measured in the adapter's evidence, not quoted from documentation). PIN
screens are local; the account screen is two reads under 2.5 seconds,
tried once more after a 1 second pause on a transport failure or a 5xx
answer (worst case 6 seconds, budget 7 seconds);
creation on dial is one Horizon submission (about 5 seconds measured),
preceded by one read of the sponsor's balance for the cap.

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

### Injecting a signer

By default the bridge signs with the adapter's reference signer over
`SPONSOR_SECRET_KEY`, which is testnet-only. A deployment may inject its
own: set `BRIDGE_SIGNER_MODULE` to an ES module (a path relative to the
working directory, an absolute path, or a package specifier) exporting
`createSigner`, or a default export, that returns an object implementing
the adapter's `Signer` interface (`createAccountKey`, `canSignFor`,
`signTransaction`; `BRIDGE_SIGNER_EXPORT` picks another export name). At
boot `npm run provision` and the USSD service import it and refuse, with
exit code 2 and the missing member named, anything that does not implement
the interface. With an injected signer `SPONSOR_PUBLIC_KEY` names the
sponsor, the signer must report it can sign for that account, and
`SPONSOR_SECRET_KEY` must be empty. This repository adds no signer
implementation; the tests use a fake.

### Caps and guards

Three caps, enforced in the bridge because the SDP has no cap feature on
this route (no cap configuration in `dev/.env.example` or `cmd/serve.go`
at tag 7.0.0). The defaults are the same on every network.

| Cap | Variable | Default | Where it bites |
|---|---|---|---|
| per payment | `MAX_PAYMENT_USDC` (`.env`) | 5 USDC | `npm run provision` refuses the whole input file when any row is above it, before any account is created or any file is written |
| per batch | `MAX_BATCH_USDC` (`.env`) | 25 USDC | same, when the file's sum (string arithmetic on stroops) is above it |
| on the account | `MAX_ACCOUNT_USDC` (`sdp/.env`) | 100 USDC | `npm run sdp:batch` refuses, in `--check-only` too, when the distribution account holds more; move the excess out first |

Two guards run before `sdp:batch` starts a disbursement (not with
`--skip-start`, which only follows a batch already started):

- no disbursement is in `STARTED` (`GET /disbursements?status=started,paused`);
  no flag lifts this;
- a disbursement in `PAUSED` refuses unless `--second-run "<reason>"` is
  given and none of its payments is `READY` or `PENDING`, the two states
  that reach the network without a further operator action (a `PAUSED`
  payment moves only on resume, a `FAILED` one only on retry). The SDP
  itself allows a second start while another disbursement is paused and
  counts the paused payments against the balance
  (`internal/services/disbursement_management_service.go:326-359` at
  7.0.0), so the drain disbursement after a pause must be for the balance
  less the paused commitments; `--check-only` prints that total;
- the run log (`BATCH_RUN_LOG`, default `data/batch-run-log.jsonl`, one
  JSON object per line, appended at start and at finish) records no
  completed batch for the current UTC day, unless the operator passes
  `--second-run "<reason>"`; the reason is written to the run log.

A refusal prints every reason and exits with code 3.

## What is out of scope

Mainnet; production signing or custody; a persistent signer (the
reference signer makes provisioned accounts receive-only); cash-out; SIM
Toolkit; assets other than USDC; SDP registration over USSD; changes to
the SDP.
