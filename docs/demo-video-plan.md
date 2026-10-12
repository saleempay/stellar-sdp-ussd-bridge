# Demo video plan

Shot list for the recorded evidence. The phone in every USSD shot is the
Africa's Talking sandbox simulator in a browser; it shows PIN digits in
clear text as they are typed, so **the PIN field is blurred in the
published video**. Nothing else on screen is sensitive: account ids are
public keys, amounts are testnet USDC.

## Timing facts to keep in mind while recording

- The gateway expects each callback answered within 10 seconds (adapter
  integration guide); the service answers a busy screen at 8.5 seconds if
  work is still in flight (`DEFAULT_WATCHDOG_MS`).
- The sandbox ends a session after roughly 30 to 60 seconds without input
  (measured in the Application 1 evidence, not quoted from documentation).
  Type the next input within 20 seconds.
- Server work per screen: PIN screens are local (under 0.2 s); the account
  screen is two Horizon reads in parallel under 2.5 s each; account
  creation on dial is one Horizon submission (about 5 s measured in
  Application 1). A provisioned recipient never triggers creation.

## Deliverable 3 shots (USSD session, one provisioned recipient)

| # | Shot | What must be visible |
|---|---|---|
| 1 | Simulator with the agreed number, dial the sandbox code | screen 1: Saleem / 1. My account / 2. About |
| 2 | Enter 1 | screen 2: Create a 4 digit PIN |
| 3 | Type the PIN (blur the field) | screen 3: Enter the PIN again |
| 4 | Type the PIN again (blur) | screen 7 directly (D-1): Signed in as ..., Balance 0.00 USDC, No payments received yet, Test only, no funds move |
| 5 | Dial again, enter 1 | screen 6: Enter your PIN |
| 6 | Type a wrong PIN (blur) | E1: Wrong PIN. 2 attempts left |
| 7 | Type the right PIN (blur) | screen 7 again |
| 8 | Dial again, enter 2 | screen 8: About |
| 9 | Terminal: the capture banner | the callback path masked, the tunnel base URL only |

Shots 1 to 4 are published as `docs/evidence/d3-ussd-provisioned-path-r5-2026-10-07.mp4`
(recorded 7 October 2026). After Deliverable 4 pays the batch, each
recipient records shots 5 to 7 (returning path: Enter your PIN, screen 7
with the paid balance and the "Last received" line), one of them with the
wrong PIN first (E1) and one with About (shot 8).

## Deliverable 1, 2 and 4 shots

| # | Shot | What must be visible |
|---|---|---|
| 10 | SDP dashboard, Settings | Disable receiver invitations on |
| 11 | SDP dashboard, Wallet Providers | User Managed Wallet enabled |
| 12 | Terminal: `npm run provision` | five rows created, then five unchanged on the second run, identical SHA-256 |
| 13 | SDP dashboard, Disbursements | the uploaded disbursement, READY, five receivers REGISTERED |
| 14 | SDP dashboard, after D4 | the batch COMPLETED with each payment's status |
| 15 | stellar.expert testnet | one payment transaction |
