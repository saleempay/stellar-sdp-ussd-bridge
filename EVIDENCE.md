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

- Bridge branch `d3-ussd-balance-view`; adapter submodule pinned
  **temporarily** to `6a0dd6182cbfa0aef31befb19dda5079d7b8b3f7`, the head
  of adapter PR saleempay/stellar-ussd-sep10-adapter#15 ("Make the USSD
  step handler injectable"), to be re-pinned to the merge commit on main
  when it lands
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
