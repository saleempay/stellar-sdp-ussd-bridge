# SDP 7.0.0 testnet tenant: setup guide

This guide brings up a Stellar Disbursement Platform (SDP) tenant on the
Stellar test network, configured for recipients who are paid straight to a
wallet address, with receiver invitations switched off. It is written for a
wallet provider or NGO with no contact with Saleem. Every command below was
run from a clean clone on 7 October 2026 (see `EVIDENCE.md`).

Testnet only. Nothing here moves real money.

## 1. What you need

| Tool | Version used | Notes |
|---|---|---|
| Node.js | 22 or newer (22 is the floor, 26.5.0 was used) | `node -v` |
| npm | 11.17.0 | ships with Node |
| Docker Engine with Compose v2 | Engine 29.x, Compose 5.6.0 | see the runtime section |
| git | any recent | to clone |

### Docker runtime

Any Docker Engine with the Compose v2 plugin works. Two tested or
documented options:

**Colima (macOS, no administrator rights needed).** This is what the
evidence run used, on an Apple M1 Pro with macOS 26.5.2:

```bash
brew install colima docker docker-compose
mkdir -p ~/.docker && cat > ~/.docker/config.json <<'JSON'
{"cliPluginsExtraDirs":["/opt/homebrew/lib/docker/cli-plugins"]}
JSON
colima start --cpu 4 --memory 6 --disk 40 --vz-rosetta
docker compose version
```

Versions used: Colima 0.10.3, Docker CLI 29.8.2, Docker Engine 29.5.2
inside the Colima VM (Ubuntu 24.04), Docker Compose 5.6.0. If
`~/.docker/config.json` already exists, add the `cliPluginsExtraDirs` entry
to it rather than replacing the file.

**Docker Desktop (macOS, Windows, Linux).** Install it from docker.com,
accept its licence terms, start it. `docker compose version` must print a
2.x or later version. No other configuration is needed.

### Apple Silicon note

The published SDP images (backend and frontend 7.0.0) are built for
`linux/amd64` only (Docker Hub manifest, 7 October 2026). On an Apple
Silicon Mac they run under emulation. Colima's `--vz-rosetta` flag uses
Rosetta, which is faster than QEMU; Docker Desktop uses Rosetta by default.
The compose file declares `platform: linux/amd64` on both services so the
pull works on every host without extra flags.

## 2. Bring the tenant up

From a clean clone (the adapter is a git submodule, so clone with
`--recurse-submodules` or run `git submodule update --init`):

```bash
git clone --recurse-submodules https://github.com/saleempay/stellar-sdp-ussd-bridge.git
cd stellar-sdp-ussd-bridge
npm ci
npm run adapter:build
npm run sdp:accounts
npm run sdp:up
```

`npm run sdp:accounts` generates every secret with a cryptographic random
source, funds the host distribution account on testnet through Friendbot,
and writes `sdp/.env` with mode 600. It prints masked addresses and the
Friendbot transaction hash, nothing else. `sdp/.env` is gitignored.

`npm run sdp:up` starts the stack and provisions two tenants. It exits
non-zero at the first failing step and names it. A second run reports
`already` on every provisioning step and changes nothing. `npm run
sdp:check` runs the same checks without starting Compose.

The first start pulls three images (about 400 MB) and runs the SDP
database migrations; on the evidence machine the whole command took 55
seconds with the images already pulled.

What `sdp:up` does, step by step:

| Step | What it does | Where this comes from (SDP tag 7.0.0) |
|---|---|---|
| `api health`, `admin health` | waits for `GET /health` on ports 8000 and 8003 | `internal/serve/serve.go:930`, `stellar-multitenant/pkg/serve/serve.go:133` |
| `tenant exists` | `GET /tenants/{name}`; creates with `POST /tenants` when absent, type `DISTRIBUTION_ACCOUNT.STELLAR.DB_VAULT` | `stellar-multitenant/pkg/serve/serve.go:140-164`, `internal/validators/tenant_validator.go:16-25` |
| `owner login` | logs in; when the password is not yet set, runs `POST /forgot-password`, reads the reset token from the dry run message in the container log, `POST /reset-password`, logs in again | `forgot_password_handler.go:38-41`, `reset_password_handler.go:25-28`, `internal/message/dry_run_client.go:17-21` |
| `invitations disabled` | `GET /organization`; `PATCH /organization` with `data={"receiver_invitations_disabled":true}` when needed; reads back | `profile_handler.go:67,162,419`, `send_receiver_wallets_invite_service.go:72` |
| `user managed wallet` | `GET /wallets?user_managed=true`; `PATCH /wallets/{id} {"enabled":true}` when needed | `wallets_handler.go:54-55`, `wallet_validator.go:48-55`, `wallets/wallets_testnet.go` |
| `usdc asset` | `GET /assets` must list USDC with the pinned testnet issuer | `assets/assets_testnet.go`, `setup_assets_for_network_service.go` |

