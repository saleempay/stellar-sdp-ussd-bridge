# Period report, draft: Stellar Instaward Application 2

Prepared 7 October 2026 and refreshed 10 October 2026 for the Chapter
Lead, by 5 Lanes Limited (Saleem). Plain English; every claim links to a
file in this repository, to GitHub, or to the Stellar test network.

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
[`EVIDENCE.md`](https://github.com/saleempay/stellar-sdp-ussd-bridge/blob/d4-batch-evidence/EVIDENCE.md)
and the checklist in
[`docs/instaward-evidence-package.md`](https://github.com/saleempay/stellar-sdp-ussd-bridge/blob/d4-batch-evidence/docs/instaward-evidence-package.md).

| Deliverable | State on 10 October | Evidence |
|---|---|---|
| 1. SDP 7.0.0 testnet tenant for basic-phone recipients | Built; under review ([pull request #1](https://github.com/saleempay/stellar-sdp-ussd-bridge/pull/1)) | one-command setup on the published 7.0.0 images; dashboard screenshots of the USDC asset, invitations off and the wallet-address contact type; the scoping and status retest |
| 2. Recipient provisioning bridge | Built; under review ([pull request #2](https://github.com/saleempay/stellar-sdp-ussd-bridge/pull/2)) | five accounts created with trustlines in one sponsored transaction each, hashes on stellar.expert; the disbursement file; a second run that changes nothing; the file accepted by the SDP |
| 3. USSD receive and balance view | Built; under review ([pull request #3](https://github.com/saleempay/stellar-sdp-ussd-bridge/pull/3)) | the walkthrough screens word for word; three live session sets on the sandbox, one passed by the automated harness; a 27 second video of a first-use session with the PIN blurred |
| 4. End-to-end batch and evidence package | Batch built and confirmed; the recorded USSD sessions after the batch are outstanding; under review ([pull request #4](https://github.com/saleempay/stellar-sdp-ussd-bridge/pull/4)) | 20 USDC from Circle's testnet faucet; the batch of five payments completed in 46 seconds, each confirmed on Horizon; the integration guide verified from a clean clone; the evidence package |

## Review and merge state

- **Merged into the bridge's main branch:** nothing yet. The four pull
  requests are open, each built on the one before it (#1 on main, #2 on
  #1, #3 on #2, #4 on #3), so they merge in order. Every one passes the
  automated checks (install, typecheck, offline tests, secret scan).
- **Under review:** all four, review requested from Ramy Soliman
  (rasoliman). The build lead, Ismael (ismo90), was invited to the
  repository on 7 October and the invitation had not been accepted by
  10 October, so his review cannot be requested until it is.
- **The adapter (Application 1):** the one change the bridge needed on
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

Of the 23 rows in the evidence package, 22 are complete and verifiable
today. Every transaction hash, ledger number, operation and amount in the
package was re-checked against Horizon and stellar.expert on 10 October
2026 and nothing had moved. The one open row is 4.3, each recipient
seeing the payment over USSD, which needs the recorded sandbox sessions
described below.

**Clips.** One clip exists: the 27 second recording of a first-use session
on the sandbox simulator
(`docs/evidence/d3-ussd-provisioned-path-r5-2026-10-07.mp4`, 7 October).
The five clips showing each recipient's paid balance after the batch have
not yet been recorded; the sandbox gateway failed for the rest of 7
October (finding 4) and the session is the first item when the gateway
test dial passes.

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
   `docs/walkthrough-deviations.md`. The written notice to Africa's
   Talking that this requires before production is drafted in
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
4. **Sandbox gateway on 7 October.** The Africa's Talking sandbox served
   the bridge from 12:40 to 13:26 UTC and then failed every dial within a
   second, without contacting the callback, for the rest of the day (the
   gateway's Sessions log shows 1 hop and 1 second per failure). The
   recorded sessions showing each recipient's paid balance are therefore
   outstanding.

## What remains

- The recorded USSD sessions after the batch (five recipients, the
  returning path with one wrong PIN, and the About screen), then
  evidence row 4.3 and the demo video cut.
- Review and merge of the bridge's four pull requests, in order #1, #2,
  #3, #4, by the project's two reviewers.
- Merge of the adapter's note pull request #17.
- Sending the written notice to Africa's Talking on the walkthrough
  deviation and additions (drafted; Ramy Soliman's step).

Six days remain to the planned completion date of 16 October and 24 to
the end of the statement-of-work window on 3 November.
