# Stellar SDP USSD bridge

A bridge between the Stellar Disbursement Platform (SDP) and basic phones
over USSD.

The SDP can pay a recipient directly by phone number and wallet address,
with invitations switched off. That route needs someone to create the
recipient's Stellar account, add the USDC trustline, bind the account to the
phone number, and let the recipient see what arrived. SDP leaves all four to
the wallet provider. This bridge does them, reusing the
[stellar-ussd-sep10-adapter](https://github.com/saleempay/stellar-ussd-sep10-adapter).

Built and maintained by [Saleem](https://saleem.digital) (5 Lanes Limited).
Released under MIT so any wallet provider or NGO can use it.

## Status

Sprint in progress (October 2026). Testnet only. Nothing here moves real
funds.

Deliverable 1 (SDP 7.0.0 testnet tenant): delivered 7 October 2026. See
`docs/sdp-setup.md` for the setup guide and `EVIDENCE.md` for the live run.

Deliverable 4 (end-to-end batch and evidence package): batch delivered
7 October 2026 (five USDC payments on testnet, confirmed on Horizon);
the recorded USSD sessions after the batch are outstanding, see
`EVIDENCE.md`. Evidence package: `docs/instaward-evidence-package.md`.

Deliverable 3 (USSD receive and balance view): delivered 7 October 2026.
The menu is the Africa's Talking walkthrough v1 (`docs/ussd-menu-walkthrough-v1.md`)
with the listed additions (`docs/walkthrough-deviations.md`); a recipient
sets a PIN on first dial and sees the balance and last payment read from
Horizon. Integration guide: `docs/integration-guide.md`.

Deliverable 2 (recipient provisioning bridge): delivered 7 October 2026.
`npm run provision` turns a file of phone numbers and amounts into Stellar
accounts with USDC trustlines, bound to the numbers, and writes the SDP
disbursement file. See `docs/identity-binding.md` for what that binding is
and is not.

## Quick start

```bash
git clone --recurse-submodules https://github.com/saleempay/stellar-sdp-ussd-bridge.git
cd stellar-sdp-ussd-bridge
npm ci
npm run adapter:build    # build the vendored adapter (git submodule at a pinned commit)
npm run sdp:accounts     # testnet accounts and secrets into sdp/.env (never committed)
npm run sdp:up           # start SDP 7.0.0 with Docker Compose and provision the tenant
npm run sponsor:setup    # throwaway testnet sponsor for recipient accounts, into .env
npm run provision -- --input recipients.csv --output sdp-disbursement.csv
```

Then open http://bridge.localhost:3000 and upload `sdp-disbursement.csv`
to a disbursement with contact method "Wallet Address and Phone Number".
Requirements and every verified fact with its source: `docs/sdp-setup.md`.

## The adapter dependency

The bridge depends on
[stellar-ussd-sep10-adapter](https://github.com/saleempay/stellar-ussd-sep10-adapter)
as a git submodule pinned to commit `5a3c8dc`, linked into `node_modules`
with a `file:` dependency and built by `npm run adapter:build`. Nothing
from the adapter is copied. If you cloned without `--recurse-submodules`,
run `git submodule update --init`.

## Repository layout

- `sdp/`: Docker Compose setup for an SDP 7.0.0 testnet tenant (Deliverable 1)
- `vendor/stellar-ussd-sep10-adapter`: the adapter, as a git submodule
- `scripts/`: setup, readiness, provisioning and evidence scripts
- `src/sdp/`: typed SDP client, readiness steps, pinned facts
- `src/provision/`: the recipient provisioning bridge (Deliverable 2)
- `src/ussd/`: the USSD menu, account view and service wiring (Deliverable 3)
- `test/`: offline unit tests and flag-gated live tests
- `docs/`: setup guide, integration guide, evidence package
- `EVIDENCE.md`: dated, append-only record of live runs

## Licence

MIT. See `LICENSE`.
