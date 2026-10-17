# Merge plan

State as of 17 October 2026. This file records how the Application 2 pull
requests reached main, and sets out the order, commands and squash
messages for the pull requests that are still open. Merges are made by
Ramy Soliman (rasoliman); nobody else merges. The branch protection on
main requires one approval, dismisses stale approvals when new commits
are added to a pull request's branch, and is enforced for administrators.

## House rule on reviewers

A pull request that touches sponsor handling, signing or PIN handling
needs Ismael Mbouna (ismo90) as a reviewer and his approval before it is
merged. Others need one approval from any collaborator.

| Pull request | Sponsor handling | Signing | PIN handling | Needs ismo90 |
|---|---|---|---|---|
| #1 to #5 (Application 2) | yes (#2, #5) | yes (#2, #5: the reference signer) | yes (#3, #5) | yes; approved by him on 12 October |
| #7 docs | no | no | no | no (he approved anyway) |
| #8 L2 network configuration | yes (`--no-fund` on both setup scripts, Friendbot off testnet) | no new signer; authentication to the SDP (MFA) | no | yes |
| #9 L3 caps and batch guards | yes (the sponsor funding preflight and the caps in `parseInputCsv`) | no | no | yes |
| #10 L4a injected signer | yes (`SPONSOR_PUBLIC_KEY` pairing) | yes (the signer seam) | no | yes |
| this docs pull request | no | no | no | no |

## Part 1. Application 2: the plan as executed

The original plan was to merge #1 into main as a squash, then retarget
#2, #3 and #4 to main in turn, rebase each, wait for CI, and squash. That
plan was overtaken on 12 October: the four were approved by both
reviewers after the fix round in #5 and merged in stack order as merge
commits, each into its stacked base, with #1 into main last. main holds
every deliverable with the fixes of #5. Nothing in Part 1 is left to do.

| Pull request | Into | Merged (12 October, UTC) | Merge commit |
|---|---|---|---|
| #5 D5: review fixes for pull requests 1 to 4 | d4-batch-evidence | 17:20 | `c3ad1f9` |
| #4 D4: end-to-end batch and evidence package | d3-ussd-balance-view | 17:22 | `c4f5734` |
| #3 D3: USSD receive and balance view | d2-provisioning-bridge | 17:23 | `e60bbda` |
| #2 D2: recipient provisioning bridge | d1-sdp-testnet-tenant | 17:24 | `a03e8c0` |
| #1 D1: SDP 7.0.0 testnet tenant | main | 17:25 | `70d0117` |
| #7 Docs: records after the 12 October merges | main | 18:22 | `5558b66` |

The stacked branches d1 to d5 still exist on the remote. They may be
deleted once this plan is agreed; nothing open depends on them.

## Part 2. The open pull requests: #8, #9, #10

### Hold in force

Each of the three bodies carries the line "Not for merge until Instaward
Application 2 is verified" (ruling of 12 October). This part applies only
once that hold is lifted in writing.

### Preconditions, from the reviews of 13 October

ismo90 reviewed all three on 13 October (comment reviews, not approvals).
Each "should fix" below needs a fix commit with a regression test, a
one-line reply on the thread, and his re-review, before the merge steps.

| Pull request | Should fix | Minor |
|---|---|---|
| #8 (`016bdc9`) | 1. The SDP email sender is fixed to `DRY_RUN` in `sdp/docker-compose.yml` on every network, so off testnet the MFA code lands in the container log that the readiness step already reads reset links from; move the sender settings into `sdp/.env`, refuse a non-testnet network while the sender is `DRY_RUN`, and refuse the log-reading reset path off testnet. 2. "Not the testnet value" is an exact string test; check the Horizon root's `network_passphrase` against `NETWORK_PASSPHRASE` at boot instead. 3. `.env` and `sdp/.env` are never compared; `RPC_URL` is not asserted; the Postgres volume name is fixed to the testnet name. | `--no-fund` implicit off testnet; `withToken()` bypasses strict mode. |
| #9 (`b44bfb7`) | 1. The disbursement about to start is not checked against the per-payment and per-batch caps, only the account ceiling. 2. The one-batch-per-day rule counts only `COMPLETED` entries in a local file; count `started` entries, or read the day's disbursements from the SDP. | One float comparison in `--check-only`; the in-flight listing reads one page of one distribution account. Also: state in the integration guide that the guards protect the `sdp:batch` path only, and fund per batch. |
| #10 (`d449453`) | 1. CI is red: three tests spawn `scripts/provision.mjs`, which imports `dist/`, and CI never builds; add the build to CI and a vitest global setup. 2. The injected signer module is imported and its factory run before the network assertion in `provision.mjs`; move it after, and read one merged environment. | A boot self-test signature; the test number `+254700000001` should be `+999700000001`. |

