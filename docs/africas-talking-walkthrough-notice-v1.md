# Written notice to Africa's Talking: changes to the USSD menu walkthrough v1

Status: DRAFT for Ramy Soliman to send. Not yet sent.

Date: 10 October 2026

To: Maggy Nyokabi, Africa's Talking

From: Ramy Soliman, 5 Lanes Limited (Saleem), ADGM-registered, Abu Dhabi

Reference: the service order signed 30 September 2026 and its attached
walkthrough, Saleem_USSD_Menu_Walkthrough_AfricasTalking_v1 (reproduced
in this repository as `docs/ussd-menu-walkthrough-v1.md`)

Dear Maggy,

Section 7 of the walkthrough attached to our service order commits us to
notify Africa's Talking in writing of any change to the menu before it is
made. This letter is that notice. It lists one deviation from the
walkthrough and eleven additions, each with the condition that shows it
and the exact text, as built and tested on the sandbox in October 2026.

## 1. Scope of the demonstration phase: unchanged

Nothing in this notice changes the scope agreed in the service order:

- Only SIMs held by the 5 Lanes team dial the service during the
  demonstration phase (October to December 2026), including roaming use
  outside Kenya. No member of the public is served.
- The menu is read-only. It shows a balance and the last payment received
  and nothing else.
- No money moves over USSD. The service does not send money, cash out,
  buy airtime or pay bills, does not start sessions itself, and does not
  send SMS from the service code.
- The account holder pays the standard telco session charge only.
- Data handling is as stated in section 5 of the walkthrough: the phone
  number and a one-way hash of the PIN are stored; the PIN itself is never
  stored, logged or sent onward.

Every screen below fits the single-response character limit (156
characters of text after the gateway's 4 character prefix). Line breaks
are shown as ` / `.

## 2. Already notified in the walkthrough

Section 7 of the walkthrough stated that the sandbox main menu then
reading "Saleem Stellar test / 1. Sign in and deposit / 2. About" would
become screen 1 before production. That change is made. The main menu
now reads exactly as screen 1 of the walkthrough:

`Saleem / 1. My account / 2. About`

## 3. Deviation

| Id | When it happens (trigger) | What the account holder sees instead |
|---|---|---|
| D-1 | The phone number already has an account, created in advance by the paying organisation through our provisioning tool, but no PIN has been set yet. This is the normal case for a person who is paid before their first dial. | Screen 2 `Create a 4 digit PIN`, then screen 3 `Enter the PIN again`, then screen 7 (the account screen) directly. Screen 4 (`PIN saved / 1. Create your account and continue`) and screen 5 (`Account ready / Enter your PIN`) are not shown, because the account already exists and there is nothing to create. The first-use path for a number with no account is unchanged and shows screens 2, 3, 4, 5 and 7 as written. |

## 4. Additions

These are error and edge screens the walkthrough does not cover. None of
them changes any screen the walkthrough defines; each is shown only under
the condition in the trigger column.

| Id | When it happens (trigger) | Exact text |
|---|---|---|
| A-1 | Screen 7, when the account has not yet received any USDC payment. | `Signed in as GD4I..J24Z / Balance 0.00 USDC / No payments received yet / Test only, no funds move` (the third line replaces the "Last received" line; the identifier is an example, shortened to the first and last four characters as in the walkthrough) |
| A-2 | On screen 1, an input other than 1 or 2; on screen 4, an input other than 1. | `Invalid choice` as a first line, then the same screen again unchanged |
| A-3 | On screen 2, an entry that is not exactly four digits. | `PIN must be exactly 4 digits / Create a 4 digit PIN` |
| A-4 | On screen 2, a PIN on the weak list (for example 1234 or 0000). | `That PIN is too easy to guess / Choose a less obvious one` |
| A-5 | On screen 3, the two entries differ. The walkthrough says screen 2 is shown again; the addition is the first line explaining why. | `PINs did not match / Create a 4 digit PIN` |
| A-6 | On screen 5 or screen 6, an entry that is not exactly four digits. | `PIN must be exactly 4 digits / Enter your PIN` |
| A-7 | Screen E1 when one attempt is left (the walkthrough gives the text for two attempts left). | `Wrong PIN. 1 attempt left / Enter your PIN` |
| A-8 | The PIN was verified but no account is mapped to the number (the account record was lost). | `PIN accepted / 1. Create your account and continue` (the words "PIN saved" are never shown after a verification) |
| A-9 | The account exists but cannot hold USDC (no trustline). The session ends. | `Your account cannot hold USDC yet. / Try again later.` |
| A-10 | The last payment is from an earlier year than the current one. | `Last received 10.00 USDC, 24 Oct 2025` (the year is appended to the date on screen 7; figures are examples) |
| A-11 | A callback arrives for a session the service no longer holds. The walkthrough attributes E5 to the gateway; the service answers it as well, as a final screen. | `The session has expired` |

## 5. Notes that change no screen

- Amounts are shown with two decimals by cutting the chain value (seven
  decimals), never rounding up: 12.999 shows as 12.99. Dates are the UTC
  date of the payment, day without a leading zero and the three-letter
  English month.
- Screen E3 (`No account found for this number. / Dial again to set up.`)
  is shown when the account mapped to the number does not exist on the
  network, or when the number has no account and the service is set not
  to create accounts on dial.
- Screen E4 (`Service unavailable. / Please try again later.`) covers
  every failure to read the account within the time budget and a failed
  account creation on dial.
- The "Last received" line considers the newest 200 operations of the
  account; an account whose last 200 operations hold no incoming USDC
  payment shows A-1.

## 6. Request

Please confirm receipt of this notice and that the deviation and
additions above are acceptable under the service order. If Africa's
Talking requires any change to the wording, we will make it before any
production use and notify you again in writing. Until then the service
runs on the sandbox only.

Kind regards,

Ramy Soliman
5 Lanes Limited (Saleem)
saleem.digital

---

Repository note (not part of the letter): the source of every id, trigger
and text above is `docs/walkthrough-deviations.md` (rulings 7 October
2026). The screen texts are tested word for word by `test/unit/ussdScreens.test.ts`.
