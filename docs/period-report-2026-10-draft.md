# Period report, draft: Stellar Instaward Application 2

Prepared 7 October 2026 for the Chapter Lead, by 5 Lanes Limited
(Saleem). Plain English; every claim links to a file in this repository
or to the Stellar test network.

## Period and start

The statement of work runs from 5 October to 3 November 2026, with the
work planned to complete by 16 October. Work started on 7 October 2026,
after the application's confirmation, and the four deliverables were
built on that day. Everything is on the Stellar test network; the next
scheduled testnet reset is 16 December 2026 (developers.stellar.org,
"Testnet and Futurenet data reset", read 7 October 2026), after which the
network links in the evidence stop resolving while the copied ledger
records remain.

## What was delivered

The bridge lets the Stellar Disbursement Platform (SDP) pay people who
have only a basic phone: it creates their Stellar accounts, opens the
USDC trustline, binds each account to a phone number, writes the SDP's
disbursement file, and lets each recipient see what arrived over USSD.
Code, scripts and guides are public under MIT at
github.com/saleempay/stellar-sdp-ussd-bridge, with the evidence record in
`EVIDENCE.md` and the checklist in `docs/instaward-evidence-package.md`.

| Deliverable | State | Evidence |
|---|---|---|
| 1. SDP 7.0.0 testnet tenant for basic-phone recipients | Delivered (pull request #1) | one-command setup on the published 7.0.0 images; dashboard screenshots of the USDC asset, invitations off and the wallet-address contact type; the scoping and status retest |
| 2. Recipient provisioning bridge | Delivered (pull request #2) | five accounts created with trustlines in one sponsored transaction each, hashes on stellar.expert; the disbursement file; a second run that changes nothing; the file accepted by the SDP |
| 3. USSD receive and balance view | Delivered (pull request #3) | the walkthrough screens word for word; three live session sets on the sandbox, one passed by the automated harness; a 27 second video of a first-use session with the PIN blurred |
| 4. End-to-end batch and evidence package | Batch delivered; USSD session clips outstanding (pull request #4) | 20 USDC from Circle's testnet faucet; the batch of five payments completed in 46 seconds, each confirmed on Horizon; the integration guide verified from a clean clone; the evidence package |

## The batch, in one paragraph

On 7 October at 14:00 UTC the disbursement uploaded by the bridge (five
recipients, 12.50 USDC) was started through the SDP's API. All five
payments succeeded by 14:01:06 UTC. Each is a single USDC payment on the
test network from the tenant's distribution account to the recipient's
account, with its hash linked on stellar.expert, and each recipient's
balance on the ledger now equals the amount in the file.

## Findings worth the Chapter's attention

1. **SDP 7.0.0, receivers across distribution accounts.** Within one
   tenant, the receiver list is scoped to the distribution account that
   created or paid the receiver, but a direct payment names the receiver
   by id and the SDP resolves it before it checks the paying account's
   balance. In the retest, a payment to a receiver created under one
   account, sent from a second account, was refused by the balance check,
   not by scoping. Across tenants the receiver was not found. This is not
   a defect for the bridge's route (one tenant, one paying account), and
   it is recorded so the boundary is known (`EVIDENCE.md`, Deliverable 1).
2. **USSD walkthrough deviation.** The menu follows the walkthrough
   attached to the Africa's Talking service order word for word, with one
   deviation: a recipient provisioned by the bridge (account exists, no
   PIN) sets a PIN and is taken straight to the account screen, skipping
   "PIN saved / 1. Create your account and continue" and "Account ready".
   Eleven small additions (error and edge screens the walkthrough does not
   cover) are listed with their exact text in
   `docs/walkthrough-deviations.md`, the basis of a written notice to
   Africa's Talking before any production use.
3. **Adapter pull request.** The bridge reuses Application 1's adapter by
   import. One optional field was needed on its HTTP listener (an
   injectable step handler), proposed as adapter pull request #15. The
   reviewer requested changes (a cache eviction case for custom handlers,
   documentation and tests); the fix round is in progress. Until it
   merges, the bridge pins the adapter to that pull request's commit,
   stated in `EVIDENCE.md`.
4. **Sandbox gateway on 7 October.** The Africa's Talking sandbox served
   the bridge from 12:40 to 13:26 UTC and then failed every dial within a
   second, without contacting the callback, for the rest of the day (the
   gateway's Sessions log shows 1 hop and 1 second per failure). The
   recorded sessions showing each recipient's paid balance are therefore
   outstanding and are the first item of the next working day.

## What remains

- The recorded USSD sessions after the batch (five recipients, the
  returning path with one wrong PIN, and the About screen), then the
  final evidence package rows and the demo video cut.
- Adapter pull request #15: fix round, re-review, merge, and the bridge's
  re-pin to the merge commit.
- Review and merge of the bridge's four pull requests, in order.
- The written notice to Africa's Talking on the walkthrough deviation and
  additions.