### Order and steps

Stack: #8 (l2-network-config) into main; #9 (l3-caps-and-batch-guards)
is based on #8's branch; #10 (l4a-injected-signer) is based on #9's
branch. Retarget each stacked pull request before its parent branch is
deleted, or GitHub closes it.

**#8, first.**

1. Fix round, re-review, approval by ismo90 and rasoliman.
2. CI green on the final head.
3. Squash merge by Ramy with the message below. Keep the branch until #9
   is retargeted.

Squash subject: `L2: network facts from the environment, boot assertion, no-fund setup, MFA login step, configurable closing line (#8)`

Squash body:

```
Network facts (type, passphrase, Horizon, issuer, explorer base) come from
the environment with the testnet constants as defaults; a boot assertion
refuses a mixed or unacknowledged configuration and never echoes a value.
Both setup scripts take --no-fund. The owner login handles the SDP's MFA
step; off testnet the client never asks the SDP to remember the device,
a token issued without a code may only turn MFA on, and creation on dial
is refused at boot. The closing line of screens 7 and 8 is configurable.
One retry of the account read inside the session budget.

5 Lanes Limited · ADGM-registered · saleem.digital
```

**#9, second.**

1. Retarget: `gh pr edit 9 --repo saleempay/stellar-sdp-ussd-bridge --base main`
2. Rebase, from the l3 worktree, replaying only the L3 commits onto main
   (the L2 commits are now squashed into main and must not be replayed):

```
git fetch origin
git rebase --onto origin/main origin/l2-network-config l3-caps-and-batch-guards
npm run typecheck && npm test && SECRET_SCAN_BASE=origin/main sh scripts/secret-scan.sh
git push --force-with-lease origin l3-caps-and-batch-guards
```

3. The push dismisses earlier approvals under the main rule; request the
   reviews again and wait for CI green on the new head, then report the
   head and CI result before the merge.
4. Squash merge by Ramy.

Squash subject: `L3: payment, batch and account caps, batch guards with a run log (#9)`

Squash body:

```
Caps of 5 USDC per payment, 25 per batch and 100 on the distribution
account, from configuration with those defaults, enforced in the file
builder and before a batch starts, in exact stroops. Batch guards: a
disbursement in STARTED always refuses a new start; one in PAUSED refuses
unless --second-run "<reason>" is given and none of its payments can
still reach the network; one completed batch per UTC day without the
flag. A run log records every start and finish with the reason.

5 Lanes Limited · ADGM-registered · saleem.digital
```

**#10, third.**

1. Retarget: `gh pr edit 10 --repo saleempay/stellar-sdp-ussd-bridge --base main`
2. Rebase, from the l4a worktree:

```
git fetch origin
git rebase --onto origin/main origin/l3-caps-and-batch-guards l4a-injected-signer
npm run typecheck && npm test && SECRET_SCAN_BASE=origin/main sh scripts/secret-scan.sh
git push --force-with-lease origin l4a-injected-signer
```

3. Request the reviews again, wait for CI green, report head and CI.
4. Squash merge by Ramy.

Squash subject: `L4a: a signer injected from outside the repository, checked at boot (#10)`

Squash body:

```
BRIDGE_SIGNER_MODULE and BRIDGE_SIGNER_EXPORT name a module that provides
the adapter's Signer interface; the loader checks every member, treats a
function that is not itself a signer as a factory, and turns an import
failure into a configuration error without echoing the path's contents.
With an injected signer SPONSOR_PUBLIC_KEY is required, SPONSOR_SECRET_KEY
is refused, and the signer must report it can sign for the sponsor. No
signer implementation is added; the default path is unchanged.

5 Lanes Limited · ADGM-registered · saleem.digital
```

### After the three merges

Delete the branches l2-network-config, l3-caps-and-batch-guards and
l4a-injected-signer on the remote, and the worktrees locally. Record the
merge commits in `EVIDENCE.md` only if the run they prepare produces
evidence in this repository; otherwise the record lives with that run.
