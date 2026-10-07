# House rules for this repository

These rules apply to every contributor and every tool working in this
repository, human or automated. They are short on purpose. When a rule here
and a convention elsewhere disagree, this file wins.

## What this repository is

A bridge between the Stellar Disbursement Platform (SDP) and basic phones
over USSD. It depends on the published adapter
`saleempay/stellar-ussd-sep10-adapter` at a pinned commit. It carries no
dependency on any Saleem platform code, by design, and must never import,
read or reference the `saleem-platform` repository.

## Network and secrets

- Testnet only. No mainnet endpoint, key, asset, issuer or configuration
  anywhere in this repository, in any branch.
- No production signer and no custody provider. The reference signer from
  the adapter is the only signer.
- Never print or commit a secret: seeds, secret keys, JWTs, API keys,
  passwords, PINs, USSD callback paths, tunnel URLs, SDP admin credentials.
  `.env` files are gitignored. `.env.example` files hold names only.
- In reports, documents and evidence, mask Stellar accounts as the first 4
  and last 4 characters. Transaction hashes are written in full.

## Verify before you pin

Every fact about Stellar or SDP that the code or the documents rely on
(release tags, image digests, configuration names, CSV headers, API routes,
asset issuers, Horizon endpoints) is checked against the upstream
repository at the pinned version or the official documentation, and the
source is cited next to the fact. Nothing of that kind is written from
memory.

## Git and pull requests

- One branch and one pull request per deliverable. Pull request titles start
  with the deliverable number, for example `D1: ...`.
- No attribution trailers of any kind in commits, pull request titles or
  pull request bodies: no `Co-authored-by`, no "generated with" lines, no
  tool names. Pull request bodies end with the line
  `5 Lanes Limited · ADGM-registered · saleem.digital`.
- Check the last commit before pushing: `git log -1 --format=%B` must show
  no trailer.
- House style for all authored text, in code comments, documents, commit
  messages and pull request bodies: no em dashes and no en dashes. Use
  commas, colons or parentheses. Write ranges with the word "to".
- Plain English in all documents, suitable for non-native readers. No
  marketing language.
- Git identity for automated commits: `devopssaleempay <devops@saleempay.io>`.

## Review and merge

- Every pull request requests review from `ismo90` and `rasoliman`.
- Nothing merges without an approving review. Merges are squash merges with
  an explicitly supplied subject and body, never a message composed by the
  GitHub user interface, and only when the repository owner says so.
- Files on the sensitive surface (sponsor account handling, signing, PIN
  handling, callback authentication) need `ismo90`'s approval even for a
  change that looks trivial.
- Review comments are assessed in the planning session before any fix is
  started. A fix round carries a regression test that reproduces the
  reviewer's probe.

## Working rhythm

1. Design proposal, then stop and wait for the go-ahead.
2. Build on the deliverable branch, with tests.
3. Open the pull request, then stop.
4. Fix round from a supplied fix prompt, with regression tests.
5. Re-review, then squash merge when told.

## Tests and continuous integration

Every pull request runs the full offline suite in CI (install, typecheck,
tests, secret scan) and states the result in its description. Live testnet
and gateway runs stay out of CI; their evidence is a recorded run with
transaction hashes in `EVIDENCE.md`.
