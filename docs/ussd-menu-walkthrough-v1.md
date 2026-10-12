# Saleem USSD Menu Walkthrough, Africa's Talking, v1

Text of the walkthrough attached to the Africa's Talking service order
signed 30 September 2026 (Saleem_USSD_Menu_Walkthrough_AfricasTalking_v1).
This document is contractual: every screen the bridge renders must match
section 4 word for word, except as recorded in `docs/walkthrough-deviations.md`.
The screen budget test reads the screens from this file.

## Section 2. Service and code (relevant rows)

- Service: shared USSD service code, Kenya, prepaid, four-digit tier
- Who dials in: demonstration phase (October to December 2026), SIMs held by the 5 Lanes team only, including roaming use outside Kenya
- Language: English
- Screen length: every screen fits the gateway character limit for a single USSD response
- Session end: the session ends on the final screen of each path, or when the account holder cancels
- Billing to the end user: standard telco session charge only

## Section 3. Menu tree

- A. First use: Main menu > 1 > Create a 4 digit PIN > Enter the PIN again > PIN saved > 1 > Account ready, enter your PIN > Account screen
- B. Returning user: Main menu > 1 > Enter your PIN > Account screen
- C. About: Main menu > 2 > About screen (session ends)
- D. Errors: wrong PIN, too many attempts, no account, service unavailable, session timed out

## Section 4. Screens, word for word (line breaks as shown)

Each screen's text is the fenced block. Notes in parentheses are the
walkthrough's own notes, not screen text.

### Screen 1. Main menu

```
Saleem
1. My account
2. About
```

(1 goes to the account path. 2 goes to About.)

### Screen 2. Create PIN (first use only)

```
Create a 4 digit PIN
```

(the account holder enters 4 digits)

### Screen 3. Confirm PIN (first use only)

```
Enter the PIN again
```

(if the two entries match, the PIN is stored as a hash; if not, screen 2 is shown again)

### Screen 4. PIN saved (first use only)

```
PIN saved
1. Create your account and continue
```

(1 creates the account; the account holder needs no balance to open it)

### Screen 5. Account ready (first use only)

```
Account ready
Enter your PIN
```

### Screen 6. Enter PIN (returning user)

```
Enter your PIN
```

(checked against the stored hash)

### Screen 7. Account screen (session ends here; read-only; figures are examples; identifiers shortened to first and last four characters)

```
Signed in as GD4I..J24Z
Balance 12.50 USDC
Last received 10.00 USDC, 24 Oct
Test only, no funds move
```

### Screen 8. About (session ends)

```
Saleem, a payment service for basic phones.
saleem.digital
Test only, no funds move
```

### Screen E1. Wrong PIN

```
Wrong PIN. 2 attempts left
Enter your PIN
```

(after three wrong attempts, E2)

### Screen E2. Too many attempts (session ends)

```
Too many attempts.
Try again later.
```

### Screen E3. No account (session ends)

```
No account found for this number.
Dial again to set up.
```

### Screen E4. Service unavailable (session ends)

```
Service unavailable.
Please try again later.
```

### Screen E5. Session timed out (shown by the gateway)

```
The session has expired
```

## Section 5. Data handling

The service receives the MSISDN and the session identifier from the
gateway. It stores the phone number and the PIN as a one-way hash (scrypt).
The PIN itself is never stored, logged or sent onward. No card, bank or
personal identity data is collected over USSD. No marketing messages.
Session records kept for support and audit, with the PIN masked.

## Section 6. What the service does not do

Send money, cash out, buy airtime or pay bills from the menu. Start any
session itself (no push USSD). Send SMS from the service code. Charge the
account holder anything beyond the standard telco session charge. Serve
members of the public during the demonstration phase.

## Section 7. Status of the build (as stated to Africa's Talking)

Screens 2 to 6, E1 and E2 are built and tested on the sandbox. Screens 7
and 8 are the production wording and are being completed in October 2026.
The current sandbox build shows "Saleem Stellar test" and "Sign in and
deposit" on the main menu; these will read as shown in screen 1 before the
production code goes live. Any later change to the menu will be notified to
Africa's Talking in writing before it is made.
