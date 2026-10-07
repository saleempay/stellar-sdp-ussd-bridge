/**
 * The screen catalogue of the bridge's USSD menu: every text it can render.
 *
 * Contract: docs/ussd-menu-walkthrough-v1.md (the walkthrough attached to
 * the Africa's Talking service order, 30 September 2026). Screens 1 to 8
 * and E1 to E5 are rendered word for word; the unit test parses that file
 * and compares. Every addition and deviation is listed with its id in
 * docs/walkthrough-deviations.md.
 *
 * Budget: 160 characters per response including the 4-character gateway
 * prefix (adapter CHAR_BUDGET and PREFIX_LENGTH, the Safaricom KE floor),
 * so 156 characters of text. The walkthrough names no figure. Plain ASCII
 * only.
 */
import { CHAR_BUDGET, shortAccount, type Screen } from 'stellar-ussd-sep10-adapter';

/**
 * Length of the gateway response prefix, `CON ` or `END ` (adapter
 * src/ussd/gateway/africasTalking.ts:82 and src/ussd/menu/screens.ts:24).
 */
export const PREFIX_LENGTH = 4;

/** Characters available to the screen text itself. */
export const TEXT_BUDGET = CHAR_BUDGET - PREFIX_LENGTH;

/** What the account screen shows, as read from Horizon. */
export interface AccountView {
  /** USDC balance as the chain string (7 decimal places). */
  balance: string;
  /** Most recent incoming USDC payment, if any. */
  lastReceived?: { amount: string; createdAt: string };
}

/**
 * Chain amount (up to 7 decimals) shown with two decimals, cut, never
 * rounded up: 12.999 shows 12.99, 0.0000001 shows 0.00. String arithmetic
 * only, so no floating point surprises.
 */
export function formatUsdc(chainAmount: string): string {
  const m = /^(\d+)(?:\.(\d*))?$/.exec(chainAmount.trim());
  if (!m) throw new Error('amount must be a non-negative decimal string');
  const whole = m[1]!.replace(/^0+(?=\d)/, '');
  const frac = `${m[2] ?? ''}00`.slice(0, 2);
  return `${whole}.${frac}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "24 Oct", in UTC; the year is added when it is not the current year (A-10). */
export function formatDate(createdAt: string, now: Date): string {
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) throw new Error('createdAt must be an ISO date');
  const base = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  return d.getUTCFullYear() === now.getUTCFullYear() ? base : `${base} ${d.getUTCFullYear()}`;
}

const con = (hop: string, text: string): Screen => ({ kind: 'con', hop, text });
const end = (hop: string, text: string): Screen => ({ kind: 'end', hop, text });

export const SCREENS = {
  /** Screen 1 */
  mainMenu: (): Screen => con('welcome', 'Saleem\n1. My account\n2. About'),
  /** A-2 */
  invalidChoice: (prompt: Screen): Screen => ({ ...prompt, text: `Invalid choice\n${prompt.text}` }),
  /** Screen 2 */
  pinSetup1: (): Screen => con('pinSetup1', 'Create a 4 digit PIN'),
  /** A-3 */
  pinSetupBadFormat: (): Screen => con('pinSetup1', 'PIN must be exactly 4 digits\nCreate a 4 digit PIN'),
  /** A-4 */
  pinSetupWeak: (): Screen => con('pinSetup1', 'That PIN is too easy to guess\nChoose a less obvious one'),
  /** Screen 3 */
  pinSetup2: (): Screen => con('pinSetup2', 'Enter the PIN again'),
  /** A-5 */
  pinSetupMismatch: (): Screen => con('pinSetup1', 'PINs did not match\nCreate a 4 digit PIN'),
  /** Screen 4: only after this session stored the hash. */
  pinSaved: (): Screen => con('accountPrompt', 'PIN saved\n1. Create your account and continue'),
  /** A-8: only after a verification; never "saved". */
  pinAccepted: (): Screen => con('accountPrompt', 'PIN accepted\n1. Create your account and continue'),
  /** Screen 5 */
  accountReady: (): Screen => con('pinEnter', 'Account ready\nEnter your PIN'),
  /** Screen 6 */
  pinEnter: (): Screen => con('pinEnter', 'Enter your PIN'),
  /** A-6 */
  pinEnterBadFormat: (): Screen => con('pinEnter', 'PIN must be exactly 4 digits\nEnter your PIN'),
  /** E1 and A-7 */
  pinWrong: (attemptsLeft: number): Screen =>
    con('pinEnter', `Wrong PIN. ${attemptsLeft} ${attemptsLeft === 1 ? 'attempt' : 'attempts'} left\nEnter your PIN`),
  /** Screen 7 and A-1 */
  account: (accountId: string, view: AccountView, now: Date): Screen => {
    const last = view.lastReceived
      ? `Last received ${formatUsdc(view.lastReceived.amount)} USDC, ${formatDate(view.lastReceived.createdAt, now)}`
      : 'No payments received yet';
    return end('account', `Signed in as ${shortAccount(accountId)}\nBalance ${formatUsdc(view.balance)} USDC\n${last}\nTest only, no funds move`);
  },
  /** Screen 8 */
  about: (): Screen => end('about', 'Saleem, a payment service for basic phones.\nsaleem.digital\nTest only, no funds move'),
  /** E2 */
  endLocked: (): Screen => end('locked', 'Too many attempts.\nTry again later.'),
  /** E3 */
  endNoAccount: (): Screen => end('noAccount', 'No account found for this number.\nDial again to set up.'),
  /** E4 */
  endServiceDown: (): Screen => end('serviceDown', 'Service unavailable.\nPlease try again later.'),
  /** E5 and A-11 */
  endExpired: (): Screen => end('expired', 'The session has expired'),
  /** A-9 */
  endNoTrustline: (): Screen => end('noTrustline', 'Your account cannot hold USDC yet.\nTry again later.'),
};

/** The largest classic amount, 2^63 - 1 stroops. */
export const MAX_CHAIN_AMOUNT = '922337203685.4775807';

/** Every screen at its longest dynamic values, for the budget test. */
export function allScreensAtMaxLength(): Screen[] {
  const longestAccount = 'G'.padEnd(56, 'X');
  const now = new Date('2026-10-07T00:00:00Z');
  return [
    SCREENS.mainMenu(),
    SCREENS.invalidChoice(SCREENS.mainMenu()),
    SCREENS.pinSetup1(),
    SCREENS.pinSetupBadFormat(),
    SCREENS.pinSetupWeak(),
    SCREENS.pinSetup2(),
    SCREENS.pinSetupMismatch(),
    SCREENS.pinSaved(),
    SCREENS.pinAccepted(),
    SCREENS.invalidChoice(SCREENS.pinSaved()),
    SCREENS.invalidChoice(SCREENS.pinAccepted()),
    SCREENS.accountReady(),
    SCREENS.pinEnter(),
    SCREENS.pinEnterBadFormat(),
    SCREENS.pinWrong(2),
    SCREENS.pinWrong(1),
    SCREENS.account(longestAccount, { balance: MAX_CHAIN_AMOUNT, lastReceived: { amount: MAX_CHAIN_AMOUNT, createdAt: '2025-12-31T23:59:59Z' } }, now),
    SCREENS.account(longestAccount, { balance: '0.0000000' }, now),
    SCREENS.about(),
    SCREENS.endLocked(),
    SCREENS.endNoAccount(),
    SCREENS.endServiceDown(),
    SCREENS.endExpired(),
    SCREENS.endNoTrustline(),
  ];
}
