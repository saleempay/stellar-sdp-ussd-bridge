# Deviations from and additions to the USSD walkthrough v1

Basis of the written notice to Africa's Talking before production. The
contract is `docs/ussd-menu-walkthrough-v1.md` (attached to the service
order signed 30 September 2026). Everything the bridge renders that is not
word for word in that document is listed here with its id, its trigger and
its exact text. Rulings: 7 October 2026 (Ramy Soliman).

Line breaks are shown as ` / `. All texts fit the 160 character response
budget (156 characters of text after the gateway prefix).

## Deviation

| Id | Trigger | What changes |
|---|---|---|
| D-1 | the number already has an account (provisioned by the SDP operator through the bridge) but no PIN | After screen 2 (Create a 4 digit PIN) and screen 3 (Enter the PIN again), screen 7 (the account screen) is shown directly. Screens 4 (PIN saved / 1. Create your account and continue) and 5 (Account ready / Enter your PIN) are not shown, because the account already exists. |

## Additions

| Id | Trigger | Exact text |
|---|---|---|
| A-1 | screen 7 when the account has not yet received a USDC payment | `Signed in as GD4I..J24Z / Balance 0.00 USDC / No payments received yet / Test only, no funds move` (the third line replaces the "Last received" line) |
| A-2 | on screen 1, an input other than 1 or 2; on screen 4, an input other than 1 | `Invalid choice` as a first line, then the screen unchanged |
| A-3 | on screen 2, an entry that is not exactly four digits | `PIN must be exactly 4 digits / Create a 4 digit PIN` |
| A-4 | on screen 2, a PIN on the weak list (for example 1234 or 0000) | `That PIN is too easy to guess / Choose a less obvious one` |
| A-5 | on screen 3, the two entries differ (the walkthrough says screen 2 is shown again) | `PINs did not match / Create a 4 digit PIN` |
| A-6 | on screen 5 or 6, an entry that is not exactly four digits | `PIN must be exactly 4 digits / Enter your PIN` |
| A-7 | E1 with one attempt left | `Wrong PIN. 1 attempt left / Enter your PIN` |
| A-8 | the PIN was verified but no account is mapped to the number (the account record was lost) | `PIN accepted / 1. Create your account and continue` (never "PIN saved" after a verification) |
| A-9 | the account exists but cannot hold USDC (no trustline) | `Your account cannot hold USDC yet. / Try again later.` (session ends) |
| A-10 | the last payment is from an earlier year than the current one | `Last received 10.00 USDC, 24 Oct 2025` (the year is appended) |
| A-11 | a callback arrives for a session the service no longer holds | the service answers `The session has expired` as a final screen (the walkthrough attributes E5 to the gateway) |

## Notes (no screen change)

| Id | Note |
|---|---|
| N-1 | Amounts are shown with two decimals by cutting the chain value (seven decimals), never rounding up: 12.999 shows 12.99. Dates are the UTC date of the payment, day without leading zero and the three-letter English month. |
| N-2 | E3 (No account found for this number. Dial again to set up.) is shown when the account mapped to the number does not exist on the network, or when the number has no account and account creation on dial is switched off (`USSD_CREATE_ON_DIAL=false`, the operator-provisioned posture). In the demonstration build creation on dial is on. |
| N-3 | E4 (Service unavailable. Please try again later.) covers every failure to read the account from Horizon within the time budget and a failed account creation on dial. |
| N-4 | The "Last received" line considers the newest 200 operations of the account; an account whose last 200 operations hold no incoming USDC payment shows A-1. |

## Already notified in the walkthrough itself

Section 7 of the walkthrough records that the sandbox build's main menu
("Saleem Stellar test / 1. Sign in and deposit / 2. About") becomes screen
1 before production. The bridge renders screen 1.
