# Period report: Stellar Instaward Application 2 (progress, 12 October 2026)

Prepared for the Chapter Lead by 5 Lanes Limited (Saleem) as a progress
report ahead of the merges. Everything in it is true as of 12 October
2026. Plain English; every claim links to a file in this repository, to
GitHub, or to the Stellar test network.

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
[github.com/saleempay/stellar-sdp-ussd-bridge](https://github.com/saleempay/stellar-sdp-ussd-bridge),
with the evidence record in
[`EVIDENCE.md`](https://github.com/saleempay/stellar-sdp-ussd-bridge/blob/d5-review-fixes/EVIDENCE.md)
and the checklist in
[`docs/instaward-evidence-package.md`](https://github.com/saleempay/stellar-sdp-ussd-bridge/blob/d5-review-fixes/docs/instaward-evidence-package.md).

| Deliverable | State on 12 October | Evidence |
|---|---|---|
| 1. SDP 7.0.0 testnet tenant for basic-phone recipients | Built; reviewed; fixes awaiting approval ([pull request #1](https://github.com/saleempay/stellar-sdp-ussd-bridge/pull/1)) | one-command setup on the published 7.0.0 images; dashboard screenshots of the USDC asset, invitations off and the wallet-address contact type; the scoping and status retest |
| 2. Recipient provisioning bridge | Built; reviewed; fixes awaiting approval ([pull request #2](https://github.com/saleempay/stellar-sdp-ussd-bridge/pull/2)) | five accounts created with trustlines in one sponsored transaction each, hashes on stellar.expert; the disbursement file; a second run that changes nothing; the file accepted by the SDP |
| 3. USSD receive and balance view | Built; reviewed; fixes awaiting approval ([pull request #3](https://github.com/saleempay/stellar-sdp-ussd-bridge/pull/3)) | the walkthrough screens word for word; live session sets on the sandbox, one passed by the automated harness; a 27 second video of a first-use session with the PIN blurred |
| 4. End-to-end batch and evidence package | Built; reviewed; fixes awaiting approval ([pull request #4](https://github.com/saleempay/stellar-sdp-ussd-bridge/pull/4)) | 20 USDC from Circle's testnet faucet; the batch of five payments completed in 46 seconds, each confirmed on Horizon; the five recipients' USSD sessions after the batch; the integration guide verified from a clean clone; the evidence package |

## Review and merge state

- **Reviewed.** Ismael Mbouna (ismo90), the build lead, reviewed pull
  requests 1 to 4 on 10 October: four reviews and 22 inline comments,
  each checked against the SDP source at 7.0.0.
- **Answered.** His findings are answered in
  [pull request #5](https://github.com/saleempay/stellar-sdp-ussd-bridge/pull/5),
  one commit per finding, each with a regression test, under the rulings
  of 11 October. On 12 October he verified the fix round against the same
  method and found every finding closed except one, which is to be fixed
  before he approves: an account creation whose submission times out on
  the client side may still land on the network within the transaction's
  120 second time bound, so a re-run or re-dial inside that window could
  create a second account. Three minor points can follow. Pull request #5
  is awaiting his approval after that fix.
- **Nothing is merged yet.** The four pull requests are open, each built
  on the one before it (#1 on main, #2 on #1, #3 on #2, #4 on #3), with
  #5 into #4, so they merge in order once approved. Every one passes the
  automated checks (install, typecheck, offline tests, secret scan).
  Merge is planned by 16 October.
- **The adapter (Application 1).** The one change the bridge needed on
  the adapter, [pull request #15](https://github.com/saleempay/stellar-ussd-sep10-adapter/pull/15),
  was approved by Ismael and merged on 7 October. It was merged as a
  merge commit with GitHub's default message rather than the agreed
  squash, so a short note recording what happened and why nothing needs
  reverting was opened as
  [pull request #17](https://github.com/saleempay/stellar-ussd-sep10-adapter/pull/17)
  (approved by Ismael on 7 October, not yet merged). The bridge pins
  the adapter to the merge commit, `4c235f87`, which has the same content
  as the approved commit (`EVIDENCE.md`, "Deliverable 4, part 4").

## Evidence rows

Every one of the 23 rows in the evidence package is complete and
verifiable. Row 4.3, each recipient seeing the payment over USSD, was
captured on 11 October: the five recipients were dialled in the sandbox
simulator and recorded as a masked transcript, the first live run of the
service on the pinned adapter (`EVIDENCE.md`, "2026-10-11: Deliverable 4,
part 3, third attempt"). The dials that failed on 7 and 10 October failed
because the gateway dashboard held the hostname of an earlier quick
tunnel, which changes on every start; there was no gateway fault
(`EVIDENCE.md`, "2026-10-11: correction"). Every transaction hash, ledger
number, operation and amount in the package was re-checked against
Horizon and stellar.expert on 12 October 2026 and nothing had moved.

**Video.** One clip exists: the 27 second recording of a first-use
session on the sandbox simulator
(`docs/evidence/d3-ussd-provisioned-path-r5-2026-10-07.mp4`, 7 October).
The demo video cut of the five sessions after the batch remains to be
made from the captured sessions.

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
   a defect for the bridge's route (one tenant, one paying account); the
   integration guide records that the isolation boundary is the tenant
   and never the distribution account (`EVIDENCE.md`, Deliverable 1).
2. **USSD walkthrough deviation.** The menu follows the walkthrough
   attached to the Africa's Talking service order word for word, with one
   deviation: a recipient provisioned by the bridge (account exists, no
   PIN) sets a PIN and is taken straight to the account screen, skipping
   "PIN saved / 1. Create your account and continue" and "Account ready".
   Eleven small additions (error and edge screens the walkthrough does not
   cover) are listed with their exact text in
   `docs/walkthrough-deviations.md`. The written notice to Africa's
   Talking that this requires before any production use is drafted in
   `docs/africas-talking-walkthrough-notice-v1.md`, for Ramy Soliman to
   send.
3. **Adapter pull request.** The bridge reuses Application 1's adapter by
   import. One optional field was needed on its HTTP listener (an
   injectable step handler), proposed as adapter pull request #15. The
   reviewer requested changes (a cache eviction case for custom handlers,
   documentation and tests); the fix round was completed and the pull
   request approved and merged on 7 October (see "Review and merge
   state" for the merge message and the note in #17). The bridge pins the
   adapter to the merge commit.

## What remains

| Item | Date |
|---|---|
| Close the one open finding on pull request #5 (the creation time bound) with a regression test, then Ismael's approval | 14 October |
| Merge the bridge's pull requests in order, #1, #2, #3, #4 with the fixes of #5 | by 16 October |
| The demo video cut of the five USSD sessions after the batch, from the sessions captured on 11 October | by 16 October |
| Merge of the adapter's note pull request #17 | by 16 October |
| Send the written notice to Africa's Talking on the walkthrough deviation and additions (drafted; Ramy Soliman's step) | by 16 October |
| Close of the statement-of-work window | 3 November |

Four days remain to the planned completion date of 16 October and 22 to
the end of the statement-of-work window on 3 November.
