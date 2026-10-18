# Evidence

Dated, append-only record of the live runs behind this repository. Each
section states what was run, on which date, against which network, and what
was observed. Accounts are masked as the first 4 and last 4 characters.
Transaction hashes are written in full with a link to stellar.expert
(testnet). Nothing here is quoted from documentation or memory: every
figure was read from the running system or the ledger during the run.

Testnet resets clear every account below. The Stellar Dashboard announces
resets in advance (the adapter's evidence recorded 16 December 2026 as the
next scheduled reset when it was read on 18 August 2026; this was not
re-checked today).

## 2026-10-07: Deliverable 1, SDP 7.0.0 testnet tenant for basic-phone recipients

### What this section proves, in plain language

On 7 October 2026 a Stellar Disbursement Platform tenant, version 7.0.0,
was started on this machine from this repository, on the Stellar test
network, and configured so that recipients identified by phone number are
paid straight to a wallet address, with receiver invitations switched off.
The same command was run again and changed nothing. A disbursement with
one wallet-address recipient was created and went from DRAFT to READY, the
recipient's wallet was marked REGISTERED without any invitation, and the
recipient was visible only from the distribution account that created it
and not from another tenant. Starting the batch was refused because the
tenant's distribution account holds no USDC yet; funding it is Deliverable
4's first step.

### Environment

- Machine: Apple M1 Pro, macOS 26.5.2; Node.js 26.5.0, npm 11.17.0
- Docker runtime: Colima 0.10.3 (macOS Virtualization framework, Rosetta
  on), Docker CLI 29.8.2, Docker Engine 29.5.2 in the Colima VM (Ubuntu
  24.04), Docker Compose 5.6.0
- Images, pinned by digest in `sdp/docker-compose.yml` and confirmed by
  `docker compose ps` during the run:
  - `stellar/stellar-disbursement-platform-backend:7.0.0@sha256:54dc7b94656e2d8a84e81e32e787ecbd9ca23a61fe168b60ab4f750072bac126`
  - `stellar/stellar-disbursement-platform-frontend:7.0.0@sha256:edec92a3c3169a041364ea218ec55c905b7e869af8ecb936f0a87ca5f45ea2b7`
  - `postgres:14-alpine@sha256:4ea9e5ed06591da7ea23eb65465e8d3187fe79f4d5ec3ae976d29a33b013e77a`
- Network: Stellar testnet, Horizon `https://horizon-testnet.stellar.org`,
  passphrase `Test SDF Network ; September 2015`
- SDP source facts: tag `7.0.0`, commit `1470427`; see `docs/sdp-setup.md` section 4

### Accounts created by `npm run sdp:accounts`