The two tenants are `bridge` (the one the bridge uses) and `scopetest`
(exists only for the receiver scoping evidence).

## 3. Open the dashboard

Open `http://bridge.localhost:3000` and sign in as `owner@bridge.local`
with the password in `sdp/.env` (`BRIDGE_OWNER_PASSWORD`). The dashboard
sends the first label of its hostname as the tenant name (frontend 7.0.0,
`src/helpers/getSdpTenantName.ts`), and browsers resolve `*.localhost` to
the loopback address, so no hosts file entry is needed. Curl and scripts
name the tenant with the `SDP-Tenant-Name` header instead
(`internal/serve/middleware/middleware.go:404-416`).

The SDP refuses to set a default tenant unless it runs in single tenant
mode, and in that mode it ignores the tenant header
(`middleware.go:296-304`, `tenants_handler.go:319-322`). This repository
therefore runs the SDP in multi-tenant mode and always names the tenant.

## 4. Verified facts and their sources

All at tag `7.0.0` of `stellar/stellar-disbursement-platform-backend`
(commit `14704274467d267b6c6679052d7251ef6050d118`, released 19 August
2026) unless another source is named. Frontend tag `7.0.0` is commit
`0665814ddc4e0241dbd048b747c7e890058cc1a6`.

| Fact | Value | Source |
|---|---|---|
| Backend image | `stellar/stellar-disbursement-platform-backend:7.0.0` digest `sha256:54dc7b94656e2d8a84e81e32e787ecbd9ca23a61fe168b60ab4f750072bac126` | Docker Hub tags API, 7 October 2026 |
| Frontend image | `stellar/stellar-disbursement-platform-frontend:7.0.0` digest `sha256:edec92a3c3169a041364ea218ec55c905b7e869af8ecb936f0a87ca5f45ea2b7` | Docker Hub tags API, 7 October 2026 |
| Database image | `postgres:14-alpine` digest `sha256:4ea9e5ed06591da7ea23eb65465e8d3187fe79f4d5ec3ae976d29a33b013e77a` | `dev/docker-compose-sdp.yml` names the tag; digest from Docker Hub, 7 October 2026 |
| Release image entrypoint | `./stellar-disbursement-platform`, working directory `/app` | `Dockerfile` |
| Start sequence | `db admin migrate up`, `db tss migrate up`, `db auth migrate up --all`, `db sdp migrate up --all`, `db setup-for-network --all`, `serve`; TSS: `channel-accounts ensure 1`, `tss` | `dev/docker-compose-sdp.yml`, `dev/docker-compose-tss.yml` |
| Environment variable names | as in `sdp/.env.example` | `dev/.env.example`, `cmd/serve.go` |
| Encryption passphrases | must be valid Stellar secret seeds | `cmd/utils/custom_set_value.go:164-172` |
| Testnet USDC issuer | `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5` | `internal/services/assets/assets_testnet.go`; also the path payments guide on developers.stellar.org |
| Assets seeded on testnet | EURC, USDC, XLM | `internal/services/setup_assets_for_network_service.go:22` |
| Registration contact types | `EMAIL`, `PHONE_NUMBER`, `EMAIL_AND_WALLET_ADDRESS`, `PHONE_NUMBER_AND_WALLET_ADDRESS` | `internal/data/registration_contact_type.go` |
| Wallet for wallet-address disbursements | the request must not carry `wallet_id`; the SDP picks the enabled wallet with `user_managed = true`; testnet seeds "User Managed Wallet" | `disbursement_handler.go:66-76,142-160`, `wallets/wallets_testnet.go` |
| Invitations off | organisation field `receiver_invitations_disabled`, added by migration `2026-04-24.0`; the invitation job skips the tenant when true | `internal/data/organizations.go:57`, `send_receiver_wallets_invite_service.go:72-76` |
| Wallet-address rows | the receiver wallet is marked `REGISTERED` with the supplied address at upload; a different address for a known receiver is a mismatch error; an address already bound to another receiver is a duplicate error | `internal/data/disbursement_instructions.go:160-197` |
| CSV columns | `phone, email, id, amount, verification, paymentID, walletAddress, walletAddressMemo`; `PHONE_NUMBER_AND_WALLET_ADDRESS` requires `phone` and `walletAddress` and refuses `email` and `verification` | `disbursement_instructions.go:17-24`, `disbursement_handler.go:837-900` |
| Disbursement statuses | `DRAFT`, `READY`, `STARTED`, `PAUSED`, `COMPLETED`, `CANCELED` | `internal/data/dibursements_state_machine.go` |
| Payment statuses | `DRAFT`, `READY`, `PENDING`, `PAUSED`, `SUCCESS`, `FAILED`, `CANCELED` | `internal/data/payments_state_machine.go` |
| Receiver wallet statuses | `DRAFT`, `READY`, `REGISTERED`, `FLAGGED` | `internal/data/receiver_wallets_state_machine.go` |
| Receiver scope | a receiver is in scope of a distribution account when it was created under it or that account has paid it; reads filter and writes gate on the same condition | `internal/data/receivers.go:105-119` |
| Multi-account header | `X-Wallet-Id` names the distribution account; required on writes once a tenant has more than one account | `docs/multi-wallet/api-reference.md:169-181` |
| Password policy | 12 to 36 characters with a lower case letter, an upper case letter, a digit and a special character | `stellar-auth/pkg/utils/password_validation.go` |
| Tenant resolution | `SDP-Tenant-Name` header, then hostname prefix; default tenant only in single tenant mode | `internal/serve/middleware/middleware.go:28,296-316,404-416` |

