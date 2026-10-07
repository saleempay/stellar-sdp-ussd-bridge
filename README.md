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

## Repository layout

- `sdp/`: Docker Compose setup for an SDP 7.0.0 testnet tenant (Deliverable 1)
- `scripts/`: setup and readiness scripts
- `src/`: the bridge library and CLI
- `test/`: offline unit tests and flag-gated live tests
- `docs/`: setup guide, integration guide, evidence package
- `EVIDENCE.md`: dated, append-only record of live runs

## Licence

MIT. See `LICENSE`.