| Account | Role | Funding |
|---|---|---|
| `GALB...UL4D` | host distribution account (funds each tenant's own account) | Friendbot tx `7c41edf13b2a084a2be97ad75b56ea20ce4eed9a39c5bb6ef87627a265e9b8f0`, https://stellar.expert/explorer/testnet/tx/7c41edf13b2a084a2be97ad75b56ea20ce4eed9a39c5bb6ef87627a265e9b8f0 |
| `GBTW...K6M5` | SEP-10 signing account | not funded (signs only) |

Secrets were written to `sdp/.env` (mode 600) and nowhere else.

### `npm run sdp:up`: first start and tenant provisioning

Compose brought up `db`, `sdp-api`, `sdp-frontend` and `sdp-tss` in
that order using the health checks; the command took 55 seconds with the
images already pulled. The provisioning report for the first complete pass
(after two correction rounds, see the findings below):

```
== tenant bridge
api health            ok       answered 200 after 37 ms
admin health          ok       answered 200 after 4 ms
tenant exists         already  tenant bridge id 6967fc84-77ef-4e18-b040-7be64d04a4cb, status TENANT_PROVISIONED, distribution account GBTC...Y6XJ (DISTRIBUTION_ACCOUNT.STELLAR.DB_VAULT)
owner login           done     password set for owner@bridge.local through the reset flow; login verified
invitations disabled  done     receiver_invitations_disabled set to true
user managed wallet   already  "User Managed Wallet" id 77ab3d43-1de1-41c0-a32e-4c8a5a186ff0 is enabled
usdc asset            ok       USDC id 1d78db5e-efc7-4621-9051-f2a3f375b4ff, issuer GBBD...FLA5

== tenant scopetest
api health            ok       answered 200 after 2 ms
admin health          ok       answered 200 after 6 ms
tenant exists         done     created tenant scopetest id 10b6943e-572e-443b-ad13-a0780dde46db, status TENANT_PROVISIONED, distribution account GAW7...NRMH (DISTRIBUTION_ACCOUNT.STELLAR.DB_VAULT)
owner login           done     password set for owner@scopetest.local through the reset flow; login verified
invitations disabled  done     receiver_invitations_disabled set to true
user managed wallet   already  "User Managed Wallet" id 9c49ea76-65e4-4744-87e5-fc9359a4f4fd is enabled
usdc asset            ok       USDC id 342686dc-701f-475b-a462-c30f30ef4c05, issuer GBBD...FLA5
```

The tenant `bridge` itself was created on the first attempt of the day
(09:07 UTC); the report above shows it as `already` because the pass that
completed every step came after the corrections.

The tenant's distribution account was read on Horizon right after
creation: it exists, holds 4.9999800 XLM, and already carries the USDC
(issuer `GBBD...FLA5`) and EURC trustlines, both at 0. So a DB vault
tenant gets its asset trustlines at provisioning; nothing more is needed
before funding.

### `npm run sdp:check`: second pass, nothing changes

```
== tenant bridge
api health            ok       answered 200 after 37 ms
admin health          ok       answered 200 after 4 ms
tenant exists         already  tenant bridge id 6967fc84-77ef-4e18-b040-7be64d04a4cb, status TENANT_PROVISIONED, distribution account GBTC...Y6XJ (DISTRIBUTION_ACCOUNT.STELLAR.DB_VAULT)
owner login           already  owner@bridge.local logs in with the held password
invitations disabled  already  receiver_invitations_disabled is true
user managed wallet   already  "User Managed Wallet" id 77ab3d43-1de1-41c0-a32e-4c8a5a186ff0 is enabled
usdc asset            ok       USDC id 1d78db5e-efc7-4621-9051-f2a3f375b4ff, issuer GBBD...FLA5

== tenant scopetest
api health            ok       answered 200 after 3 ms
admin health          ok       answered 200 after 3 ms
tenant exists         already  tenant scopetest id 10b6943e-572e-443b-ad13-a0780dde46db, status TENANT_PROVISIONED, distribution account GAW7...NRMH (DISTRIBUTION_ACCOUNT.STELLAR.DB_VAULT)
owner login           already  owner@scopetest.local logs in with the held password
invitations disabled  already  receiver_invitations_disabled is true
user managed wallet   already  "User Managed Wallet" id 9c49ea76-65e4-4744-87e5-fc9359a4f4fd is enabled
usdc asset            ok       USDC id 342686dc-701f-475b-a462-c30f30ef4c05, issuer GBBD...FLA5
```

### Retest: receiver scoping and batch status on 7.0.0

Run by `node scripts/retest-d1.mjs` at 09:18 UTC. Full masked record in
`test-output/retest-d1.json` (local file, not committed).

Receiver test account `GDJE...G3SP`, created for this run:

- Friendbot funding tx `dd4ab236d1cbccfdc6d9e5b898b5925e7c00b54614c5732c2e2e8c15673650c5`,
  https://stellar.expert/explorer/testnet/tx/dd4ab236d1cbccfdc6d9e5b898b5925e7c00b54614c5732c2e2e8c15673650c5
- USDC trustline tx `a8bec144158b8453bb395c4246048f8f66ae04080c0bf846feecc31a6576b0a4`
  (ledger 5068222),
  https://stellar.expert/explorer/testnet/tx/a8bec144158b8453bb395c4246048f8f66ae04080c0bf846feecc31a6576b0a4

(An earlier attempt of the same script created `GANA...I2BG` with the same
two steps, then stopped at the disbursement call with the `wallet_id`
finding below. That account is funded and unused.)

Scopes used in tenant `bridge`: distribution account `default`
(`GBTC...Y6XJ`, the account the tenant was created with) and a second
distribution account `scope-b` (`GDSW...DZOJ`) created through
`POST /distribution-wallets` for this test. Tenant `scopetest` is the
other tenant.

| Step | Observed |
|---|---|
| `POST /disbursements` in `default`, contact type `PHONE_NUMBER_AND_WALLET_ADDRESS`, asset USDC | 201, status `DRAFT`, wallet `User Managed Wallet` chosen by the SDP |
| `POST /disbursements/{id}/instructions` with one row (`phone,id,amount,walletAddress`, amount 1.5) | 200, status `READY` |
| `GET /disbursements/{id}/receivers` | one receiver, receiver wallet status `REGISTERED`, stellar address `GDJE...G3SP`; no invitation was sent (invitations are disabled for the organisation; the DRY_RUN sender printed no receiver message) |
| `GET /receivers?q=<phone>` from `default` | 1 result |
| `GET /receivers?q=<phone>` from `scope-b` | 0 results |
| `GET /receivers?q=<phone>` from tenant `scopetest` | 0 results |
| receiver id present in `GET /receivers` from `default` / `scope-b` / `scopetest` | true / false / false |
| `POST /payments` (direct payment of 1 USDC) to the receiver id from `scope-b` | 400 "insufficient balance for direct payment: requested 1.000000 USDC, but only 0.000000 available" |
| `POST /payments` to the receiver id from tenant `scopetest` | 404 "receiver not found with reference: <id>" |
| `PATCH /disbursements/{id}/status {"status":"STARTED"}` | 409 "the disbursement ... failed due to an account balance (0.00) that was insufficient to fulfill new amount (1.50)"; status stays `READY` |
| payment row over the following 90 seconds | status `DRAFT`, no transaction; disbursement stays `READY` |
| `PATCH ... {"status":"PAUSED"}` | 400 "disbursement is not ready to be paused"; status `READY` |
| `PATCH ... {"status":"STARTED"}` again | 409, same balance message |
| `default` distribution account on Horizon after the run | EURC 0, USDC 0, XLM 4.9999800 |

**Batch status: the retest reached READY.** COMPLETED was not reached
because the tenant's distribution account holds 0 USDC and the SDP checks
the balance before it will start a disbursement (409 above). Funding the
account with testnet USDC is the first step of Deliverable 4, and the
STARTED, payment and COMPLETED transitions are recorded there.

**Receiver scoping, stated exactly:**

- Across tenants: a receiver created in `bridge` is neither listed nor
  payable from `scopetest` (0 results, 404 on a direct payment).
- Within one tenant: the receiver list is scoped per distribution
  account (`default` lists it, `scope-b` does not), which matches the
  scope rule in `internal/data/receivers.go:105-119`. A direct payment by
  receiver id from `scope-b` was refused, but by the balance check, not
  by scoping: in 7.0.0 the direct payment service resolves the receiver by
  id first (`direct_payment_resolvers.go:365-371`, no scope filter) and
  checks the balance after (`direct_payment_service.go:189`). So within a
  tenant, a receiver created under one account can be named by id in a
  direct payment from another account of the same tenant, and the scope
  rule then counts that account as having paid them. Whether such a
  payment completes was not tested; `scope-b` holds no USDC.

### Findings while building (each fixed in the same branch)

1. `POST /tenants/default-tenant` returns 403 unless `SINGLE_TENANT_MODE`
   is on, and in that mode the SDP ignores the tenant header
   (`middleware.go:296-304`, `tenants_handler.go:319-322`). The
   repository runs multi-tenant and names the tenant on every request;
   the dashboard is reached at `http://bridge.localhost:3000`.
2. The SDP CLI `auth add-user --password` reads the password from a
   terminal prompt and loops when run through `docker compose exec -T`.
   Replaced by the API-only path: forgot-password, token from the DRY_RUN
   message in the container log, reset-password. The SDP does not re-send
   while an earlier token is valid, so the reader takes the newest message
   for the recipient from the whole log.
3. The password policy requires a special character
   (`password_validation.go`); the generator now guarantees all four
   classes.
4. For the wallet-address contact type the SDP refuses `wallet_id` ("not
   allowed for this registration contact type") and selects the enabled
   user managed wallet itself (`disbursement_handler.go:66-76,142-160`).
   The client type and the facts module were corrected.

### Screenshots (`docs/evidence/`)

Captured by `scripts/capture-evidence.mjs` from the `bridge` tenant
dashboard at 1440 by 1000, signed in as the owner; the password was read
from `sdp/.env` by the script and never shown.

| File | Shows |
|---|---|
| `d1-settings-invitations-off.png` | Settings, "Disable receiver invitations" on |
| `d1-wallet-providers.png` | Wallet providers, "User Managed Wallet" enabled, User Managed: Yes |
| `d1-new-disbursement-form.png` | New disbursement form: contact method "Wallet Address and Phone Number", receiver wallet app "User Managed Wallet", asset USDC |
| `d1-distribution-account.png` | Distribution account `default` with the USDC trustline (issuer `GBBD...FLA5`). The page shows the account's public address; it is a public key, not a credential |

### Offline checks

`npm run typecheck`: clean. `npm test`: 28 passed. `npm run
secret-scan`: clean (host account addresses checked against the live
`sdp/.env`).

## 2026-10-07: Deliverable 2, recipient provisioning bridge

### What this section proves, in plain language

On 7 October 2026 the bridge took a file of five phone numbers and
amounts and, for each number, created a Stellar account on the test
network with its reserves paid by a throwaway sponsor and a USDC trustline
opened in the same transaction, bound the number to the account, and
wrote the disbursement file the SDP expects. Running the same file again
created nothing, sent nothing, and wrote the same bytes. The file was then
uploaded to the SDP tenant from Deliverable 1, which accepted it and
marked all five recipients as registered without sending any invitation.

### Environment

- Same machine and network as the Deliverable 1 section; Horizon
  `https://horizon-testnet.stellar.org`
- Adapter: `saleempay/stellar-ussd-sep10-adapter` as a git submodule at
  commit `5a3c8dc59be6e398ee0baf778d65b7403fe46951`, built in place; the
  reference `LocalKeypairSigner` and the JSON account store
- Asset: USDC, issuer `GBBD...FLA5` (SDP testnet issuer, see
  `docs/sdp-setup.md` section 4)
- Run id `2026-10-07T10-14-47-167Z`; full masked record in
  `test-output/d2-e2e/2026-10-07T10-14-47-167Z/evidence.json` (local)

### Sponsor (created by `npm run sponsor:setup`)

| Account | Funding |
|---|---|
| `GBR2...ADZ7` | Friendbot tx `fbe6be6924692bbdc8ddb6c4c76ed5c3c9c1459f7199a3a49c2fdc4dd3a9ca29`, https://stellar.expert/explorer/testnet/tx/fbe6be6924692bbdc8ddb6c4c76ed5c3c9c1459f7199a3a49c2fdc4dd3a9ca29 |

Separate from the SDP host account in `sdp/.env` and from every tenant
distribution account. Secret in `.env` (mode 600) only.

### First run: five recipients (`npm run test:e2e`, 10:14 UTC)

Input: five synthetic numbers in the sandbox convention, amounts 1.5, 2,
2.5, 3 and 3.5 USDC, ids `r1` to `r5`, no pin column.

```
  1  +2547***5311    created          GDMN...QUUU   pin:none      tx c677c443c7096959eee34d5948551344c4be2d28c75df32fd8b45f9e8447a3cb ledger 5068901
  2  +2547***5322    created          GA6R...ZCNA   pin:none      tx b2e15c288f5b24725318a5a0f318f793f03d1e0b034aeb54c44d9c21fd145d3e ledger 5068902
  3  +2547***5333    created          GADZ...HMBZ   pin:none      tx 7601407be9d0189511529337bd52f211353fe36d013be3d326080ada677f2371 ledger 5068903
  4  +2547***5344    created          GBFQ...FAVO   pin:none      tx 100e139e76115756b637e1e4cfc0c501310c55e53400d8a00e90b4f9c28cf16c ledger 5068904
  5  +2547***5355    created          GCKM...XAAX   pin:none      tx d81b61e5c903adafa1c6012b0b4a4f7565d4c2bfdbb15e3b00dcc0bea0260d29 ledger 5068905
created 5, trustline added 0, unchanged 0, failed 0, pin refused 0
```

Links (one sponsored transaction each: begin sponsoring, create account
with starting balance 0, change trust USDC from the new account, end
sponsoring):

- https://stellar.expert/explorer/testnet/tx/c677c443c7096959eee34d5948551344c4be2d28c75df32fd8b45f9e8447a3cb
- https://stellar.expert/explorer/testnet/tx/b2e15c288f5b24725318a5a0f318f793f03d1e0b034aeb54c44d9c21fd145d3e
- https://stellar.expert/explorer/testnet/tx/7601407be9d0189511529337bd52f211353fe36d013be3d326080ada677f2371
- https://stellar.expert/explorer/testnet/tx/100e139e76115756b637e1e4cfc0c501310c55e53400d8a00e90b4f9c28cf16c
- https://stellar.expert/explorer/testnet/tx/d81b61e5c903adafa1c6012b0b4a4f7565d4c2bfdbb15e3b00dcc0bea0260d29

Read back from the ledger after the run: each new account exists with
`num_sponsored = 3` (two base reserves and one trustline subentry, all
sponsored), native balance 0, USDC balance 0 with the trustline present.
The sponsor's `num_sponsoring` went from 0 to 15 and its XLM from
10000.0000000 to 9999.9998000: it paid fees only (5 transactions of 4
operations at 100 stroops), the reserves being sponsored rather than
transferred. Sponsor transaction count: 1 before, 6 after.

### Second run: nothing changes

```
  1  +2547***5311    unchanged        GDMN...QUUU   pin:none
  2  +2547***5322    unchanged        GA6R...ZCNA   pin:none
  3  +2547***5333    unchanged        GADZ...HMBZ   pin:none
  4  +2547***5344    unchanged        GBFQ...FAVO   pin:none
  5  +2547***5355    unchanged        GCKM...XAAX   pin:none
created 0, trustline added 0, unchanged 5, failed 0, pin refused 0
```

Output identical to the first run; sponsor transaction count still 6.
The command line path was then run over the same data directory and
input (`node scripts/provision.mjs ...`): five `unchanged`, exit 0, and it
wrote `docs/evidence/d2-disbursement.csv` byte for byte identical to the
test's output.

### The disbursement file

`docs/evidence/d2-disbursement.csv`, SHA-256
`b4d8c873d47644ff5a45b2ab3b025be2a1834ac8446f917cdef0e73345e6a88f`,
header `phone,walletAddress,walletAddressMemo,id,amount,paymentID`
(column set and order verified in `docs/sdp-setup.md` section 4). The
file carries the full recipient addresses, which the SDP needs; they are
public keys of the five testnet accounts above and contain no secret. No
PIN was set for any recipient (ruling of 7 October: recipients set their
PIN on first dial).

### Upload to the SDP tenant (`npm run sdp:upload`, 10:18 UTC)

Tenant `bridge`, distribution account `default`
(`7a445139-887b-4d81-b173-492d289eb4d7`), disbursement
`fa63ed05-98fa-4980-bd26-fe1a3bda11aa` "D2 evidence 2026-10-07": status
`READY` after upload, 5 receivers, receiver wallet statuses
`REGISTERED` x 5, no invitation sent (invitations are disabled for the
organisation). Not started: the distribution account still holds 0 USDC;
the batch is Deliverable 4.

### Finding while building

The live test's first attempt skipped the upload: `POST /disbursements`
answered 400 because the tenant now has two distribution accounts (the
second one was created by the Deliverable 1 scoping retest) and the SDP
requires `X-Wallet-Id` on writes once a tenant has more than one
(`docs/multi-wallet/api-reference.md:169-181` at 7.0.0). The upload helper
now selects the tenant's default account unless one is named, and the
live test fails rather than skips on an SDP error.

### Offline checks

`npm run typecheck`: clean. `npm test`: 56 passed, 1 skipped (the live
test, flag gated). `npm run secret-scan`: clean.

## 2026-10-07: Deliverable 3, USSD receive and balance view

### What this section proves, in plain language

On 7 October 2026 three of the Deliverable 2 recipients dialled the
bridge's USSD service on the Africa's Talking sandbox simulator. Each had
an account but no PIN. Each set a PIN on first dial and was taken straight
to the account screen, which read the account from the Stellar test
network and showed a balance of 0.00 USDC and "No payments received yet"
(no payment has been made yet; that is Deliverable 4). Each then dialled
again, typed a wrong PIN once and saw the "Wrong PIN. 2 attempts left"
screen, then the right PIN and the account screen again. Every screen
matched the walkthrough word for word, with the one ruled deviation. The
service answered every callback in under 2.5 seconds.

### Environment

- Bridge branch `d3-ussd-balance-view`; adapter submodule pinned at the
  time to `6a0dd6182cbfa0aef31befb19dda5079d7b8b3f7`, the head of adapter
  PR saleempay/stellar-ussd-sep10-adapter#15 ("Make the USSD step handler
  injectable"); re-pinned on 7 October to that PR's merge commit on main,
  see "Deliverable 4, part 4" below
- Gateway: Africa's Talking sandbox, shared code `*384#`, channel
  `*384*45210#` created in the dashboard for this run; the callback is a
  cloudflared quick tunnel to port 8085 plus the path from `.env`
  (shown masked in every banner and record as `/****d999`)
- Stores: the Deliverable 2 run directory (accounts of the five
  recipients) plus a PIN store created by this run
- Horizon `https://horizon-testnet.stellar.org`, two reads per account
  screen in parallel, 2.5 s deadline each
- Creation on dial: on (`USSD_CREATE_ON_DIAL=true`); no creation happened,
  every recipient already had an account

### Session set 1: recipient r1, driven through the capture script

`docs/evidence/d3-ussd-capture-2026-10-07.json` (gateway callbacks and
machine events; MSISDN masked, every four-digit input `####`, no path).

| Callback (UTC) | Server | Input (masked) | Response |
|---|---|---|---|
| 12:40:27 | 5 ms | dial | `CON Saleem / 1. My account / 2. About` (screen 1) |
| 12:40:50 | 9 ms | `1` | `CON Create a 4 digit PIN` (screen 2) |
| 12:41:19 | 2 ms | `1*####` | `CON Enter the PIN again` (screen 3) |
| 12:41:23 | 998 ms | `1*####*####` | `END Signed in as GDMN..QUUU / Balance 0.00 USDC / No payments received yet / Test only, no funds move` (screen 7, D-1 path, A-1 line) |
| 12:41:48 | 9 ms | dial | screen 1 |
| 12:41:53 | 4 ms | `1` | `CON Enter your PIN` (screen 6) |
| 12:41:57 | 96 ms | `1*####` | `CON Wrong PIN. 2 attempts left / Enter your PIN` (E1) |
| 12:42:12 | 904 ms | `1*####*####` | screen 7 (returning path) |

Simulator screenshots, PIN field empty in every frame:
`docs/evidence/d3-screen1-main-menu.jpg`, `d3-screen2-create-pin.jpg`,
`d3-screen3-confirm-pin.jpg`, `d3-screen7-provisioned-path.jpg`,
`d3-screen6-enter-pin.jpg`, `d3-screenE1-wrong-pin.jpg`,
`d3-screen7-returning-path.jpg`.

### Session set 2: recipient r2, through the live test harness (first attempt)

The harness (`npm run test:e2e:ussd`) observed the provisioned path, the
wrong PIN and the returning path for `GA6R...ZCNA`, then failed its own
assertion that every recorded exchange carries the masked recipient
number: the public quick tunnel is scanned by bots, and two pathless
probes had been recorded as exchanges with no phone number. The check was
narrowed to gateway callbacks (those with a session id) and the harness
was run again with the next recipient. The three screens were rendered
correctly in this attempt as well.

### Session set 3: recipient r3, through the live test harness, PASSED

`npm run test:e2e:ussd` with `USSD_E2E_MSISDN` set to recipient r3:
**1 passed**, 144 s. Evidence file
`docs/evidence/d3-ussd-sandbox-test-2026-10-07.json` (callbacks and
machine events, masked).

| Callback (UTC) | Server | Input (masked) | Response |
|---|---|---|---|
| 12:46:39 | 24 ms | dial | screen 1 |
| 12:46:56 | 7 ms | `1` | screen 2 |
| 12:47:10 | 3 ms | `1*####` | screen 3 |
| 12:47:14 | 2458 ms | `1*####*####` | `END Signed in as GADZ..HMBZ / Balance 0.00 USDC / No payments received yet / Test only, no funds move` |
| 12:47:32 | 2 ms | dial | screen 1 |
| 12:47:37 | 3 ms | `1` | screen 6 |
| 12:47:42 | 97 ms | `1*####` | E1 |
| 12:47:52 | 946 ms | `1*####*####` | screen 7 |

The harness asserted: the provisioned path, one `pinRejected` event and
the returning path observed; every final screen carries `Balance 0.00
USDC` and `No payments received yet`; every callback answered in under
8.5 s; every gateway callback carries the masked number; the serialised
evidence contains neither the recipient's number nor the callback path;
no four-digit token survives in any input field.

### What the live run shows and does not show before Deliverable 4

Shown: screens 1, 2, 3, 6, 7 (with A-1) and E1 on the live gateway, the
ruled deviation D-1, the PIN set on first dial and verified on the second,
the wrong-PIN countdown, timings. Not shown: a balance above zero and a
"Last received" line; those need the Deliverable 4 batch, after which the
same recipients' screen 7 is recorded again.

### Findings while running

1. The sandbox account held no USSD channel at first (the Service Codes
   page listed none); the channel `*384*45210#` was created in the
   dashboard. The dashboard answered "technical problems" for dials made
   before the callback was saved; the server received nothing then.
2. Saving the callback in the dashboard triggers a GET to the URL (two
   requests, 200 ms apart, answered 404 by the listener, which serves
   POST only); this does not block the save.
3. The callback path was exposed in the build session's transcript by a
   browser tool that quoted it while reading the dashboard. It was
   rotated in `.env` after the run and the quick tunnel was closed; the
   Deliverable 4 run uses a new tunnel and a new path. No evidence file
   carries either value.
4. The longest account screen took 2458 ms (two parallel Horizon reads,
   the slower one close to its 2.5 s deadline); the others took about
   0.9 to 1.0 s. The 8.5 s watchdog never fired.

### Offline checks

`npm run typecheck`: clean. `npm test`: 114 passed, 2 skipped (the two
live suites, flag gated). `npm run secret-scan`: clean. The catalogue test
parsed 13 screens from `docs/ussd-menu-walkthrough-v1.md` and matched each
byte for byte; the budget test rendered 24 screens at their longest values,
the longest being the account screen at 125 of 156 characters.

Corrected on 11 October 2026, see the entry of that date.

### Session set 4: recipient r5, recorded on video (13:25 UTC)

Ramy Soliman recorded the simulator with QuickTime while the session was
driven; the clip is held outside the repository (the published cut blurs
the PIN field). The server saw, for `+2547***5355`
(`docs/evidence/d3-ussd-capture-video-2026-10-07.json`):

| Callback (UTC) | Server | Input (masked) | Response |
|---|---|---|---|
| 13:25:52 | 15 ms | dial | screen 1 |
| 13:25:57 | 20 ms | `1` | screen 2 |
| 13:26:01 | 4 ms | `1*####` | screen 3 |
| 13:26:05 | 1164 ms | `1*####*####` | `END Signed in as GCKM..XAAX / Balance 0.00 USDC / No payments received yet / Test only, no funds move` |

The returning path and the About screen were not captured on video: from
13:27 UTC the sandbox answered every dial for every number with its
"technical problems" message within one second, the Sessions log shows
those sessions as Failed with one hop, and the callback was never
contacted (the gateway's own status page showed all systems operational).
The same gateway had served the same callback at 13:17, 13:24 and 13:26.
Two tunnel providers (cloudflared quick tunnels and localhost.run over
SSH) behaved identically, and a POST through each returned screen 1 in
under 1.1 s throughout. Recipient r4 (`+2547***5344`) was refused by the
gateway on every dial of the day, including inside the working window, and
keeps no PIN. The video of the returning path is carried to the
Deliverable 4 session, which records screen 7 after the batch in any case.

### Video of session set 4

Two raw QuickTime screen recordings by Ramy Soliman on 7 October 2026,
held outside the repository (full screen, 3024 by 1964, other windows and
the typed PIN visible, so never published as is):

| File (on the recording Mac) | Length | SHA-256 |
|---|---|---|
| `Screen Recording 2026-10-07 at 17.04.02.mov` (local time, UTC+4) | 21 min 22 s, 1.42 GB | `3e5fd5950a4d556df52fa1e19bfc3c7de96c84f9a7c05c12cdef152fbac26c31` |
| `Screen Recording 2026-10-07 at 17.25.35.mov` | 5 min 23 s, 223 MB | `562bdadb40adbe263b9899432854e93823774a52026a02c4934d25bd5b93af21` |

The first holds the failed dials and the r3 and r5 test dials; the second
holds session set 4. The published cut, `docs/evidence/d3-ussd-provisioned-path-r5-2026-10-07.mp4`
(27 s, 480 by 788, 231 KB, SHA-256
`605af75e860a8648223cba426890dc02be089fded1ceddcfd0711a773913d263`), is
seconds 14 to 41 of the second recording, cropped to the simulator phone,
with the reply line blurred from 8.0 s to 16.5 s (the two PIN screens) and
nothing else altered: dial, screen 1, `1`, screen 2, PIN, screen 3, PIN,
the "USSD code running" wait, screen 7 for `GCKM..XAAX`. The cut was made
with ffmpeg from the raw file and checked frame by frame; the screen times
match the server log above (dial 13:25:52, account screen 13:26:05 UTC).

## 2026-10-07: Deliverable 4, part 1: clean clone verification of the integration guide

### What this section proves, in plain language

The commands in `docs/integration-guide.md` and `docs/sdp-setup.md` were
run from a fresh copy of this repository, cloned from GitHub into an
empty directory, with the running tenant stopped first so nothing from
the build session could help. From that copy, in 83 seconds end to end
(13:48:30 to 13:49:53 UTC): the dependencies installed, the adapter
built, the offline suite passed, new testnet accounts were created, the
SDP 7.0.0 stack started with its own Compose project and two tenants were
provisioned, a sponsor was created, two recipients were provisioned on
chain, the disbursement file was uploaded and accepted. Then that stack
was stopped and the original one restarted intact.

### Run record (log at the time: `d4-clean-clone-verify.log`, local)

- Clone: `git clone --recurse-submodules -b d4-batch-evidence ...`, HEAD `67d4afc`, submodule `6a0dd61`
- `npm ci`: 96 packages; `npm run adapter:build`; `npm run typecheck`: clean; `npm test`: 121 passed, 2 skipped
- `npm run sdp:accounts`: host distribution account `GBI7...3YCM`, Friendbot tx `947caad50f62ef445057b189228d02cd65ad16c663d542c7f235ec5cca99618e`
- `sdp/.env`: `COMPOSE_PROJECT_NAME=sdp-verify` (own volume `sdp-verify_postgres-db-testnet`, same ports as the stopped main stack)
- `npm run sdp:up` (13:48:47): tenant `bridge` created (id `14f5e2f7...`, distribution account `GB3L...KVGF`), tenant `scopetest` created (`a2fe289c...`, `GBVX...7LTR`), owner passwords set through the reset flow, invitations disabled, user managed wallet enabled, USDC present on both; `SDP up and provisioned`
- `npm run sponsor:setup`: sponsor `GC6I...KNWA`, Friendbot tx `d971e6acc873598eedf609a9bc4741b02b7735adaf5f4e069872a382406bb4ce`
- `npm run provision` over two rows: accounts `GDKU...MKA3` (tx `ee45a11ff034fbe1fe489451e02cc6e6ab938472ad5c1ad0f1c69d0d977e8cd7`, ledger 5071477) and `GBXF...SGQV` (tx `c6fa6886421f96e8f09444dda9b9b0a2b6dadc9d382fa88705f102b61b46a752`, ledger 5071478); file SHA-256 `78b0d4d24d47febafc851f49be0c9263f45de7054a0761091ebef4e3abf01533`
- `npm run sdp:upload`: disbursement `63460fbf-0882-4bc5-bf8e-0c03f23b2a05` "clean clone verification", READY, two receiver wallets REGISTERED
- `npm run sdp:down` on the verification stack; `npm run sdp:up` on the main stack: both original tenants `already`, `SDP up and provisioned` (13:49:53)

The verification clone and its `.env` files were discarded afterwards;
its testnet accounts stay funded and unused.

## 2026-10-07: Deliverable 4, part 2: the batch

### What this section proves, in plain language

The tenant's distribution account received 20 USDC from Circle's testnet
faucet. The disbursement uploaded in Deliverable 2, five recipients and
12.50 USDC in total, was started through the SDP's API at 14:00:20 UTC and
was complete at 14:01:06 UTC: five payments, every one successful, each a
USDC payment on the Stellar test network from the distribution account to
the recipient's account, confirmed by reading the transaction back from
Horizon. Every recipient's balance on the ledger now equals the amount in
the file. The dashboard shows the batch as completed with each recipient's
status.

### Funding (Circle testnet faucet, requested by Ramy Soliman)

- Source: `https://faucet.circle.com`, Stellar Testnet, as named by
  developers.stellar.org (the MPP charge guide and the x402 quickstart,
  read 7 October 2026); drip 20 USDC per address per 2 hours as stated on
  the faucet page.
- Transaction `96e36ba7c9cd0097579e49860476a099a2918e4999b828a232a57f16c207bcb3`,
  ledger 5071572, 13:57:27 UTC, successful, one `payment` of 20.0000000 USDC
  (issuer `GBBD...FLA5`) from the faucet account
  `GAYF33NNNMI2Z6VNRFXQ64D4E4SF77PM46NW3ZUZEEU5X7FCHAZCMHKU` to the
  distribution account `GBTC...Y6XJ`:
  https://stellar.expert/explorer/testnet/tx/96e36ba7c9cd0097579e49860476a099a2918e4999b828a232a57f16c207bcb3
- `npm run sdp:batch -- --disbursement fa63ed05-98fa-4980-bd26-fe1a3bda11aa --check-only`:
  balance 20.0000000 USDC, total 12.5000000 USDC, "balance covers the total".

### The batch (`npm run sdp:batch`, run `2026-10-07T14-00-19-844Z`)

Disbursement `fa63ed05-98fa-4980-bd26-fe1a3bda11aa` "D2 evidence 2026-10-07",
started by `PATCH /disbursements/{id}/status {"status":"STARTED"}` on the
default distribution account. Timeline (UTC): 14:00:20 STARTED, five READY;
14:00:25 five PENDING; 14:00:36 two SUCCESS; 14:00:46 three; 14:00:56 four;
14:01:06 COMPLETED, five SUCCESS. 46 seconds from start to completion.

| Recipient | Amount | Status | Transaction | Ledger |
|---|---|---|---|---|
| r1 `GDMN...QUUU` | 1.5000000 USDC | SUCCESS | [94badd0d32b62ecf7127e1e7f7d71d8e49cd96d1fd8d1ec9fdae76b622b5c8fd](https://stellar.expert/explorer/testnet/tx/94badd0d32b62ecf7127e1e7f7d71d8e49cd96d1fd8d1ec9fdae76b622b5c8fd) | 5071608 |
| r2 `GA6R...ZCNA` | 2.0000000 USDC | SUCCESS | [17c76432e03663fa3efdf3ca21df611e7dba822df3fe880a37eeb9736c32ae94](https://stellar.expert/explorer/testnet/tx/17c76432e03663fa3efdf3ca21df611e7dba822df3fe880a37eeb9736c32ae94) | 5071609 |
| r3 `GADZ...HMBZ` | 2.5000000 USDC | SUCCESS | [28e34da3d5759861fb9e8ceee6246bda921b6fac0f49fedef7c532c787826c41](https://stellar.expert/explorer/testnet/tx/28e34da3d5759861fb9e8ceee6246bda921b6fac0f49fedef7c532c787826c41) | 5071610 |
| r4 `GBFQ...FAVO` | 3.0000000 USDC | SUCCESS | [51c12ad4271c3bc3a9b5783380ce0cb7acd8eb99bcbc8a1d916e02b96fd0e2d9](https://stellar.expert/explorer/testnet/tx/51c12ad4271c3bc3a9b5783380ce0cb7acd8eb99bcbc8a1d916e02b96fd0e2d9) | 5071612 |
| r5 `GCKM...XAAX` | 3.5000000 USDC | SUCCESS | [34c5d845cf26e73b5f6fcf2e5d9c60569a2b5646a5d2b4a55c704f335baa5dfa](https://stellar.expert/explorer/testnet/tx/34c5d845cf26e73b5f6fcf2e5d9c60569a2b5646a5d2b4a55c704f335baa5dfa) | 5071614 |

Each transaction was read back from Horizon by the script: successful,
one `payment` operation of that amount in USDC (issuer `GBBD...FLA5`) from
`GBTC...Y6XJ` to the recipient. Full record, accounts masked:
`docs/evidence/d4-batch-2026-10-07.json`.

Balances read from Horizon after the run: r1 1.5000000, r2 2.0000000,
r3 2.5000000, r4 3.0000000, r5 3.5000000 USDC; distribution account
7.5000000 USDC (20 less 12.5) and 4.9998800 XLM (fees paid by the TSS
channel account, not by the distribution account, except the two base
fees of its own operations).

Dashboard, captured by the evidence script at 18:02 local time:
`docs/evidence/d4-disbursement-completed.png` and `-2.png` (the
disbursement page: 5 successful payments, 0 failed, 12.50 USDC disbursed,
each receiver with its transaction hash and Success status),
`docs/evidence/d4-payments.png` and `-2.png` (the payments list). The
dashboard shows the recipients' synthetic numbers in full. (A sentence
that followed here was removed on 11 October 2026 by ruling; see the
entry of that date on the number range.)

Corrected on 11 October 2026, see the entry of that date.

## 2026-10-07: Deliverable 4, part 3: USSD sessions after the batch, OUTSTANDING

The recorded USSD sessions showing each recipient's paid balance and the
"Last received" line on screen 7 were not captured on 7 October. From
13:27 UTC the Africa's Talking sandbox failed every dial on
`*384*45210#` within one second: the Sessions log shows each attempt as
Failed with 1 hop and 1 s (successful sessions earlier the same day show
4 hops and 15 to 59 s), and the callback was never contacted (the capture
server received no gateway request for any of them, while a POST through
the same public URL returned screen 1 throughout). Four numbers, two
tunnel providers (cloudflared quick tunnels and localhost.run) and three
callback paths were tried; the last attempts, two test dials on r1 at
14:16 UTC, failed the same way. The session set is carried to the next
working day with a fresh tunnel and a fresh callback path, in the order
r1, r2 (with one wrong PIN), r3 (then About), r5, r4 (one attempt).

Corrected on 11 October 2026, see the entry of that date.

## 2026-10-10: Deliverable 4, part 3, second attempt: sandbox still failing, OUTSTANDING

The recording session was retried on 10 October 2026 with a fresh
cloudflared quick tunnel and a freshly rotated callback path. The capture
server (`npm run ussd:capture`, record
`test-output/ussd-capture/2026-10-10T11-20-47-584Z.json`, local) listened
from 11:20 UTC. The public route was confirmed end to end before any dial:
a POST through the tunnel to the callback path at 11:21:11 UTC reached the
server and was answered in 2 ms with the expected `400 bad request` for a
request without a phone number (`GATEWAY_REQUEST_INVALID`); a 404 or 502
would have meant a wrong path or a dead tunnel. After the callback URL was
saved in the sandbox dashboard, the test dial on r1 failed exactly as on
7 October: the gateway's Sessions log shows Failed, 1 hop, no callback
contact. The server received no request from the gateway at any time; the
only other entries in the record are two 404 responses at 11:23:27 UTC.
The recorder reads the body of every request before the path check, and
both bodies were empty; a gateway callback always carries sessionId,
phoneNumber and text, so these were not gateway requests on a wrong path
(the 7 October records show the same empty-body 404 pairs at dial times).
The callback path the server listened on and the path saved in the
dashboard were compared by their last four characters and match, which
rules out a stale clipboard when the callback URL was pasted.

Second-channel diagnostic (Ramy Soliman, dashboard side): a second sandbox
USSD channel on the same Africa's Talking account, pointed at the same
callback URL, failed identically (Failed, 1 hop, no callback contact).
Two channels failing the same way with a verified reachable callback
places the fault on the account or gateway side, not in the bridge, the
tunnel or the callback path. A support request has gone to Africa's
Talking. The capture server and the tunnel were stopped at 11:32 UTC.

The row stays OUTSTANDING, not failed. The five-recipient order is ready
for when the sandbox is restored: r1 (returning path), r2 (one wrong PIN,
then the right one), r3 (returning path, then About), r5 (returning
path), r4 (one attempt, provisioned path). A fresh tunnel and a fresh
callback path are used on that day, with the gateway test dial on r1
first.

## 2026-10-07: Deliverable 4, part 4: adapter submodule re-pinned to the merge of adapter PR #15

Adapter PR #15 was approved by ismo90 against its fix-round head
`3c22c41875451abe5c7591a6467dc6e7f1c6a1cb` and merged into the adapter's
`main` as `4c235f87c6af45a7c6043fe16b5eb246e148555f` (14:26:39 UTC;
content verified identical to `3c22c41`, empty diff; the adapter's own
suite on that commit 380 passed, 3 skipped). The bridge's submodule
`vendor/stellar-ussd-sep10-adapter` now points at `4c235f87...` instead
of the earlier `6a0dd61` from the PR branch. The fix round made `machine`
and `handle` exclusive on the listener's options, so the bridge's server
wiring now passes `handle` alone (`src/ussd/server.ts`); nothing else
changed. After the rebuild, the bridge's suite: 121 passed, 2 skipped,
typecheck clean.

## 2026-10-11: correction to the 7 and 10 October entries on the failed sandbox dials

This entry corrects three earlier entries, which stay as written:

- "2026-10-07: Deliverable 3, USSD receive and balance view", subsection
  "Session set 4: recipient r5, recorded on video (13:25 UTC)", the
  paragraph beginning "The returning path and the About screen were not
  captured on video";
- "2026-10-07: Deliverable 4, part 3: USSD sessions after the batch,
  OUTSTANDING";
- "2026-10-10: Deliverable 4, part 3, second attempt: sandbox still
  failing, OUTSTANDING".

Withdrawn: the statements that "the callback was never contacted", that
the gateway "never contacted" the callback, and that two channels failing
the same way "places the fault on the account or gateway side". The
support request to Africa's Talking was made on that reading and the
notice draft's request 3 (sandbox fault) has been removed.

What the gateway dashboard shows (Session Details, read by Ramy Soliman on
11 October 2026; times UTC). Every failed session carries an error message
naming its cause:

| When | Sessions | Error message |
|---|---|---|
| 7 Oct 12:30 to 12:37 | 3 | 405 Method Not Allowed from the callback |
| 7 Oct 13:01 to 13:06 | 4 | UnknownHostException for the tunnel hostname started at 11:14, after the capture server had restarted at 12:50 on a new hostname |
| 7 Oct 13:14 | 1 | response code 530 |
| 7 Oct 13:23 | 1 | UnknownHostException for the 12:50 hostname, one minute before that hostname served the recorded sessions at 13:24 to 13:26 |
| 7 Oct 13:27 to 13:28, and 14:16 | 4 and 2 | 502 Bad Gateway: the gateway reached a tunnel edge and no server was behind it |
| 10 Oct 11:23, main channel | 1 | UnknownHostException for the hostname started on 7 October at 14:02; the callback saved on 10 October never took effect on this channel |
| 10 Oct 11:28, second channel | 1 | UnknownHostException for a hostname that appears in no capture record |

Cause: a cloudflared quick tunnel gets a new hostname on every start ("The
hostname changes each time you create a Quick Tunnel", Cloudflare
TryCloudflare documentation, read 11 October 2026). The capture server and
its tunnel were restarted during 7 October (11:14, 12:50, 14:02) and again
on 10 October, and the callback saved in the dashboard kept an earlier
hostname. The pre-dial check compared the last four characters of the
path, which matched, and never the host. There was no gateway fault.

What the capture records do and do not show. The records hold two 404
responses within half a second at each failed dial time (7 October
12:38:05, 14:16:48; 10 October 11:23:27). The recorder of that time kept
no method, path, header or source for them, so they could not be told
from gateway requests; finding 2 of the Deliverable 3 entry had already
recorded that saving the callback in the dashboard fires two GET requests
200 ms apart, answered 404 by the POST-only listener. The bridge's
listener answers 404, never 405, to a non-POST method or a path that is
not the callback path; the origin of the 405 named for 12:30 to 12:37 is
not established by our records.

Fix in the tooling (branch `d4-batch-evidence`, 11 October):

- the recorder keeps, for every request and every status, the method, the
  path as segment lengths (never the text), whether the path equals the
  callback path, query presence, content type and length, bytes read,
  user agent and the tunnel's forwarding headers;
- the capture script starts and owns the tunnel for the whole session,
  writes every tunnel start to the record with its time and hostname,
  prints the hostname in full on start and again on any restart with the
  line that the dashboard callback must be updated, and prints "READY TO
  DIAL" only when the hostname resolves on two public resolvers (1.1.1.1
  and 8.8.8.8) and a well-formed gateway POST through the public URL
  returns screen 1;
- a fixed hostname is supported through `USSD_TUNNEL_MODE=named` (a
  Cloudflare named tunnel) or `external` (another provider), documented in
  `docs/integration-guide.md`, section 3; the sandbox sessions continue on
  a quick tunnel with the hostname confirmed in the dashboard before each
  dial.

Also established on 11 October, 06:57 UTC, through a quick tunnel in front
of the server (record `2026-10-11T06-57-13-752Z.json`, local): the tunnel
does not redirect http to https (an http POST arrived as a POST with its
body and `x-forwarded-proto: http` and was answered with screen 1); a
trailing slash, a GET, a HEAD and a POST on `/` are answered 404 "not
found"; an empty-body POST on the callback path is answered 400 "bad
request". Every one of those bodies is one the gateway treats as invalid,
since none starts with CON or END.

`docs/period-report-2026-10-draft.md` (finding 4 and the clips paragraph)
and `docs/instaward-evidence-package.md` (row 4.3) are corrected in the
same commit. `README.md`, `docs/walkthrough-deviations.md` and
`docs/demo-video-plan.md` carry no sentence attributing the failures to
the gateway and are unchanged.

## 2026-10-11: Deliverable 4, part 3, third attempt: the five USSD sessions after the batch, CAPTURED

### What this section proves, in plain language

Each of the five recipients paid by the 7 October batch dialled the
sandbox service code in the Africa's Talking sandbox simulator and saw
the account screen with the balance the batch paid and the "Last
received" line for that payment. r1 and r2 entered one wrong PIN first
(E1). r3 also opened the About screen. r4, which had no PIN, set one on
first dial (D-1) after two attempts rejected as too easy to guess (A-4);
its account read then failed once (E4) and a second dial showed the
account screen. Evidence row 4.3 is captured.

### Environment

- Capture server from 07:10 UTC (branch `d4-batch-evidence`, the capture
  script owning the tunnel): a cloudflared quick tunnel started at
  07:10:22 UTC on hostname `sas-truly-relates-gather.trycloudflare.com`,
  written to the record as the only tunnel start of the session; a fresh
  callback path in `.env`.
- Readiness at 07:10:28 UTC: the hostname resolved on 1.1.1.1 and 8.8.8.8,
  and a well-formed gateway POST through the public URL returned screen 1
  (200, 5 ms); the script then printed READY TO DIAL.
- Record: `docs/evidence/d4-ussd-capture-2026-10-11.json` (MSISDNs masked,
  every four-digit input masked, callback path never written; the
  operator's own address on the probes replaced by `<operator address>`;
  the gateway's address kept). The record also holds the tunnel start and
  both readiness checks.

### The callback save and the delay, as observed on this day

The callback URL (https, the hostname above, the path, no trailing slash)
was saved on channel `*384*45210#` in the sandbox dashboard at 07:17 UTC
and the Service Codes page showed it after a reload. A test dial at 07:20
failed; the dashboard's Session Details named the cause: UnknownHostException
for the hostname saved on 10 October. The callback was saved again at
07:22; a dial at 07:23 failed the same way, naming the same old hostname.
A dial at 07:28:52 reached the server (the first gateway request in the
record: POST on the callback path, user agent `at-ussd-api/1.0`, source
`18.133.205.228`, forwarded protocol https) and the simulator showed
screen 1. Those are the four times as observed once: saved 07:17 and
07:22, old host dialled at 07:20 and 07:23, new host at 07:28:52.

### The sessions (times UTC, inputs masked)

Every gateway request in the record is a POST on the callback path with
user agent `at-ussd-api/1.0` from `18.133.205.228`, answered 200; the
slowest answer took 968 ms (the account screen, two Horizon reads). The
31 requests fall into ten sessions:

| Session | Number | Callbacks | Inputs | Final screen |
|---|---|---|---|---|
| 07:28:52 | r1 `+2547***5311` | 1 | (dial) | CON Saleem / 1. My account / 2. About (the connectivity dial, ended by the operator) |
| 07:32:58 | r1 | 1 | (dial) | CON Saleem / 1. My account / 2. About (the operator's first dial from the simulator) |
| 07:36:02 to 07:36:50 | r1 | 4 | (dial), 1, ####, #### | E1 "Wrong PIN. 2 attempts left" on the first PIN, then END Signed in as GDMN..QUUU / Balance 1.50 USDC / Last received 1.50 USDC, 7 Oct / Test only, no funds move |
| 07:37:59 to 07:38:30 | r1 | 4 | (dial), 1, ####, #### | the same path again (the simulator was still connected as r1 when r2 was intended); same final screen |
| 07:42:14 to 07:42:55 | r2 `+2547***5322` | 4 | (dial), 1, ####, #### | E1 on the first PIN, then END Signed in as GA6R..ZCNA / Balance 2.00 USDC / Last received 2.00 USDC, 7 Oct / Test only, no funds move |
| 07:44:27 to 07:44:44 | r3 `+2547***5333` | 3 | (dial), 1, #### | END Signed in as GADZ..HMBZ / Balance 2.50 USDC / Last received 2.50 USDC, 7 Oct / Test only, no funds move |
| 07:45:00 to 07:45:03 | r3 | 2 | (dial), 2 | END Saleem, a payment service for basic phones. / saleem.digital / Test only, no funds move |
| 07:47:44 to 07:47:57 | r5 `+2547***5355` | 3 | (dial), 1, #### | END Signed in as GCKM..XAAX / Balance 3.50 USDC / Last received 3.50 USDC, 7 Oct / Test only, no funds move |
| 07:50:08 to 07:50:31 | r4 `+2547***5344` | 6 | (dial), 1, ####, ####, ####, #### | Create a 4 digit PIN; two entries answered A-4 "That PIN is too easy to guess"; the third accepted, Enter the PIN again; after the matching entry the PIN was saved (event `pinSaved`) and the account read failed, END Service unavailable. / Please try again later. (E4) |
| 07:50:38 to 07:50:45 | r4 | 3 | (dial), 1, #### | END Signed in as GBFQ..FAVO / Balance 3.00 USDC / Last received 3.00 USDC, 7 Oct / Test only, no funds move |

The balances and "Last received" amounts match the batch of 7 October
(1.5, 2, 2.5, 3 and 3.5 USDC, ledgers 5071608 to 5071614). r4 was planned
as one attempt; the second dial followed the E4 answer.

### Finding while running

r4's first session ended with E4 immediately after the PIN was saved. The
service log shows `event=viewFailed code=TypeError`: the Horizon client
rethrows a failed `fetch` as the runtime's TypeError when the failure is
neither a timeout (which becomes `HorizonTimeoutError`) nor a Horizon
status (which becomes `HorizonResponseError`), so this was a transport
failure on one of the two Horizon reads, not a timeout and not a Horizon
error response. The same two reads succeeded 14 seconds later in the
second session. E4 is the designed answer for any failure to read the
account (N-3); the PIN was saved before the read, which is why the second
dial went straight to "Enter your PIN". The `viewFailed` log line carries
no cause for an uncoded error; adding the underlying error code to that
line is a follow-up.

### Offline checks

Suite 143 passed, 2 skipped; typecheck clean; secret scan clean.

## 2026-10-11: synthetic numbers moved to the non-assignable +999 range; dashboard captures masked

### What this entry records, in plain language

Until this date the five recipient numbers in the committed disbursement
file, the numbers in the unit tests, the live test's generated numbers and
the Deliverable 1 retest script's number were drawn from `+2547` followed
by random digits. That range is live Kenyan mobile numbering, so a random
draw can be the number of a real subscriber, and five such numbers were
bound to testnet accounts in the SDP tenant and shown in full in two
dashboard captures. Whether any of them belongs to someone cannot be
known; the earlier sentence saying they "belong to no one" is withdrawn
and removed from the 7 October entry (Deliverable 4, part 2) by ruling of
11 October 2026. This is the only edit ever made inside an earlier entry.

### What changed

- Tests, the live provisioning test, `scripts/retest-d1.mjs`, the
  readiness probe number and the masking examples now use the `+999`
  country code, which is not assignable to any network (the adapter's own
  tests use the same convention).
- `docs/evidence/d2-disbursement.csv` now carries the same five accounts
  and amounts under `+9997...` numbers whose last four digits match the
  masked forms used throughout this file (`+9997***5311` and so on). Its
  SHA-256 is `e156c2eb9fea48d3e65427548c88106f513bb206f234bcba453aca8d071c5072`. The file as uploaded to the SDP on 7 October
  carried the `+2547` numbers and had SHA-256
  `b4d8c873d47644ff5a45b2ab3b025be2a1834ac8446f917cdef0e73345e6a88f`;
  git history keeps that version, so the numbers remain in history.
- `docs/evidence/d4-disbursement-completed.png` and `-2.png` showed the
  five numbers in full in the Contact info column. Both are replaced by
  copies with that column masked to the convention; the originals remain
  in git history. `d4-payments.png` and `-2.png` show no number and are
  unchanged.
- The SDP tenant on the evidence machine still holds the five receivers
  under the `+2547` numbers from 7 October; they are not re-registered.
  Any new provisioning run uses `+999` numbers.
- The masked transcripts in `docs/evidence/*.json` carry only masked
  forms (`+2547***5311`) and are unchanged.

### Offline checks

Suite, typecheck and secret scan: recorded in the pull request that
carries this entry.

## 2026-10-12: Merges and Africa's Talking approval

### What this entry records, in plain language

The five pull requests of this sprint were merged on 12 October 2026,
in order, after review and approval; and Africa's Talking approved, the
same day, the written change request on the USSD menu that the service
order requires before production.

### Merges (12 October 2026, UTC)

| Pull request | Into | Time | Merge commit |
|---|---|---|---|
| #5 D5: review fixes for pull requests 1 to 4 | d4-batch-evidence | 17:20 | `c3ad1f9` |
| #4 D4: end-to-end batch and evidence package | d3-ussd-balance-view | 17:22 | `c4f5734` |
| #3 D3: USSD receive and balance view | d2-provisioning-bridge | 17:23 | `e60bbda` |
| #2 D2: recipient provisioning bridge | d1-sdp-testnet-tenant | 17:24 | `a03e8c0` |
| #1 D1: SDP 7.0.0 testnet tenant | main | 17:25 | `70d0117` |

main at `70d0117` holds every deliverable with the fixes of #5; the last
D5 commit, `9c8fee5`, is an ancestor of it. The adapter's note, pull
request #17 of `saleempay/stellar-ussd-sep10-adapter`, was merged the
same day as `03b50c9`; the bridge's submodule pin (`4c235f87`) is
unchanged.

Approvals: ismo90 approved #2, #3, #4 and #5 on 12 October (#5 at
`9c8fee5`, after verifying the last finding's fix), and #1 at 12:23 UTC.
GitHub dismissed two of his approvals automatically when new commits
were added to the pull request's branch: the approval of #4 when #5
merged into d4-batch-evidence, and the approval of #1 when #2 merged
into d1-sdp-testnet-tenant. The second follows from the protection rule
on main, which dismisses stale approvals. rasoliman approved #5, #3 and
#2 that afternoon, approved #4 again after the dismissal, and approved #1
at 17:24 UTC; #1 was merged on his approval. A GitHub incident affecting
Actions, Pull Requests and Issues that afternoon delayed the display of
pull request states; the merges completed in the order above.

### Africa's Talking approval (12 October 2026)

The written notice on the walkthrough (deviation D-1, additions A-1 to
A-11, and the closing line of screens 7 and 8) was sent on 12 October
2026 and Africa's Talking approved the change request the same day. In
the same reply Africa's Talking stated that a callback change takes
about 5 minutes to take effect on the sandbox and in production alike;
that its USSD callbacks come from three addresses, 18.133.205.228,
35.177.236.113 and 3.8.44.1 (the 11 October record shows the first);
that roaming works as in Kenya; and that the production service code is
mapped after payment. The integration guide and `.env.example` record
the first two in the pull request that carries this entry.

### Offline checks

Suite, typecheck and secret scan: recorded in the pull request that
carries this entry.

## 2026-10-18: the gateway's reply of 12 October recorded in full; the sandbox fault closed

### What this entry records, in plain language

The written reply from Africa's Talking of 12 October 2026, 13:54 UTC, to
the walkthrough notice is recorded here in full, because it closes
several open items at once; and the sandbox fault first reported on
7 October is closed as ours.

### The reply of 12 October 2026, 13:54 UTC

Africa's Talking (the USSD support address) stated:

1. The change request is approved to proceed: deviation D-1, the eleven
   additions A-1 to A-11 (`docs/walkthrough-deviations.md`), and the
   closing line of screens 7 and 8 reading "Demonstration service" in
   production in place of "Test only, no funds move" (the sandbox keeps
   the contracted line).
2. Its USSD callbacks are sent from three addresses: `18.133.205.228`,
   `35.177.236.113` and `3.8.44.1`. The capture records of 7, 10 and
   11 October show the first of them on every gateway request.
3. The shared service code works while roaming in the United Arab
   Emirates and in Portugal as it does in Kenya.
4. A callback URL change takes about five minutes to take effect, on the
   sandbox and in production alike. This matches what was observed on
   11 October (saved 07:17 and 07:22, first request on the new host at
   07:28:52).
5. The production service code is mapped once proof of payment for the
   service order's invoice reaches them; 5 Lanes sends that proof on
   18 October 2026. The callback is then set from our side in the
   dashboard, as on the sandbox.

Consequences for this repository: `USSD_ALLOWED_CIDRS` can now be set to
the three addresses (`/32` each) for any exposure beyond the sandbox
tunnel; the integration guide and `.env.example` already name all three
(`AT_CALLBACK_ALLOWLIST`, documented, not enforced). The
"Demonstration service" line is the value of `USSD_CLOSING_LINE` for a
production run (a configuration introduced on an open branch; on main the
line is still the contracted sandbox text).

### The sandbox fault, closed

The dials that failed on 7 and 10 October failed because the gateway
dashboard held the hostname of an earlier quick tunnel (the correction
entry of 11 October). The fault was ours. It was closed on 11 October,
when the five sessions after the batch were captured on the first dial
after the callback save took effect. The sandbox works; no open request
to Africa's Talking remains on it.

### Offline checks

Suite, typecheck and secret scan: recorded in the pull request that
carries this entry.
