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
