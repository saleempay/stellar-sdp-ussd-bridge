# Instaward evidence package: Application 2

The single document to verify this submission from. One row per evidence
line of the statement of work, each a link to click or one command to run,
with the answer you should see. No programming knowledge is needed; the
commands are copy and paste in a terminal from a clone of this repository
(`git clone --recurse-submodules https://github.com/saleempay/stellar-sdp-ussd-bridge.git`).

Everything is on the Stellar test network. Stellar testnet resets clear
every account and transaction; the next scheduled reset is **16 December
2026** (developers.stellar.org/docs/networks, "Testnet and Futurenet data
reset", read 7 October 2026). After a reset the stellar.expert links below
stop resolving; the ledger records copied into `EVIDENCE.md` remain.

Masking convention: accounts are shown as the first 4 and last 4
characters; phone numbers as the country prefix and the last 4 digits;
every PIN as `####`. Transaction hashes are complete.

Verification: every link, hash, ledger number, operation and amount below
was re-checked against Horizon (horizon-testnet.stellar.org), stellar.expert
and GitHub on **10 October 2026**; nothing had moved. The CSV checksum in
row 2.2 was recomputed the same day and matches.

## Deliverable 1: SDP testnet tenant for basic-phone recipients

| # | What to check | How | Expected |
|---|---|---|---|
| 1.1 | Setup scripts and guide in the MIT repository | open `docs/sdp-setup.md`, `sdp/docker-compose.yml`, `scripts/sdp-up.mjs`, `LICENSE` | the guide names SDP 7.0.0 and every fact's source; the licence is MIT, 5 Lanes Limited |
| 1.2 | Tenant configuration: USDC asset | open `docs/evidence/d1-distribution-account.png` | the trustline list shows USDC with issuer `GBBD47IF...LLFLA5` |
| 1.3 | Tenant configuration: invitations off | open `docs/evidence/d1-settings-invitations-off.png` | the "Disable receiver invitations" switch is on |
| 1.4 | Tenant configuration: wallet-address contact type | open `docs/evidence/d1-new-disbursement-form.png` | contact method "Wallet Address and Phone Number", wallet "User Managed Wallet", asset USDC |
| 1.5 | One command brings the tenant up | `npm ci && npm run adapter:build && npm run sdp:accounts && npm run sdp:up` (Docker running; about 2 minutes) | the last line reads `SDP up and provisioned` and every step shows `ok`, `done` or `already` |
| 1.6 | Retest on 7.0.0: receiver scoping and batch status | read `EVIDENCE.md`, section "Retest: receiver scoping and batch status on 7.0.0" | the table of observed answers, including the 404 from the other tenant and the 409 before funding |

## Deliverable 2: recipient provisioning bridge

| # | What to check | How | Expected |
|---|---|---|---|
| 2.1 | Five account creations with trustline, on stellar.expert | click each: [c677c443](https://stellar.expert/explorer/testnet/tx/c677c443c7096959eee34d5948551344c4be2d28c75df32fd8b45f9e8447a3cb), [b2e15c28](https://stellar.expert/explorer/testnet/tx/b2e15c288f5b24725318a5a0f318f793f03d1e0b034aeb54c44d9c21fd145d3e), [7601407b](https://stellar.expert/explorer/testnet/tx/7601407be9d0189511529337bd52f211353fe36d013be3d326080ada677f2371), [100e139e](https://stellar.expert/explorer/testnet/tx/100e139e76115756b637e1e4cfc0c501310c55e53400d8a00e90b4f9c28cf16c), [d81b61e5](https://stellar.expert/explorer/testnet/tx/d81b61e5c903adafa1c6012b0b4a4f7565d4c2bfdbb15e3b00dcc0bea0260d29) | each shows 4 operations: begin sponsoring, create account (0 XLM), change trust USDC, end sponsoring; ledgers 5068901 to 5068905 |
| 2.2 | The SDP disbursement file produced by the bridge | open `docs/evidence/d2-disbursement.csv` | header `phone,walletAddress,walletAddressMemo,id,amount,paymentID`, five rows; its SHA-256 is `b4d8c873d47644ff5a45b2ab3b025be2a1834ac8446f917cdef0e73345e6a88f` (`shasum -a 256 docs/evidence/d2-disbursement.csv`) |
| 2.3 | A second run creates nothing | read `EVIDENCE.md`, "Second run: nothing changes" | five `unchanged`, sponsor transaction count unchanged, identical file |
| 2.4 | The file is accepted by the SDP | read `EVIDENCE.md`, "Upload to the SDP tenant" | disbursement `fa63ed05...` READY, five receiver wallets REGISTERED, no invitation |
| 2.5 | What the binding is and is not | open `docs/identity-binding.md` | states that no PIN is set by provisioning and what an adopter must add |

## Deliverable 3: USSD receive and balance view

| # | What to check | How | Expected |
|---|---|---|---|
| 3.1 | Video of a USSD session on the sandbox simulator | play `docs/evidence/d3-ussd-provisioned-path-r5-2026-10-07.mp4` (27 s) | dial, main menu, 1, Create a 4 digit PIN (blurred entry), Enter the PIN again (blurred), the account screen with `Balance 0.00 USDC` and `No payments received yet` |
| 3.2 | The screens match the contractual walkthrough | `npm test` | `ussdScreens.test.ts` passes: every walkthrough screen rendered word for word, every screen within 156 characters |
| 3.3 | The live test on the sandbox passed | read `EVIDENCE.md`, "Session set 3: recipient r3, through the live test harness, PASSED" | eight callbacks, provisioned path, one wrong PIN, returning path, every answer under 2.5 s |
| 3.4 | Masked transcripts | open `docs/evidence/d3-ussd-sandbox-test-2026-10-07.json` | every PIN position reads `####`, phone numbers masked |
| 3.5 | The deviations list for the written notice | open `docs/walkthrough-deviations.md` | D-1 and A-1 to A-11 with triggers and exact texts |

## Deliverable 4: end-to-end batch and evidence package

| # | What to check | How | Expected |
|---|---|---|---|
| 4.1 | Batch completed with each recipient's status | open `docs/evidence/d4-disbursement-completed.png` and `-2.png`; `docs/evidence/d4-batch-2026-10-07.json` | 5 successful payments, 0 failed, 12.50 USDC disbursed; each of the five receivers shows Success and a transaction hash; the JSON timeline ends `COMPLETED` |
| 4.2 | Payment hashes on stellar.expert | click each: [94badd0d](https://stellar.expert/explorer/testnet/tx/94badd0d32b62ecf7127e1e7f7d71d8e49cd96d1fd8d1ec9fdae76b622b5c8fd) 1.5 USDC, [17c76432](https://stellar.expert/explorer/testnet/tx/17c76432e03663fa3efdf3ca21df611e7dba822df3fe880a37eeb9736c32ae94) 2 USDC, [28e34da3](https://stellar.expert/explorer/testnet/tx/28e34da3d5759861fb9e8ceee6246bda921b6fac0f49fedef7c532c787826c41) 2.5 USDC, [51c12ad4](https://stellar.expert/explorer/testnet/tx/51c12ad4271c3bc3a9b5783380ce0cb7acd8eb99bcbc8a1d916e02b96fd0e2d9) 3 USDC, [34c5d845](https://stellar.expert/explorer/testnet/tx/34c5d845cf26e73b5f6fcf2e5d9c60569a2b5646a5d2b4a55c704f335baa5dfa) 3.5 USDC | each a single payment of USDC from `GBTC...Y6XJ` to the recipient, ledgers 5071608 to 5071614; the funding came from the Circle faucet, [96e36ba7](https://stellar.expert/explorer/testnet/tx/96e36ba7c9cd0097579e49860476a099a2918e4999b828a232a57f16c207bcb3) |
| 4.3 | Each recipient sees the payment over USSD | OUTSTANDING on 10 October: the sandbox gateway failed every dial from 13:27 UTC on 7 October (`EVIDENCE.md`, "Deliverable 4, part 3"); the five sessions are recorded at the next session when the gateway test dial passes | screen 7 with the paid balance and the `Last received 1.50 USDC, 7 Oct` line for each recipient |
| 4.4 | Integration guide, verified from a clean clone | open `docs/integration-guide.md`; read `EVIDENCE.md`, "Clean clone verification" | every command in the guide appears in the verification run |

## Also in the package

| # | What to check | How | Expected |
|---|---|---|---|
| 5.1 | Offline checks on every pull request | open the Actions tab of the repository | `install, typecheck, offline tests, secret scan` green on PRs #1, #2, #3, #4 |
| 5.2 | Adapter dependency, pinned | `git submodule status` | one line naming `vendor/stellar-ussd-sep10-adapter` at commit `4c235f87c6af45a7c6043fe16b5eb246e148555f`, the merge of adapter pull request #15 |
| 5.3 | The one adapter change | open [saleempay/stellar-ussd-sep10-adapter pull request #15](https://github.com/saleempay/stellar-ussd-sep10-adapter/pull/15) and the note in [pull request #17](https://github.com/saleempay/stellar-ussd-sep10-adapter/pull/17) | one optional field on the listener; its review and fix round; approved and merged 7 October as `4c235f87` (a merge commit with the default message; #17 records this, content identical to the approved commit) |
