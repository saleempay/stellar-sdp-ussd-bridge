import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CHAR_BUDGET } from 'stellar-ussd-sep10-adapter';
import { MAX_CHAIN_AMOUNT, PREFIX_LENGTH, SCREENS, TEXT_BUDGET, allScreensAtMaxLength, formatDate, formatUsdc, parseWalkthroughScreens } from '../../src/ussd/index.js';

const walkthrough = parseWalkthroughScreens(readFileSync('docs/ussd-menu-walkthrough-v1.md', 'utf8'));
const NOW = new Date('2026-10-07T12:00:00Z');
/** The walkthrough's example account id, padded to a real length. */
const EXAMPLE_ACCOUNT = `GD4I${'X'.repeat(48)}J24Z`;

describe('catalogue against the walkthrough (contractual)', () => {
  it('the walkthrough file parses into 13 screens', () => {
    expect([...walkthrough.keys()]).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', 'E1', 'E2', 'E3', 'E4', 'E5']);
  });

  const expectations: Array<[string, () => string]> = [
    ['1', () => SCREENS.mainMenu().text],
    ['2', () => SCREENS.pinSetup1().text],
    ['3', () => SCREENS.pinSetup2().text],
    ['4', () => SCREENS.pinSaved().text],
    ['5', () => SCREENS.accountReady().text],
    ['6', () => SCREENS.pinEnter().text],
    ['7', () => SCREENS.account(EXAMPLE_ACCOUNT, { balance: '12.5000000', lastReceived: { amount: '10.0000000', createdAt: '2026-10-24T09:00:00Z' } }, NOW).text],
    ['8', () => SCREENS.about().text],
    ['E1', () => SCREENS.pinWrong(2).text],
    ['E2', () => SCREENS.endLocked().text],
    ['E3', () => SCREENS.endNoAccount().text],
    ['E4', () => SCREENS.endServiceDown().text],
    ['E5', () => SCREENS.endExpired().text],
  ];
  for (const [id, render] of expectations) {
    it(`screen ${id} is rendered word for word`, () => {
      expect(render()).toBe(walkthrough.get(id));
    });
  }

  it('session-ending screens are END and prompts are CON, as the walkthrough states', () => {
    for (const s of [SCREENS.about(), SCREENS.endLocked(), SCREENS.endNoAccount(), SCREENS.endServiceDown(), SCREENS.endExpired(), SCREENS.endNoTrustline()]) expect(s.kind).toBe('end');
    expect(SCREENS.account(EXAMPLE_ACCOUNT, { balance: '0' }, NOW).kind).toBe('end');
    for (const s of [SCREENS.mainMenu(), SCREENS.pinSetup1(), SCREENS.pinSetup2(), SCREENS.pinSaved(), SCREENS.accountReady(), SCREENS.pinEnter(), SCREENS.pinWrong(2)]) expect(s.kind).toBe('con');
  });
});

describe('character budget', () => {
  it('is 160 including the 4 character prefix, from the adapter constants', () => {
    expect(CHAR_BUDGET).toBe(160);
    expect(PREFIX_LENGTH).toBe(4);
    expect(TEXT_BUDGET).toBe(156);
  });

  it('every screen at its longest dynamic values fits, in plain ASCII', () => {
    const screens = allScreensAtMaxLength();
    expect(screens.length).toBeGreaterThanOrEqual(24);
    for (const s of screens) {
      expect(s.text.length, s.text).toBeLessThanOrEqual(TEXT_BUDGET);
      expect(PREFIX_LENGTH + s.text.length).toBeLessThanOrEqual(CHAR_BUDGET);
      expect(/^[\x20-\x7E\n]*$/.test(s.text), s.text).toBe(true);
    }
  });

  it('the account screen at maximum values is 125 characters', () => {
    const s = SCREENS.account('G'.padEnd(56, 'X'), { balance: MAX_CHAIN_AMOUNT, lastReceived: { amount: MAX_CHAIN_AMOUNT, createdAt: '2025-12-31T23:59:59Z' } }, NOW);
    expect(s.text.length).toBe(125);
  });
});

describe('formatUsdc: two decimals, cut, never rounded up', () => {
  const cases: Array<[string, string]> = [
    ['0', '0.00'], ['0.0000000', '0.00'], ['0.1', '0.10'], ['12.5000000', '12.50'], ['12.999', '12.99'],
    ['0.0000001', '0.00'], ['922337203685.4775807', '922337203685.47'], ['007.5', '7.50'], ['1.5', '1.50'],
  ];
  for (const [input, out] of cases) it(`${input} shows ${out}`, () => expect(formatUsdc(input)).toBe(out));
  it('refuses a non-decimal', () => {
    expect(() => formatUsdc('-1')).toThrow();
    expect(() => formatUsdc('abc')).toThrow();
  });
});

describe('formatDate', () => {
  it('day and three-letter month in UTC, no leading zero', () => {
    expect(formatDate('2026-10-24T09:00:00Z', NOW)).toBe('24 Oct');
    expect(formatDate('2026-10-04T23:30:00Z', NOW)).toBe('4 Oct');
    expect(formatDate('2026-03-01T00:00:00Z', NOW)).toBe('1 Mar');
  });
  it('adds the year when it is not the current year (A-10)', () => {
    expect(formatDate('2025-12-31T23:59:59Z', NOW)).toBe('31 Dec 2025');
  });
  it('uses UTC, not local time', () => {
    expect(formatDate('2026-10-24T22:30:00Z', NOW)).toBe('24 Oct');
  });
});