## 5. Stop, reset, inspect

```bash
npm run sdp:down            # stop; data stays in the Docker volume
node scripts/sdp-down.mjs --reset   # stop and delete the volume (tenants are gone)
docker compose --env-file sdp/.env -f sdp/docker-compose.yml logs -f sdp-api
docker compose --env-file sdp/.env -f sdp/docker-compose.yml ps
```

To start again from nothing: `--reset`, then `npm run sdp:accounts --
--force` (new accounts; the old ones stay funded on testnet and are
abandoned), then `npm run sdp:up`.

## 6. Troubleshooting

- `sdp:up` fails at `api health` after three minutes: run `docker compose
  ... logs sdp-api`. On Apple Silicon the first migration run under
  emulation can take a minute; the health check allows for that.
- `owner login` fails with "no password reset message": the SDP only
  prints the reset message when it issues a token. Check the `sdp-api` log
  for "Recipient: owner@bridge.local".
- `POST /tenants` returns 500: the host distribution account in `sdp/.env`
  must hold XLM to fund the tenant's account (`TENANT_XLM_BOOTSTRAP_AMOUNT`,
  5 XLM by default). Friendbot gives 10,000 XLM, so this only happens after
  a testnet reset: run `npm run sdp:accounts -- --force`.
- Port 8000, 8003 or 3000 already in use: stop the other process or change
  `PORT`, `ADMIN_PORT` and the frontend port mapping in
  `sdp/docker-compose.yml`.
- After a testnet reset (announced on the Stellar Dashboard) every account
  is gone: `--reset`, `sdp:accounts -- --force`, `sdp:up`.

## 7. Provisioning recipients (Deliverable 2)

```bash
npm run sponsor:setup                                   # throwaway testnet sponsor into .env
npm run provision -- --input recipients.csv --output sdp-disbursement.csv
npm run sdp:upload -- --file sdp-disbursement.csv --name "my batch"
```

`recipients.csv` has the header `phone,id,amount` (E.164 phone, your
reference, USDC amount). The command creates a sponsored account with a
USDC trustline per new number, binds the number to it in `data/accounts.json`,
and writes the SDP file in the column order of the dashboard's template:
`phone,walletAddress,walletAddressMemo,id,amount,paymentID`. Running it
again creates nothing and writes the same bytes; the command prints the
file's SHA-256 so you can compare. `sdp:upload` creates the disbursement in
the bridge tenant and uploads the file; it does not start it. What the
binding means and what you must add before using this with real people:
`docs/identity-binding.md`.

## 8. Evidence capture

The screenshots under `docs/evidence/` are taken by
`scripts/capture-evidence.mjs`, which reads the owner password from
`sdp/.env` itself so the password never appears on a screen or in a log.
Playwright is a one-off tool, not a dependency of this package:

```bash
npm install --no-save playwright && npx playwright install chromium
node scripts/capture-evidence.mjs
```

The retest that produced the scoping and status evidence is
`node scripts/retest-d1.mjs`; it writes `test-output/retest-d1.json` with
every account masked.
